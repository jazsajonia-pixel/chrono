import { z } from "zod";
import { TOOLS, isToolName, type ToolName } from "@/lib/agent-tools";
import { normalizePath, WorkspaceError, type FileChange } from "@/features/workspace/model";
import { diffText } from "@/features/git/diff";
import { detectProjectKindFromPaths, PROJECT_KIND_LABEL } from "@/lib/tree";
import { describeError } from "@/lib/errors";
import type { AgentMode, ToolCall } from "@/types/agent";
import { applyEdits, PatchError, propose, proposalFiles, statusOf, type Proposal } from "./proposal";

/**
 * Executes agent tool calls against the local workspace (read) and the proposal (write).
 * Arguments come from the model, so every call is validated; paths go through the same
 * normaliser as the editor (no `..`, no `.git/`).
 */

export interface WorkspaceView {
  knowledge?: KnowledgeTools;
  paths: () => string[];
  /** Current content the user sees (draft → saved → base). Rejects for binary / too-large files. */
  read: (path: string) => Promise<string>;
  changes: () => FileChange[];
  baseSize?: (path: string) => number | undefined;
  /** Runs a built preview briefly in a hidden sandboxed frame (browser only). */
  probe?: (result: import("@/features/preview/bundler").BuildResult) => Promise<import("@/features/preview/probe").ProbeReport>;
}

/** The user's on-device knowledge base, when the client has one (see src/lib/knowledge.ts). */
export interface KnowledgeTools {
  /** Saves (or updates) a note; `callId` lets the chat offer Undo for this save. Throws KnowledgeError. */
  save: (note: { id?: string; title: string; body: string; scope: "global" | "project" }, callId: string) => import("@/lib/knowledge").KnowledgeNote;
  search: (query: string) => import("@/lib/knowledge").KnowledgeNote[];
}

export interface ToolResult {
  content: string;
  isError: boolean;
  proposal: Proposal;
}

const MAX_READ_CHARS = 60_000;
const MAX_READ_LINES = 1500;
const SKIP_SEARCH = /\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|otf|eot|mp[34]|mov|zip|gz|pdf|lock)$|(^|\/)(node_modules|dist|build|\.next|coverage)\//i;

const schemas = {
  list_files: z.object({ path: z.string().max(1024).optional(), pattern: z.string().max(200).optional() }),
  read_file: z.object({ path: z.string().min(1).max(1024), start_line: z.number().int().min(1).optional(), end_line: z.number().int().min(1).optional() }),
  search_code: z.object({ query: z.string().min(1).max(500), regex: z.boolean().optional(), path: z.string().max(1024).optional(), max_results: z.number().int().min(1).max(200).optional() }),
  get_git_status: z.object({ include_diff: z.boolean().optional() }),
  inspect_package_json: z.object({ path: z.string().max(1024).optional() }),
  request_preview: z.object({ page: z.string().max(1024).optional() }),
  propose_plan: z.object({ summary: z.string().min(1).max(2000), steps: z.array(z.string().min(1).max(1000)).min(1).max(15) }),
  create_file: z.object({ path: z.string().min(1).max(1024), content: z.string().max(400_000) }),
  update_file: z.object({ path: z.string().min(1).max(1024), content: z.string().max(400_000) }),
  apply_patch: z.object({ path: z.string().min(1).max(1024), edits: z.array(z.object({ find: z.string().max(200_000), replace: z.string().max(200_000) })).min(1).max(50) }),
  delete_file: z.object({ path: z.string().min(1).max(1024), reason: z.string().max(1000).optional() }),
  rename_file: z.object({ from: z.string().min(1).max(1024), to: z.string().min(1).max(1024) }),
  save_knowledge: z.object({ title: z.string().min(1).max(200), body: z.string().min(1).max(8000), scope: z.enum(["global", "project"]), id: z.string().max(40).optional() }),
  search_knowledge: z.object({ query: z.string().min(1).max(500) }),
} satisfies Record<ToolName, z.ZodTypeAny>;

class ToolError extends Error {}

function cleanPath(raw: string): string {
  try {
    return normalizePath(raw);
  } catch (err) {
    throw new ToolError(err instanceof WorkspaceError ? `Invalid path "${raw}": ${err.message}` : `Invalid path "${raw}".`);
  }
}

/** Paths visible to the agent: workspace + proposal overlay. */
export function overlayPaths(ws: WorkspaceView, proposal: Proposal): string[] {
  const set = new Set(ws.paths());
  for (const f of Object.values(proposal)) {
    if (f.decision === "rejected") continue;
    if (f.after === null) set.delete(f.path);
    else set.add(f.path);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Content through the overlay; null when the file doesn't exist. */
export async function overlayRead(ws: WorkspaceView, proposal: Proposal, path: string): Promise<string | null> {
  const f = proposal[path];
  if (f && f.decision !== "rejected") return f.after;
  if (!ws.paths().includes(path)) return null;
  try {
    return await ws.read(path);
  } catch (err) {
    throw new ToolError(`Can't read ${path}: ${describeError(err).title}.`);
  }
}

/** Underlying workspace content (no overlay) — what `before` must record. */
async function workspaceRead(ws: WorkspaceView, path: string): Promise<string | null> {
  if (!ws.paths().includes(path)) return null;
  return ws.read(path).catch(() => {
    throw new ToolError(`Can't read ${path}.`);
  });
}

function globToRegExp(pattern: string): RegExp {
  if (!/[*?]/.test(pattern)) return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const re = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\?/g, ".").replace(/\u0000/g, ".*");
  return new RegExp(`(^|/)${re}$`, "i");
}

function underPrefix(path: string, prefix?: string): boolean {
  if (!prefix) return true;
  const p = prefix.replace(/^\.?\/+/, "").replace(/\/+$/, "");
  return !p || path === p || path.startsWith(`${p}/`);
}

async function exec(name: ToolName, args: Record<string, unknown>, ws: WorkspaceView, proposal: Proposal, mode: AgentMode, callId = ""): Promise<{ content: string; proposal: Proposal }> {
  if ((TOOLS[name].kind === "write" || TOOLS[name].kind === "plan") && mode !== "agent") throw new ToolError(`${name} is only available in Agent mode.`);
  const parsed = schemas[name].safeParse(args);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ToolError(`Invalid arguments for ${name}: ${issue?.path.join(".") || "input"} ${issue?.message ?? ""}`.trim());
  }
  const a: unknown = parsed.data;

  switch (name) {
    case "save_knowledge":
    case "search_knowledge": {
      if (!ws.knowledge) throw new ToolError("The knowledge base isn't available in this client.");
      const { describeNote, KnowledgeError } = await import("@/lib/knowledge");
      if (name === "search_knowledge") {
        const found = ws.knowledge.search((a as z.infer<typeof schemas.search_knowledge>).query);
        return { content: found.length ? `${found.length} note(s):\n\n${found.map(describeNote).join("\n\n")}` : "No matching notes.", proposal };
      }
      try {
        const n = ws.knowledge.save(a as z.infer<typeof schemas.save_knowledge>, callId);
        return { content: `Saved to the user's knowledge base: ${describeNote(n)}`, proposal };
      } catch (err) {
        throw new ToolError(err instanceof KnowledgeError ? `Not saved: ${err.message}` : "Not saved: the knowledge base couldn't be written.");
      }
    }
    case "list_files": {
      const { path, pattern } = a as z.infer<typeof schemas.list_files>;
      const re = pattern ? globToRegExp(pattern) : null;
      const all = overlayPaths(ws, proposal).filter((p) => underPrefix(p, path) && (!re || re.test(p)));
      const shown = all.slice(0, 500);
      return { content: `${all.length} file(s)${all.length > shown.length ? ` (first ${shown.length} shown)` : ""}:\n${shown.join("\n")}`, proposal };
    }
    case "read_file": {
      const { path: raw, start_line, end_line } = a as z.infer<typeof schemas.read_file>;
      const path = cleanPath(raw);
      const content = await overlayRead(ws, proposal, path);
      if (content === null) throw new ToolError(`${path} does not exist.`);
      const lines = content.split("\n");
      const start = Math.min(start_line ?? 1, Math.max(1, lines.length));
      let end = Math.min(end_line ?? lines.length, lines.length, start + MAX_READ_LINES - 1);
      let body = lines.slice(start - 1, end).join("\n");
      if (body.length > MAX_READ_CHARS) {
        body = body.slice(0, MAX_READ_CHARS);
        end = start + body.split("\n").length - 1;
      }
      const partial = start > 1 || end < lines.length;
      const pending = proposal[path] && proposal[path].decision === "pending" ? " (includes your proposed changes)" : "";
      return {
        content: `File: ${path} — ${lines.length} lines${partial ? `, showing ${start}-${end}` : ""}${pending}\n${body}${end < lines.length ? `\n[… ${lines.length - end} more lines — call read_file with start_line=${end + 1}]` : ""}`,
        proposal,
      };
    }
    case "search_code": {
      const { query, regex, path: prefix, max_results } = a as z.infer<typeof schemas.search_code>;
      let re: RegExp;
      try {
        re = regex ? new RegExp(query, "i") : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      } catch {
        throw new ToolError("Invalid regular expression.");
      }
      const candidates = overlayPaths(ws, proposal).filter((p) => underPrefix(p, prefix) && !SKIP_SEARCH.test(p) && (ws.baseSize?.(p) ?? 0) <= 256_000);
      const files = candidates.slice(0, 300);
      const limit = max_results ?? 50;
      const hits: string[] = [];
      let i = 0;
      const worker = async () => {
        while (i < files.length && hits.length < limit) {
          const p = files[i++]!;
          const text = await overlayRead(ws, proposal, p).catch(() => null);
          if (!text) continue;
          const lines = text.split("\n");
          for (let n = 0; n < lines.length && hits.length < limit; n++) {
            if (re.test(lines[n]!)) hits.push(`${p}:${n + 1}: ${lines[n]!.trim().slice(0, 200)}`);
          }
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      const note = candidates.length > files.length ? ` (searched the first ${files.length} of ${candidates.length} files)` : "";
      return { content: hits.length ? `${hits.length} match(es)${hits.length >= limit ? " (limit reached)" : ""}${note}:\n${hits.join("\n")}` : `No matches for "${query}"${note}.`, proposal };
    }
    case "get_git_status": {
      const { include_diff } = a as z.infer<typeof schemas.get_git_status>;
      const out: string[] = [];
      const changes = ws.changes();
      out.push(changes.length ? `Saved workspace changes (not yet committed): ${changes.length}` : "No saved workspace changes; the workspace matches the branch.");
      for (const c of changes) {
        const d = diffText(c.base ?? "", c.content ?? "");
        out.push(`  ${c.status.padEnd(8)} ${c.path} (+${d.added} -${d.removed})`);
        if (include_diff && c.status !== "deleted") out.push(unified(c.path, c.base ?? "", c.content ?? "", 4000));
      }
      const proposed = proposalFiles(proposal).filter((f) => f.decision === "pending");
      if (proposed.length) {
        out.push(`Proposed in this task (pending review): ${proposed.length}`);
        for (const f of proposed) out.push(`  ${statusOf(f).padEnd(8)} ${f.path}`);
      }
      return { content: out.join("\n"), proposal };
    }
    case "inspect_package_json": {
      const { path: raw } = a as z.infer<typeof schemas.inspect_package_json>;
      const path = cleanPath(raw ?? "package.json");
      const text = await overlayRead(ws, proposal, path);
      const kind = PROJECT_KIND_LABEL[detectProjectKindFromPaths(overlayPaths(ws, proposal))];
      if (text === null) return { content: `No ${path}. Detected project type: ${kind}.`, proposal };
      let pkg: Record<string, unknown>;
      try {
        pkg = JSON.parse(text) as Record<string, unknown>;
      } catch {
        throw new ToolError(`${path} is not valid JSON.`);
      }
      const pick = (k: string) => (pkg[k] && typeof pkg[k] === "object" ? JSON.stringify(pkg[k], null, 1) : "—");
      return {
        content: [`Detected project type: ${kind}`, `name: ${String(pkg.name ?? "—")}`, `type: ${String(pkg.type ?? "commonjs")}`, `scripts: ${pick("scripts")}`, `dependencies: ${pick("dependencies")}`, `devDependencies: ${pick("devDependencies")}`].join("\n"),
        proposal,
      };
    }
    case "request_preview": {
      const { page: rawPage } = a as z.infer<typeof schemas.request_preview>;
      const [{ analyzeProject }, { buildPreview, BuildError }] = await Promise.all([import("@/features/preview/detect"), import("@/features/preview/bundler")]);
      const paths = overlayPaths(ws, proposal);
      const read = (p: string) => overlayRead(ws, proposal, p).catch(() => null);
      const plan = await analyzeProject(paths, read);
      if (!plan.supported) return { content: `Preview not available: ${plan.label}. ${plan.reason}`, proposal };
      const page = rawPage ? cleanPath(rawPage) : undefined;
      if (page && !plan.pages.includes(page)) throw new ToolError(`${page} is not an HTML page in this project. Pages: ${plan.pages.slice(0, 20).join(", ")}`);
      let result;
      try {
        result = await buildPreview({
          plan,
          page,
          paths,
          read: async (p) => {
            const t = await read(p);
            if (t === null) throw new Error("not in the workspace");
            return t;
          },
        });
      } catch (e) {
        if (!(e instanceof BuildError)) throw e;
        const where = e.file ? ` in ${e.file}${e.line ? `:${e.line}` : ""}` : "";
        return { content: [`BUILD FAILED${where}: ${e.message}`, e.frame ?? ""].filter(Boolean).join("\n\n"), proposal };
      }
      const out = [`Build OK (${plan.label}) · page ${result.page} · ${result.modules} modules${result.packages.length ? ` · npm: ${result.packages.join(", ")}` : ""}`];
      for (const w of result.warnings.slice(0, 10)) out.push(`warning: ${w}`);
      if (ws.probe) {
        const r = await ws.probe(result);
        if (!r.booted && r.errors.length === 0) out.push("Runtime: the app didn't finish loading within 5s (slow network/CDN or an infinite loop).");
        for (const err of r.errors) out.push(`RUNTIME ERROR${err.where ? ` at ${err.where}` : ""}: ${err.message}`);
        for (const c of r.console) out.push(`console.${c.level}: ${c.text}`);
        if (r.booted && r.errors.length === 0) out.push("Runtime: loaded without errors.");
      } else {
        out.push("Runtime check unavailable here; build only.");
      }
      return { content: out.join("\n"), proposal };
    }
    case "propose_plan":
      // Handled by the runner (pauses for approval); reaching here means auto-approve.
      return { content: "Plan approved. Proceed.", proposal };
    case "create_file": {
      const { path: raw, content } = a as z.infer<typeof schemas.create_file>;
      const path = cleanPath(raw);
      if ((await overlayRead(ws, proposal, path)) !== null) throw new ToolError(`${path} already exists. Use apply_patch or update_file.`);
      if (overlayPaths(ws, proposal).some((p) => p.startsWith(`${path}/`))) throw new ToolError(`${path} is a folder.`);
      const next = propose(proposal, path, await workspaceRead(ws, path), content);
      return { content: `Proposed new file ${path} (${content.split("\n").length} lines).`, proposal: next };
    }
    case "update_file": {
      const { path: raw, content } = a as z.infer<typeof schemas.update_file>;
      const path = cleanPath(raw);
      const current = await overlayRead(ws, proposal, path);
      if (current === null) throw new ToolError(`${path} does not exist. Use create_file.`);
      const next = propose(proposal, path, await workspaceRead(ws, path), content);
      const d = diffText(current, content);
      return { content: `Proposed update to ${path} (+${d.added} -${d.removed}).`, proposal: next };
    }
    case "apply_patch": {
      const { path: raw, edits } = a as z.infer<typeof schemas.apply_patch>;
      const path = cleanPath(raw);
      const current = await overlayRead(ws, proposal, path);
      if (current === null) throw new ToolError(`${path} does not exist. Use create_file.`);
      let updated: string;
      try {
        updated = applyEdits(current, edits);
      } catch (err) {
        throw new ToolError(err instanceof PatchError ? `${path}: ${err.message}` : `${path}: patch failed.`);
      }
      const next = propose(proposal, path, await workspaceRead(ws, path), updated);
      const d = diffText(current, updated);
      return { content: `Applied ${edits.length} edit(s) to the proposal for ${path} (+${d.added} -${d.removed}).`, proposal: next };
    }
    case "delete_file": {
      const { path: raw, reason } = a as z.infer<typeof schemas.delete_file>;
      const path = cleanPath(raw);
      if ((await overlayRead(ws, proposal, path)) === null) throw new ToolError(`${path} does not exist.`);
      const next = propose(proposal, path, await workspaceRead(ws, path), null, reason ? { reason } : {});
      return { content: `Proposed deleting ${path}. The user must confirm.`, proposal: next };
    }
    case "rename_file": {
      const { from: rawFrom, to: rawTo } = a as z.infer<typeof schemas.rename_file>;
      const from = cleanPath(rawFrom);
      const to = cleanPath(rawTo);
      if (from === to) throw new ToolError("Source and destination are the same.");
      const content = await overlayRead(ws, proposal, from);
      if (content === null) throw new ToolError(`${from} does not exist.`);
      if ((await overlayRead(ws, proposal, to)) !== null) throw new ToolError(`${to} already exists.`);
      let next = propose(proposal, from, await workspaceRead(ws, from), null, { reason: `Renamed to ${to}` });
      next = propose(next, to, await workspaceRead(ws, to), content, { renamedFrom: from });
      return { content: `Proposed renaming ${from} → ${to}. Update imports that reference it.`, proposal: next };
    }
  }
}

function unified(path: string, a: string, b: string, max: number): string {
  const d = diffText(a, b, 2);
  const lines: string[] = [`--- a/${path}`, `+++ b/${path}`];
  for (const h of d.hunks) {
    lines.push(h.header);
    for (const l of h.lines) lines.push(`${l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}${l.text}`);
  }
  const s = lines.join("\n");
  return s.length > max ? `${s.slice(0, max)}\n[diff truncated]` : s;
}

/** Execute one tool call. Never throws: failures become error results the model can react to. */
export async function executeTool(call: ToolCall, ws: WorkspaceView, proposal: Proposal, mode: AgentMode): Promise<ToolResult> {
  if (!isToolName(call.name)) return { content: `Unknown tool "${call.name}".`, isError: true, proposal };
  if (call.args === null) {
    return { content: call.rawArgs?.startsWith("Tool ") ? call.rawArgs : "The tool arguments were not valid JSON (the response may have been cut off). Retry with smaller edits via apply_patch.", isError: true, proposal };
  }
  try {
    const r = await exec(call.name, call.args, ws, proposal, mode, call.id);
    return { ...r, isError: false };
  } catch (err) {
    return { content: err instanceof ToolError ? err.message : `Tool failed: ${err instanceof Error ? err.message : "unknown error"}`, isError: true, proposal };
  }
}
