import type { ToolCall } from "@/types/agent";
import type { ToolName } from "@/lib/agent-tools";

export type AgentActivityStatus = "queued" | "running" | "completed" | "failed";

export interface AgentActivity {
  id: string;
  tool: string;
  title: string;
  detail?: string;
  target?: string;
  status: AgentActivityStatus;
  startedAt?: string;
  completedAt?: string;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Convert an internal tool call into a concise, user-facing progress label. */
export function describeActivity(call: ToolCall): { title: string; detail?: string } {
  const args = call.args ?? {};
  const path = text(args.path);
  switch (call.name as ToolName | string) {
    case "list_files":
      return { title: "Reviewing the project structure", detail: path ? `Looking under ${path}` : "Mapping the repository files" };
    case "read_file":
      return { title: "Inspecting a project file", detail: path || undefined };
    case "search_code":
      return { title: "Searching the codebase", detail: text(args.query) ? `Looking for “${text(args.query)}”` : undefined };
    case "get_git_status":
      return { title: "Checking workspace changes" };
    case "inspect_package_json":
      return { title: "Understanding the project setup", detail: path || "package.json" };
    case "request_preview":
      return { title: "Checking the result in the preview", detail: text(args.page) || undefined };
    case "propose_plan":
      return { title: "Preparing a plan", detail: text(args.summary) || undefined };
    case "create_file":
      return { title: "Preparing a new file", detail: path || undefined };
    case "update_file":
      return { title: "Preparing a file update", detail: path || undefined };
    case "apply_patch":
      return { title: "Preparing code changes", detail: path || undefined };
    case "delete_file":
      return { title: "Preparing a file deletion", detail: path || undefined };
    case "rename_file":
      return { title: "Preparing a file rename", detail: `${text(args.from)} → ${text(args.to)}` };
    case "save_knowledge":
      return { title: "Saving to your knowledge base", detail: text(args.title) || undefined };
    case "search_knowledge":
      return { title: "Checking your knowledge base", detail: text(args.query) ? `Looking for “${text(args.query)}”` : undefined };
    default:
      return { title: "Working on your request" };
  }
}

export function activityForCall(call: ToolCall, status: AgentActivityStatus = "queued"): AgentActivity {
  const label = describeActivity(call);
  const args = call.args ?? {};
  const target = text(args.path) || (call.name === "rename_file" ? `${text(args.from)} → ${text(args.to)}` : undefined);
  return { id: call.id, tool: call.name, ...label, ...(target ? { target } : {}), status };
}

/** Summarize a tool result without exposing its raw output in the primary chat. */
export function summarizeActivity(call: ToolCall, content: string, failed: boolean): string | undefined {
  if (failed) return "This step needs attention — you can retry the task.";
  switch (call.name) {
    case "list_files": {
      const count = content.match(/^(\d+) file\(s\)/)?.[1];
      return count ? `${count} file${count === "1" ? "" : "s"} found` : "Project structure reviewed";
    }
    case "read_file":
      return "File contents reviewed";
    case "search_code":
      return content.startsWith("No matches") ? "No matches found" : "Search completed";
    case "request_preview":
      return /^Build OK/.test(content) && !/BUILD FAILED|RUNTIME ERROR/.test(content) ? "Build and runtime checks passed" : "Validation found an issue";
    case "create_file":
    case "update_file":
    case "apply_patch":
    case "delete_file":
    case "rename_file":
      return "Change prepared for your review";
    case "save_knowledge":
      return `Saved “${text(call.args?.title)}”`;
    case "search_knowledge":
      return content.startsWith("No matching") ? "Nothing saved about this yet" : "Found saved notes";
    default:
      return "Step completed";
  }
}
