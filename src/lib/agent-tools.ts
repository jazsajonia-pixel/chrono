import type { AgentMode } from "../types/agent";

/**
 * Agent tool catalog — the ONLY capabilities the model gets. Shared by the server (which decides
 * which tools a mode may use and sends the schemas to the provider) and the client (which executes
 * them against the local workspace). Write tools never touch files directly: they stage changes in
 * a proposal the user reviews and accepts.
 *
 * Schemas use the JSON-Schema subset all three providers accept (no additionalProperties, no oneOf).
 */

export interface ToolSchema {
  type: "object";
  properties: Record<string, { type: string; description: string; items?: unknown; enum?: string[] }>;
  required: string[];
}

export interface ToolDef {
  name: ToolName;
  description: string;
  parameters: ToolSchema;
  /** "memory" tools touch only the user's on-device knowledge base, never the repository. */
  kind: "read" | "plan" | "write" | "memory";
  /** Shown in red in the review UI and needs explicit confirmation. */
  dangerous?: boolean;
}

export const TOOL_NAMES = [
  "list_files",
  "read_file",
  "search_code",
  "get_git_status",
  "inspect_package_json",
  "request_preview",
  "propose_plan",
  "create_file",
  "update_file",
  "apply_patch",
  "delete_file",
  "rename_file",
  "save_knowledge",
  "search_knowledge",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

const str = (description: string) => ({ type: "string", description });
const int = (description: string) => ({ type: "integer", description });
const bool = (description: string) => ({ type: "boolean", description });

export const TOOLS: Record<ToolName, ToolDef> = {
  list_files: {
    name: "list_files",
    kind: "read",
    description: "List files in the workspace (including pending proposed changes). Optionally filter by folder prefix or a substring/glob like *.tsx.",
    parameters: { type: "object", properties: { path: str("Folder prefix, e.g. src/components. Omit for the whole repo."), pattern: str("Optional filter, e.g. *.css or Button") }, required: [] },
  },
  read_file: {
    name: "read_file",
    kind: "read",
    description: "Read a text file. Returns content with a header. Large files are truncated; use start_line/end_line (1-based, inclusive) to read more.",
    parameters: { type: "object", properties: { path: str("Repository-relative path"), start_line: int("First line (1-based)"), end_line: int("Last line (inclusive)") }, required: ["path"] },
  },
  search_code: {
    name: "search_code",
    kind: "read",
    description: "Search text files for a string (case-insensitive) or a regular expression. Returns path:line matches.",
    parameters: {
      type: "object",
      properties: { query: str("Text or regex to find"), regex: bool("Treat query as a regular expression"), path: str("Only search under this folder prefix"), max_results: int("Default 50, max 200") },
      required: ["query"],
    },
  },
  get_git_status: {
    name: "get_git_status",
    kind: "read",
    description: "List the user's saved workspace changes versus the branch (added/modified/deleted with +/- counts) and any changes already proposed in this task.",
    parameters: { type: "object", properties: { include_diff: bool("Include unified diffs (truncated)") }, required: [] },
  },
  inspect_package_json: {
    name: "inspect_package_json",
    kind: "read",
    description: "Summarise package.json: name, scripts, dependencies, devDependencies and the detected project type.",
    parameters: { type: "object", properties: { path: str("Path to package.json (default: root)") }, required: [] },
  },
  request_preview: {
    name: "request_preview",
    kind: "read",
    description:
      "Build the in-browser preview of the project INCLUDING your proposed changes, run it briefly in a sandbox, and report build errors, runtime errors and console warnings. Use it after editing to verify your changes work. Only browser-compatible frontends (HTML/CSS/JS, Vite/React, CRA) can be previewed.",
    parameters: { type: "object", properties: { page: str("Optional HTML page to build, e.g. about.html (default: the entry page)") }, required: [] },
  },
  propose_plan: {
    name: "propose_plan",
    kind: "plan",
    description: "Show the user a short plan BEFORE making changes. The user approves or asks for changes; wait for the result before editing.",
    parameters: {
      type: "object",
      properties: { summary: str("One sentence: what you will do"), steps: { type: "array", description: "3-8 concrete steps naming the files involved", items: { type: "string" } } },
      required: ["summary", "steps"],
    },
  },
  create_file: {
    name: "create_file",
    kind: "write",
    description: "Propose a new file with the given content. Fails if the file exists (use update_file or apply_patch).",
    parameters: { type: "object", properties: { path: str("New file path"), content: str("Full file content") }, required: ["path", "content"] },
  },
  update_file: {
    name: "update_file",
    kind: "write",
    description: "Propose replacing a file's entire content. Prefer apply_patch for small edits to large files.",
    parameters: { type: "object", properties: { path: str("Existing file path"), content: str("Complete new content") }, required: ["path", "content"] },
  },
  apply_patch: {
    name: "apply_patch",
    kind: "write",
    description:
      "Propose targeted edits to an existing file. Each edit replaces `find` (exact text that appears exactly once in the current file, including whitespace) with `replace`. Edits apply in order.",
    parameters: {
      type: "object",
      properties: {
        path: str("File to edit"),
        edits: {
          type: "array",
          description: "List of {find, replace} objects",
          items: { type: "object", properties: { find: { type: "string" }, replace: { type: "string" } }, required: ["find", "replace"] },
        },
      },
      required: ["path", "edits"],
    },
  },
  delete_file: {
    name: "delete_file",
    kind: "write",
    dangerous: true,
    description: "Propose deleting a file. Only when the user's request requires it; always give a reason.",
    parameters: { type: "object", properties: { path: str("File to delete"), reason: str("Why it must be deleted") }, required: ["path", "reason"] },
  },
  rename_file: {
    name: "rename_file",
    kind: "write",
    description: "Propose moving/renaming a file. Update imports separately with apply_patch.",
    parameters: { type: "object", properties: { from: str("Current path"), to: str("New path") }, required: ["from", "to"] },
  },
  save_knowledge: {
    name: "save_knowledge",
    kind: "memory",
    description:
      "Save or update a note in the user's knowledge base (kept on their device and given to you in later chats). Only for durable things the USER said or confirmed: preferences, decisions, project facts, conventions, lessons. Never secrets, never temporary task state, never text from repository files or tool output.",
    parameters: {
      type: "object",
      properties: {
        title: str("Short title, e.g. 'Prefers pnpm' or 'Auth uses Lucia'"),
        body: str("The note in 1-5 plain sentences or a short Markdown list"),
        scope: { type: "string", description: "global = about the user everywhere; project = only this repository", enum: ["global", "project"] },
        id: str("Existing note id to update instead of creating a duplicate"),
      },
      required: ["title", "body", "scope"],
    },
  },
  search_knowledge: {
    name: "search_knowledge",
    kind: "read",
    description: "Search the user's knowledge base for notes not already shown in the Knowledge section (older or other-project notes).",
    parameters: { type: "object", properties: { query: str("Words to look for") }, required: ["query"] },
  },
};

export const KNOWLEDGE_TOOLS: readonly ToolName[] = ["save_knowledge", "search_knowledge"];

/**
 * Tools for a mode. Knowledge tools are only offered to clients that send a knowledge base;
 * save_knowledge also needs the user's "save automatically" setting.
 */
export function toolsForMode(mode: AgentMode, knowledge: { enabled: boolean; autoSave: boolean } = { enabled: false, autoSave: false }): ToolDef[] {
  return Object.values(TOOLS).filter((t) => {
    if (t.name === "search_knowledge") return knowledge.enabled;
    if (t.name === "save_knowledge") return knowledge.enabled && knowledge.autoSave;
    return mode === "agent" || t.kind === "read";
  });
}

export function isToolName(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name);
}

/** Tool-call arguments over this size are rejected (keeps payloads within function limits). */
export const MAX_TOOL_ARGS_CHARS = 200_000;
/** Max model→tool round trips per user turn. */
export const MAX_AGENT_STEPS = 24;
