import { useState } from "react";
import { Link } from "wouter";
import { ArrowRight, Trash2 } from "lucide-react";
import { BottomSheet } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmSheet } from "@/components/dialogs";
import { ShippedNote } from "@/features/git/shipped-note";
import { projectPath } from "@/lib/nav";
import { HISTORY_STATUS_LABEL, type HistoryEntry, type HistoryStatus } from "./history";

export const STATUS_TONE: Record<HistoryStatus, "neutral" | "primary" | "warning" | "danger"> = {
  in_progress: "neutral",
  needs_review: "warning",
  done: "neutral",
  shipped: "primary",
  failed: "danger",
};

const DECISION_STYLE: Record<string, string> = {
  accepted: "text-success",
  rejected: "text-muted-foreground line-through",
  pending: "text-warning",
};

const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Everything stored about one AI task: prompt, repo, branch, files, result, time, status, commit/PR. */
export function TaskDetailSheet({ entry, onOpenChange, onDelete }: { entry: HistoryEntry | null; onOpenChange: (open: boolean) => void; onDelete: (e: HistoryEntry) => void }) {
  const [confirm, setConfirm] = useState(false);
  const e = entry;
  return (
    <>
      <BottomSheet open={!!e} onOpenChange={onOpenChange} title={e?.ref.task.title ?? "Task"}>
        {e ? (
          <div className="space-y-4 text-sm" data-testid="task-detail">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONE[e.status]} data-testid="badge-task-status">
                {HISTORY_STATUS_LABEL[e.status]}
              </Badge>
              <Badge>{e.ref.task.mode}</Badge>
            </div>

            <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-2 rounded-lg border bg-background p-3">
              <dt className="text-muted-foreground">Repository</dt>
              <dd className="min-w-0 break-all font-mono text-[13px]">
                {e.ref.owner}/{e.ref.repo}
              </dd>
              <dt className="text-muted-foreground">Branch</dt>
              <dd className="min-w-0 break-all font-mono text-[13px]">{e.ref.branch}</dd>
              <dt className="text-muted-foreground">Started</dt>
              <dd>
                <time dateTime={e.ref.task.createdAt}>{fmt(e.ref.task.createdAt)}</time>
              </dd>
              <dt className="text-muted-foreground">Updated</dt>
              <dd>
                <time dateTime={e.ref.task.updatedAt}>{fmt(e.ref.task.updatedAt)}</time>
              </dd>
              {e.ref.task.provider ? (
                <>
                  <dt className="text-muted-foreground">Model</dt>
                  <dd className="min-w-0 break-words">
                    {e.ref.task.provider.label} · <span className="font-mono text-[12px]">{e.ref.task.provider.model}</span>
                    {e.ref.task.usage.inputTokens ? <span className="text-muted-foreground"> · {e.ref.task.usage.inputTokens + e.ref.task.usage.outputTokens} tokens</span> : null}
                  </dd>
                </>
              ) : null}
            </dl>

            <section>
              <h3 className="mb-1 section-label">Prompt</h3>
              <p className="whitespace-pre-wrap break-words rounded-lg border bg-surface p-3" data-testid="text-task-prompt">
                {e.prompt}
              </p>
              {e.attached.length ? <p className="mt-1 break-words text-xs text-muted-foreground">Attached: {e.attached.join(", ")}</p> : null}
            </section>

            <section>
              <h3 className="mb-1 section-label">Files changed ({e.files.length})</h3>
              {e.files.length ? (
                <ul className="divide-y rounded-lg border bg-surface" data-testid="list-task-files">
                  {e.files.map((f) => (
                    <li key={f.path} className="flex items-center gap-2 px-3 py-2">
                      <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{f.path}</span>
                      <span className={`shrink-0 text-xs ${DECISION_STYLE[f.decision] ?? ""}`}>{f.after === null ? `delete · ${f.decision}` : f.decision}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">No file changes{e.ref.task.mode === "ask" ? " (Ask mode)" : ""}.</p>
              )}
            </section>

            {e.result ? (
              <section>
                <h3 className="mb-1 section-label">{e.status === "failed" && e.ref.task.error ? "Error" : "Result"}</h3>
                <p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border bg-surface p-3 text-[13px] leading-relaxed" data-testid="text-task-result">
                  {e.result}
                </p>
              </section>
            ) : null}

            <section>
              <h3 className="mb-1 section-label">Commit / PR</h3>
              {e.ref.task.shipped ? <ShippedNote info={e.ref.task.shipped} /> : <p className="text-muted-foreground">Not committed yet.</p>}
            </section>

            <div className="flex gap-2 pb-2">
              <Button variant="secondary" className="flex-1 text-danger" onClick={() => setConfirm(true)} data-testid="button-delete-task">
                <Trash2 className="size-4" aria-hidden /> Delete
              </Button>
              <Button asChild className="flex-1">
                <Link href={projectPath(e.ref.owner, e.ref.repo, "ai")} data-testid="link-open-task-project">
                  Open project <ArrowRight className="size-4" aria-hidden />
                </Link>
              </Button>
            </div>
          </div>
        ) : null}
      </BottomSheet>
      <ConfirmSheet
        open={confirm}
        onOpenChange={setConfirm}
        title="Delete this task?"
        description="Removes the conversation and tool log from this device. Workspace files and commits are not affected."
        confirmLabel="Delete task"
        danger
        onConfirm={() => {
          setConfirm(false);
          if (e) onDelete(e);
        }}
      />
    </>
  );
}
