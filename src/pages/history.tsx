import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ChevronLeft, History, Search } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { deleteTask, recentAgentTasks } from "@/features/agent/store";
import { HISTORY_STATUS_LABEL, filterHistory, repoOptions, toHistoryEntry, type HistoryEntry, type HistoryStatus } from "@/features/history/history";
import { STATUS_TONE, TaskDetailSheet } from "@/features/history/task-detail";
import { ShippedNote } from "@/features/git/shipped-note";
import { cn, timeAgo } from "@/lib/utils";

const STATUSES: (HistoryStatus | "all")[] = ["all", "needs_review", "shipped", "done", "in_progress", "failed"];

export default function HistoryPage({ params }: { params?: { owner?: string; repo?: string } }) {
  const initialRepo = params?.owner && params.repo ? `${decodeURIComponent(params.owner)}/${decodeURIComponent(params.repo)}` : null;
  const [version, setVersion] = useState(0);
  const entries = useMemo(() => recentAgentTasks(Infinity).map(toHistoryEntry), [version]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<HistoryStatus | "all">("all");
  const [repo, setRepo] = useState<string | null>(initialRepo);
  const [openId, setOpenId] = useState<string | null>(null);
  const repos = repoOptions(entries);
  const shown = filterHistory(entries, { query, status, repo });
  const open = entries.find((e) => `${e.ref.key}#${e.ref.task.id}` === openId) ?? null;

  function remove(e: HistoryEntry) {
    deleteTask(e.ref.key, e.ref.task.id);
    setOpenId(null);
    setVersion((v) => v + 1);
  }

  return (
    <AppShell
      title="Task history"
      width="narrow"
      actions={
        <Link href="/app/ai" className="-mr-2 inline-flex h-11 items-center gap-1 rounded-md px-2 text-sm text-muted-foreground hover:bg-surface-2 hover:text-foreground">
          <ChevronLeft className="size-4" aria-hidden /> AI
        </Link>
      }
    >
      {entries.length === 0 ? (
        <EmptyState
          icon={<History className="size-6" />}
          title="No AI tasks on this device yet"
          action={
            <Button asChild>
              <Link href="/app/projects">Open a project</Link>
            </Button>
          }
        >
          Tasks you run from a project's AI tab are kept here — prompt, files changed, result and commit/PR.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          <label className="relative block">
            <span className="sr-only">Search tasks</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search prompts, files, branches"
              data-testid="input-search-history"
              className="h-11 w-full rounded-md border bg-surface pl-9 pr-3 text-base placeholder:text-muted-foreground sm:text-sm"
            />
          </label>

          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]" role="group" aria-label="Filter by status">
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={status === s}
                onClick={() => setStatus(s)}
                data-testid={`filter-${s}`}
                className={cn(
                  "h-9 shrink-0 rounded-full border px-3.5 text-sm",
                  status === s ? "border-primary bg-primary/10 font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s === "all" ? "All" : HISTORY_STATUS_LABEL[s]}
              </button>
            ))}
          </div>

          {repos.length > 1 || repo ? (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Repository</span>
              <select
                value={repo ?? ""}
                onChange={(e) => setRepo(e.target.value || null)}
                className="h-11 min-w-0 flex-1 rounded-md border bg-surface px-2 font-mono text-[13px]"
                data-testid="select-history-repo"
              >
                <option value="">All repositories</option>
                {[...new Set([...repos, ...(repo ? [repo] : [])])].map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <p className="text-xs text-muted-foreground" aria-live="polite">
            {shown.length} of {entries.length} task{entries.length === 1 ? "" : "s"} · stored on this device
          </p>

          {shown.length === 0 ? (
            <EmptyState title="No matching tasks" className="py-8">
              Try another filter or search.
            </EmptyState>
          ) : (
            <ul className="divide-y overflow-hidden rounded-lg border bg-surface" data-testid="list-history">
              {shown.map((e) => {
                const accepted = e.files.filter((f) => f.decision === "accepted").length;
                return (
                  <li key={`${e.ref.key}#${e.ref.task.id}`}>
                    <button
                      type="button"
                      onClick={() => setOpenId(`${e.ref.key}#${e.ref.task.id}`)}
                      className="flex min-h-16 w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface-2"
                      data-testid={`history-task-${e.ref.task.id}`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{e.ref.task.title}</span>
                        <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
                          {e.ref.owner}/{e.ref.repo}@{e.ref.branch}
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {timeAgo(new Date(e.ref.task.updatedAt))} · {e.files.length ? `${e.files.length} file${e.files.length === 1 ? "" : "s"}${accepted ? `, ${accepted} accepted` : ""}` : e.ref.task.mode === "ask" ? "question" : "no changes"}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <Badge tone={STATUS_TONE[e.status]}>{HISTORY_STATUS_LABEL[e.status]}</Badge>
                        {e.ref.task.shipped ? <ShippedNote info={e.ref.task.shipped} compact /> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      <TaskDetailSheet entry={open} onOpenChange={(o) => !o && setOpenId(null)} onDelete={remove} />
    </AppShell>
  );
}
