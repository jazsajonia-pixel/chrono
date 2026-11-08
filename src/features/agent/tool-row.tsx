import { useState } from "react";
import { BookMarked, BookOpen, CheckCircle2, ChevronDown, FilePen, FilePlus2, FileSearch, FileText, FileX2, FolderTree, GitCompare, Loader2, MonitorPlay, Package, Replace, XCircle } from "lucide-react";
import { TOOLS, isToolName, type ToolName } from "@/lib/agent-tools";
import { cn } from "@/lib/utils";
import { canUndoSave, undoSave } from "@/features/knowledge/store";
import type { AgentMessage, ToolCall } from "@/types/agent";

const ICON: Record<ToolName, typeof FileText> = {
  list_files: FolderTree,
  read_file: FileText,
  search_code: FileSearch,
  get_git_status: GitCompare,
  inspect_package_json: Package,
  request_preview: MonitorPlay,
  propose_plan: FileText,
  create_file: FilePlus2,
  update_file: FilePen,
  apply_patch: Replace,
  delete_file: FileX2,
  rename_file: FilePen,
  save_knowledge: BookMarked,
  search_knowledge: BookOpen,
};

function s(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Human summary of a tool call, e.g. "Read src/App.tsx". */
export function describeCall(c: ToolCall): string {
  const a = c.args ?? {};
  switch (c.name) {
    case "list_files":
      return `List files${s(a.path) ? ` in ${s(a.path)}` : ""}${s(a.pattern) ? ` matching ${s(a.pattern)}` : ""}`;
    case "read_file":
      return `Read ${s(a.path)}${a.start_line ? ` (from line ${String(a.start_line)})` : ""}`;
    case "search_code":
      return `Search “${s(a.query)}”${s(a.path) ? ` in ${s(a.path)}` : ""}`;
    case "get_git_status":
      return "Check workspace changes";
    case "inspect_package_json":
      return "Inspect package.json";
    case "request_preview":
      return `Check the preview${s(a.page) ? ` (${s(a.page)})` : ""}`;
    case "create_file":
      return `Create ${s(a.path)}`;
    case "update_file":
      return `Rewrite ${s(a.path)}`;
    case "apply_patch":
      return `Edit ${s(a.path)}${Array.isArray(a.edits) ? ` · ${a.edits.length} change${a.edits.length === 1 ? "" : "s"}` : ""}`;
    case "delete_file":
      return `Delete ${s(a.path)}`;
    case "rename_file":
      return `Rename ${s(a.from)} → ${s(a.to)}`;
    case "save_knowledge":
      return `Saved to knowledge: ${s(a.title)}`;
    case "search_knowledge":
      return `Search knowledge for “${s(a.query)}”`;
    default:
      return c.name;
  }
}

/** Undo for a note the agent just saved (restores the previous version, or removes a new note). */
function UndoSave({ callId }: { callId: string }) {
  const [state, setState] = useState<"ready" | "undone" | "gone">(() => (canUndoSave(callId) ? "ready" : "gone"));
  if (state === "gone") return null;
  if (state === "undone") return <span className="shrink-0 pr-3 text-xs text-muted-foreground">Undone</span>;
  return (
    <button type="button" data-testid="undo-save-knowledge" onClick={() => setState(undoSave(callId) ? "undone" : "gone")} className="mr-1 shrink-0 rounded-sm px-2 py-1 text-xs font-medium text-primary hover:bg-muted">
      Undo
    </button>
  );
}

/** One logged tool call. Every call the model makes is shown; tap to see arguments and output. */
export function ToolRow({ call, result, running }: { call: ToolCall; result?: Extract<AgentMessage, { role: "tool" }>; running: boolean }) {
  const [open, setOpen] = useState(false);
  const def = isToolName(call.name) ? TOOLS[call.name] : null;
  const Icon = def ? ICON[def.name] : FileText;
  const write = def?.kind === "write";
  const danger = !!def?.dangerous;
  const status = result ? (result.isError ? "error" : "ok") : running ? "running" : "skipped";
  const args = call.args ? Object.fromEntries(Object.entries(call.args).map(([k, v]) => [k, typeof v === "string" && v.length > 600 ? `${v.slice(0, 600)}… (${v.length} chars)` : v])) : call.rawArgs;

  return (
    <li className="rounded-md border bg-surface" data-testid={`tool-${call.name}`}>
      <div className="flex items-center">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left">
        <Icon className={cn("size-4 shrink-0", danger ? "text-danger" : write ? "text-primary" : "text-muted-foreground")} aria-hidden />
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{describeCall(call)}</span>
        {write && status === "ok" ? <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-primary">proposed</span> : null}
        {status === "running" ? <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-label="Running" /> : null}
        {status === "ok" ? <CheckCircle2 className="size-4 shrink-0 text-primary" aria-label="Done" /> : null}
        {status === "error" ? <XCircle className="size-4 shrink-0 text-danger" aria-label="Failed" /> : null}
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
      </button>
        {call.name === "save_knowledge" && status === "ok" ? <UndoSave callId={call.id} /> : null}
      </div>
      {open ? (
        <div className="space-y-2 border-t px-3 py-2">
          <p className="font-mono text-[11px] text-muted-foreground">{call.name}</p>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-background p-2 font-mono text-[11px]">{typeof args === "string" ? args : JSON.stringify(args, null, 2)}</pre>
          {result ? (
            <pre className={cn("max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-background p-2 font-mono text-[11px]", result.isError && "text-danger")}>{result.content}</pre>
          ) : (
            <p className="text-xs text-muted-foreground">{running ? "Running…" : "Not run."}</p>
          )}
        </div>
      ) : null}
    </li>
  );
}
