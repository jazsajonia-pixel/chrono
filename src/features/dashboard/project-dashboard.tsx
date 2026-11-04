import { useMemo, type ReactNode } from "react";
import { Link } from "wouter";
import { AlertTriangle, ArrowRight, CheckCircle2, ExternalLink, GitBranch, History, Loader2, MonitorSmartphone, RefreshCw, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/features/workspace/context";
import { diffChange } from "@/features/git/diff";
import { GitStatus } from "@/features/git/git-status";
import type { GitTarget } from "@/features/git/ship-panel";
import { ActiveProviderLink } from "@/features/ai/active-provider";
import { recentAgentTasks } from "@/features/agent/store";
import { HISTORY_STATUS_LABEL, toHistoryEntry } from "@/features/history/history";
import { STATUS_TONE } from "@/features/history/task-detail";
import { loadPreviewStatus } from "@/features/preview/status";
import { useOnline } from "@/hooks/use-online";
import { projectPath } from "@/lib/nav";
import { PROJECT_KIND_LABEL, detectProjectKindFromPaths } from "@/lib/tree";
import { timeAgo } from "@/lib/utils";
import type { ProjectRef } from "@/types/workspace";

function Card({ title, action, children, testId }: { title: string; action?: ReactNode; children: ReactNode; testId: string }) {
  return (
    <section className="rounded-lg border bg-surface" aria-label={title} data-testid={testId}>
      <div className="flex min-h-11 items-center justify-between gap-2 border-b px-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-8 items-baseline gap-3 text-sm">
      <dt className="w-24 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 break-words">{children}</dd>
    </div>
  );
}

/**
 * Project dashboard: repository, current branch, last sync, AI provider/model, recent tasks,
 * recent commits, preview status and Git status — one screen per repository.
 */
export function ProjectDashboard({
  project,
  target,
  syncedAt,
  refreshing = false,
  onRefresh,
  onPickBranch,
}: {
  project: ProjectRef;
  target: GitTarget;
  /** When the file tree was last loaded from GitHub . */
  syncedAt: string | null;
  refreshing?: boolean;
  onRefresh?: () => void;
  onPickBranch?: () => void;
}) {
  const ws = useWorkspace();
  const online = useOnline();
  const kind = detectProjectKindFromPaths(ws.paths);
  const totals = useMemo(
    () =>
      ws.changes.reduce(
        (t, c) => {
          const d = diffChange(c);
          return { a: t.a + d.added, r: t.r + d.removed };
        },
        { a: 0, r: 0 },
      ),
    [ws.changes],
  );
  const drafts = Object.keys(ws.data.drafts).length;
  const tasks = useMemo(
    () => recentAgentTasks(Infinity).filter((t) => t.owner === project.owner && t.repo === project.name).slice(0, 3).map(toHistoryEntry),
    [project.owner, project.name],
  );
  const preview = loadPreviewStatus(ws.source.storageKey);
  const repoUrl = `https://github.com/${project.owner}/${project.name}`;

  return (
    <div className="space-y-4 p-4" data-testid="project-dashboard">
      <Card
        title="Repository"
        testId="card-repository"
        action={
          repoUrl ? (
            <a href={repoUrl} target="_blank" rel="noreferrer noopener" className="-mr-1 inline-flex h-11 items-center gap-1 px-1 text-xs text-muted-foreground hover:text-foreground">
              GitHub <ExternalLink className="size-3" aria-hidden />
            </a>
          ) : null
        }
      >
        <p className="break-all font-mono text-[13px] font-semibold">
          {project.owner}/{project.name}
        </p>
        {project.description ? <p className="mt-1 text-sm text-muted-foreground">{project.description}</p> : null}
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge>{project.visibility}</Badge>
          <Badge>{PROJECT_KIND_LABEL[kind]}</Badge>
          <Badge>
            {ws.paths.length} file{ws.paths.length === 1 ? "" : "s"}
          </Badge>
          {ws.source.truncated ? <Badge tone="warning">Partial tree</Badge> : null}
        </div>
      </Card>

      <Card
        title="Branch & sync"
        testId="card-branch"
        action={
          onRefresh ? (
            <Button variant="ghost" size="sm" onClick={onRefresh} disabled={!online || refreshing} data-testid="button-refresh-tree" aria-label="Sync with GitHub">
              {refreshing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />} Sync
            </Button>
          ) : null
        }
      >
        <dl>
          <Row label="Current">
            {onPickBranch ? (
              <button type="button" onClick={onPickBranch} className="-mx-1 inline-flex max-w-full items-center gap-1 rounded px-1 text-left font-mono text-[13px] hover:bg-surface-2" data-testid="button-dashboard-branch">
                <GitBranch className="size-3.5 shrink-0" aria-hidden />
                <span className="break-all">{target.branch}</span>
              </button>
            ) : (
              <span className="font-mono text-[13px]">{target.branch}</span>
            )}
            {target.branch === target.defaultBranch ? <span className="ml-1.5 text-xs text-muted-foreground">(default)</span> : null}
          </Row>
          <Row label="Commit">
            <span className="font-mono text-[13px]">{ws.source.commitSha.slice(0, 7)}</span>
          </Row>
          <Row label="Last sync">
            <span data-testid="text-last-sync">{syncedAt ? timeAgo(new Date(syncedAt)) : "Not synced yet"}</span>
          </Row>
        </dl>
        {ws.baseMoved ? (
          <p className="mt-2 flex items-start gap-2 rounded-md bg-warning/10 p-2 text-xs text-warning" role="note">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            The branch moved on GitHub since your changes were made. Commit them to a new branch to stay safe.
          </p>
        ) : null}
      </Card>

      <Card
        title="Git status"
        testId="card-git-status"
        action={
          <Link href={projectPath(project.owner, project.name, "git")} className="-mr-1 inline-flex h-11 items-center gap-1 px-1 text-sm font-medium text-primary hover:underline" data-testid="link-dashboard-git">
            {ws.changes.length ? "Review & commit" : "Open Git"} <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        }
      >
        <p className="text-sm" data-testid="text-git-summary">
          {ws.changes.length ? (
            <>
              <span className="font-semibold">
                {ws.changes.length} changed file{ws.changes.length === 1 ? "" : "s"}
              </span>{" "}
              <span className="font-mono text-[12px]">
                <span className="text-[hsl(var(--diff-add))]">+{totals.a}</span> <span className="text-[hsl(var(--diff-del))]">-{totals.r}</span>
              </span>
              <span className="text-muted-foreground"> · not committed yet</span>
            </>
          ) : (
            <span className="text-muted-foreground">Working tree clean.</span>
          )}
          {drafts ? <span className="block text-xs text-warning">{drafts} unsaved editor draft{drafts === 1 ? "" : "s"} (kept on this device)</span> : null}
        </p>
        <div className="mt-3">
          <GitStatus target={target} version={0} compact />
        </div>
      </Card>

      <Card title="AI" testId="card-ai">
        <ActiveProviderLink className="border-0 bg-background p-3" />
        <div className="mt-3 flex items-center justify-between">
          <h3 className="section-label">Recent tasks</h3>
          <Link href={`/app/ai/history/${encodeURIComponent(project.owner)}/${encodeURIComponent(project.name)}`} className="-my-2 inline-flex h-11 items-center gap-1 px-1 text-sm text-primary hover:underline" data-testid="link-dashboard-history">
            <History className="size-3.5" aria-hidden /> History
          </Link>
        </div>
        {tasks.length ? (
          <ul className="mt-1 divide-y rounded-md border" data-testid="list-dashboard-tasks">
            {tasks.map((t) => (
              <li key={t.ref.task.id} className="flex items-center gap-2 px-3 py-2.5 text-sm">
                <span className="min-w-0 flex-1 truncate">{t.ref.task.title}</span>
                <Badge tone={STATUS_TONE[t.status]}>{HISTORY_STATUS_LABEL[t.status]}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            No tasks yet.{" "}
            <Link href={projectPath(project.owner, project.name, "ai")} className="text-primary hover:underline">
              Ask the agent
            </Link>
          </p>
        )}
      </Card>

      <Card
        title="Preview"
        testId="card-preview"
        action={
          <Link href={projectPath(project.owner, project.name, "preview")} className="-mr-1 inline-flex h-11 items-center gap-1 px-1 text-sm font-medium text-primary hover:underline">
            <MonitorSmartphone className="size-3.5" aria-hidden /> Open
          </Link>
        }
      >
        {preview ? (
          <p className="flex items-start gap-2 text-sm" data-testid="text-preview-status">
            {preview.status === "ready" && preview.runtimeErrors === 0 ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
            ) : preview.status === "ready" ? (
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            ) : (
              <XCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
            )}
            <span className="min-w-0">
              <span className="font-medium">
                {preview.status === "ready"
                  ? preview.runtimeErrors
                    ? `Built · ${preview.runtimeErrors} runtime error${preview.runtimeErrors === 1 ? "" : "s"}`
                    : "Built and running"
                  : preview.status === "error"
                    ? "Build failed"
                    : "Not previewable in the browser"}
              </span>
              <span className="text-muted-foreground">
                {" "}
                · {preview.label} · {timeAgo(new Date(preview.at))}
              </span>
              {preview.message ? <span className="mt-0.5 block break-words text-xs text-muted-foreground">{preview.message}</span> : null}
            </span>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Not run yet on this branch.</p>
        )}
      </Card>
    </div>
  );
}
