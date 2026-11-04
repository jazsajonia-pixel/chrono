import { ShippedNote } from "@/features/git/shipped-note";
import { useMemo } from "react";
import { Link } from "wouter";
import { MessageSquareCode, Sparkles } from "lucide-react";
import { AppShell, PageIntro } from "@/components/layout/app-shell";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { ActiveProviderLink } from "@/features/ai/active-provider";
import { recentAgentTasks } from "@/features/agent/store";
import { proposalFiles } from "@/features/agent/proposal";
import { projectPath } from "@/lib/nav";

export default function AIPage() {
  const recent = useMemo(() => recentAgentTasks(), []);
  return (
    <AppShell title="AI">
      <PageIntro>Pick the model the agent uses, then pick up any recent task where you left it.</PageIntro>
      <div className="space-y-6">
        <section className="studio-panel p-5" aria-labelledby="ai-provider-heading">
          <div className="mb-4"><h2 id="ai-provider-heading" className="text-sm font-semibold">Default AI provider</h2><p className="text-xs text-muted-foreground">Used by the agent in every project</p></div>
          <ActiveProviderLink />
        </section>

        <section className="studio-panel p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="section-label">Recent agent tasks</h2>
            {recent.length ? (
              <Link href="/app/ai/history" className="-my-2 inline-flex h-11 items-center px-1 text-sm font-medium text-primary hover:underline" data-testid="link-task-history">
                Full history
              </Link>
            ) : null}
          </div>
          {recent.length === 0 ? (
            <EmptyState
              icon={<Sparkles className="size-6" />}
              title="No tasks yet"
              action={
                <Button asChild>
                  <Link href="/app/projects">Open a project</Link>
                </Button>
              }
            >
              The agent works inside a project: open one and use the AI tab to ask questions or request changes.
            </EmptyState>
          ) : (
            <ul className="divide-y overflow-hidden rounded-xl border border-border/70 bg-background/40">
              {recent.map((r) => {
                const files = proposalFiles(r.task.proposal);
                const pending = files.filter((f) => f.decision === "pending").length;
                return (
                  <li key={`${r.owner}/${r.repo}/${r.task.id}`}>
                    <Link href={projectPath(r.owner, r.repo, "ai")} className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-surface-2" data-testid={`recent-task-${r.task.id}`}>
                      <MessageSquareCode className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{r.task.title}</span>
                        <span className="block truncate font-mono text-[11px] text-muted-foreground">
                          {r.owner}/{r.repo} · {r.task.mode} · {r.task.status.replace("_", " ")}
                        </span>
                      </span>
                      {r.task.shipped ? <ShippedNote info={r.task.shipped} compact /> : null}
                      {pending ? <span className="shrink-0 text-xs font-medium text-warning">{pending} to review</span> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
