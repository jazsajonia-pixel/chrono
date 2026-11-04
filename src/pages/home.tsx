import { Link, useLocation } from "wouter";
import { ArrowRight, Bot, FolderGit2, GitBranch, Plus, Search, Sparkles, WandSparkles } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/stores/session";
import { recentRepos } from "@/features/github/recent";
import { useProviders } from "@/features/ai/use-providers";
import { useSkills } from "@/features/skills/use-skills";
import { openCommandPalette, requestNewRepo } from "@/features/command/palette-store";
import { isMac } from "@/components/layout/sidebar";
import { projectPath } from "@/lib/nav";
import { timeAgo } from "@/lib/utils";

function QuickAction({ icon: Icon, title, description, testId, href, onClick }: { icon: typeof Sparkles; title: string; description: string; testId: string; href?: string; onClick?: () => void }) {
  const body = (
    <>
      <span className="mb-3 grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="block text-sm font-semibold">{title}</span>
      <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{description}</span>
    </>
  );
  const cls = "lift group block rounded-xl border bg-surface p-4 text-left hover:border-primary/40";
  return href ? (
    <Link href={href} data-testid={testId} className={cls}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} data-testid={testId} className={cls}>
      {body}
    </button>
  );
}

function AiStatus() {
  const { state } = useProviders();
  const skills = useSkills();
  const ready = state.status === "ready" ? state.data : null;
  const def = ready?.providers.find((p) => p.id === ready.defaultId) ?? null;
  const on = skills.all.filter((s) => skills.enabled.includes(s.id)).length;
  return (
    <section className="mt-8 grid gap-3 sm:grid-cols-2" aria-label="AI setup">
      <Link href="/app/settings/ai" className="lift rounded-xl border bg-surface p-4 hover:border-primary/40" data-testid="card-ai-provider">
        <p className="section-label">Default AI provider</p>
        {state.status === "loading" ? (
          <Skeleton className="mt-2 h-5 w-2/3" />
        ) : state.status === "error" ? (
          <p className="mt-2 text-sm font-semibold text-danger">Couldn't load providers</p>
        ) : def ? (
          <p className="mt-2 truncate text-sm font-semibold">
            {def.label} <span className="font-mono text-xs font-normal text-muted-foreground">· {def.model}</span>
          </p>
        ) : (
          <p className="mt-2 text-sm font-semibold text-warning">None yet — add one to use the agent</p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">Manage keys and models</p>
      </Link>
      <Link href="/app/skills" className="lift rounded-xl border bg-surface p-4 hover:border-primary/40" data-testid="card-skills">
        <p className="section-label">Skills</p>
        <p className="mt-2 text-sm font-semibold tabular">
          {on} of {skills.all.length} enabled
        </p>
        <p className="mt-1 text-xs text-muted-foreground">Guidance Chrono applies to every chat</p>
      </Link>
    </section>
  );
}

export default function HomePage() {
  const { session } = useSession();
  const [, navigate] = useLocation();
  const recent = recentRepos();
  const first = session.mode === "github" ? (session.user.name ?? session.user.login).split(" ")[0] : null;
  const latest = recent[0];
  const newRepo = () => {
    requestNewRepo();
    navigate("/app/projects");
  };

  return (
    <AppShell title="Home">
      <section className="rounded-xl border bg-surface p-5 sm:p-7">
        <h2 className="max-w-xl text-2xl font-semibold tracking-tight sm:text-3xl">{first ? `Welcome back, ${first}.` : "Welcome back."}</h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">Open a repository, ask Chrono to change it, preview the result, and ship it as a commit or pull request.</p>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <Link
            href={latest ? projectPath(latest.owner, latest.name, "ai") : "/app/projects"}
            data-testid="button-start-building"
            className="group flex min-h-12 flex-1 items-center gap-3 rounded-lg border border-primary/30 bg-background px-4 text-left transition-colors hover:border-primary/60"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
              <WandSparkles className="size-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">Ask Chrono to build</span>
              <span className="block truncate text-xs text-muted-foreground">{latest ? `in ${latest.owner}/${latest.name}` : "Pick a repository to start"}</span>
            </span>
            <ArrowRight className="size-4 text-primary transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
          <Button variant="secondary" className="min-h-12" onClick={openCommandPalette} data-testid="button-home-search">
            <Search className="size-4" aria-hidden /> Search <kbd className="ml-1 hidden rounded border px-1.5 font-mono text-[10px] text-muted-foreground md:inline">{isMac() ? "⌘K" : "Ctrl K"}</kbd>
          </Button>
        </div>
      </section>

      <div className="stagger mt-4 grid gap-3 sm:grid-cols-3">
        <QuickAction onClick={newRepo} icon={Plus} title="New repository" description="Create a GitHub repository and open it here." testId="quick-new-repo" />
        <QuickAction href="/app/projects" icon={FolderGit2} title="Browse projects" description="Open any repository you have access to." testId="quick-browse-projects" />
        <QuickAction href="/app/settings/ai" icon={Bot} title="Connect an AI" description="Choose the model that powers your workspace." testId="quick-connect-ai" />
      </div>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="section-label">Continue building</h2>
          <Link href="/app/projects" className="text-xs font-semibold text-primary hover:underline">
            View all
          </Link>
        </div>
        {recent.length ? (
          <ul className="stagger space-y-2">
            {recent.map((r) => (
              <li key={`${r.owner}/${r.name}`}>
                <Link href={projectPath(r.owner, r.name)} data-testid={`card-recent-${r.owner}-${r.name}`} className="lift group flex items-center gap-4 rounded-xl border bg-surface p-4 hover:border-primary/40">
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                    <FolderGit2 className="size-5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      <span className="font-normal text-muted-foreground">{r.owner}/</span>
                      {r.name}
                    </span>
                    <span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="inline-flex min-w-0 items-center gap-1 font-mono">
                        <GitBranch className="size-3 shrink-0" aria-hidden /> <span className="truncate">{r.branch}</span>
                      </span>
                      <span aria-hidden>·</span>
                      <span className="shrink-0">Opened {timeAgo(new Date(r.openedAt))}</span>
                    </span>
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-xl border border-dashed p-6 text-center">
            <FolderGit2 className="mx-auto size-7 text-muted-foreground" aria-hidden />
            <p className="mt-3 text-sm font-semibold">Your next project starts here</p>
            <p className="mt-1 text-xs text-muted-foreground">Open a repository or create a new one.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button asChild>
                <Link href="/app/projects">Browse repositories</Link>
              </Button>
              <Button variant="secondary" onClick={newRepo}>
                <Plus className="size-4" aria-hidden /> New repository
              </Button>
            </div>
          </div>
        )}
      </section>

      <AiStatus />
    </AppShell>
  );
}
