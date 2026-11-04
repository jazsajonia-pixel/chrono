import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { ChevronDown, ChevronLeft, ChevronRight, GitBranch, Lock, Menu, MessageCirclePlus, Play, Search } from "lucide-react";
import { MAIN_NAV, WORKSPACE_NAV_TABS, WORKSPACE_TAB_META, projectPath, type WorkspaceTab } from "@/lib/nav";
import type { ProjectRef } from "@/types/workspace";
import { Badge } from "@/components/ui/badge";
import { useOptionalWorkspace } from "@/features/workspace/context";
import { openCommandPalette } from "@/features/command/palette-store";
import { SkipLink } from "./app-shell";
import { Sidebar, SidebarLink, SidebarSection } from "./sidebar";
import { OfflineBanner } from "./offline-banner";

const APP_LINKS = ["Home", "Projects", "Skills", "Settings"];

export function WorkspaceShell({
  project,
  branch,
  tab,
  onBranchClick,
  gitBadge,
  children,
}: {
  project: ProjectRef;
  branch: string;
  tab: WorkspaceTab;
  onBranchClick?: () => void;
  gitBadge?: number;
  children: ReactNode;
}) {
  const ws = useOptionalWorkspace();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const badge = gitBadge ?? (ws ? ws.changes.length : 0);
  const tabs: WorkspaceTab[] = ["overview", ...WORKSPACE_NAV_TABS];

  return (
    <div className="flex h-dvh min-w-0 flex-col overflow-hidden bg-background md:pl-64">
      <nav aria-label="Accessibility links">
        <SkipLink />
      </nav>
      <Sidebar open={open} onClose={close} label="Workspace navigation">
        <div className="mb-5 rounded-lg border border-sidebar-border bg-background/40 px-3 py-2.5">
          <p className="truncate text-sm font-semibold">{project.name}</p>
          <p className="mt-0.5 truncate font-mono text-[11px] text-sidebar-muted">{project.owner}/{project.name}</p>
        </div>
        <nav aria-label="Workspace">
          <SidebarSection title="Project">
            {tabs.map((t) => {
              const meta = WORKSPACE_TAB_META[t];
              return (
                <SidebarLink
                  key={t}
                  href={projectPath(project.owner, project.name, t)}
                  icon={meta.icon}
                  label={meta.label}
                  active={t === tab}
                  onNavigate={close}
                  testId={`tab-${t}`}
                  trailing={
                    t === "git" && badge > 0 ? (
                      <span data-testid="badge-changes" className="ml-auto rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
                        {badge > 99 ? "99+" : badge}
                      </span>
                    ) : null
                  }
                />
              );
            })}
          </SidebarSection>
        </nav>
        <SidebarSection title="Chrono">
          {MAIN_NAV.filter((i) => APP_LINKS.includes(i.label)).map((i) => (
            <SidebarLink key={i.href} href={i.href} icon={i.icon} label={i.label} active={false} onNavigate={close} />
          ))}
        </SidebarSection>
      </Sidebar>

      <header className="z-30 shrink-0 border-b bg-background pt-safe">
        <OfflineBanner />
        <div className="flex h-14 w-full min-w-0 items-center gap-1.5 px-2 sm:h-16 sm:gap-2 sm:px-5">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open workspace navigation"
            data-testid="button-toggle-workspace-sidebar"
            className="grid size-10 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-surface-2 hover:text-foreground md:hidden"
          >
            <Menu className="size-5" />
          </button>
          <Link
            href="/app/projects"
            aria-label="Back to projects"
            className="hidden size-10 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-surface-2 hover:text-foreground sm:grid"
          >
            <ChevronLeft className="size-5" />
          </Link>
          <div className="min-w-0 flex-1">
            <Link
              href={projectPath(project.owner, project.name, "overview")}
              aria-current={tab === "overview" ? "page" : undefined}
              aria-label={`${project.owner}/${project.name} — project overview`}
              className="flex max-w-full items-center gap-1 truncate text-sm font-semibold hover:text-primary"
              data-testid="link-overview"
            >
              <span data-testid="text-repo-name" className="truncate">
                <span className="text-muted-foreground">{project.owner}/</span>
                {project.name}
              </span>
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
            {onBranchClick ? (
              <button
                type="button"
                onClick={onBranchClick}
                data-testid="button-branch"
                className="-mx-1 flex max-w-full items-center gap-1 rounded px-1 py-0.5 font-mono text-[11px] text-muted-foreground hover:bg-surface-2 hover:text-foreground"
              >
                <GitBranch className="size-3 shrink-0" aria-hidden />
                <span className="truncate" data-testid="text-branch">{branch}</span>
                <ChevronDown className="size-3 shrink-0" aria-hidden />
              </button>
            ) : (
              <p className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground" data-testid="text-branch">
                <GitBranch className="size-3" aria-hidden /> {branch}
              </p>
            )}
          </div>
          {project.visibility === "private" ? (
            <Badge className="hidden sm:inline-flex">
              <Lock className="size-3" aria-hidden /> Private
            </Badge>
          ) : null}
          <button
            type="button"
            onClick={openCommandPalette}
            aria-label="Search files and commands"
            data-testid="button-workspace-search"
            className="grid size-10 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-surface-2 hover:text-foreground"
          >
            <Search className="size-[18px]" />
          </button>
          {tab !== "preview" ? (
            <Link
              href={projectPath(project.owner, project.name, "preview")}
              data-testid="button-header-preview"
              className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground transition-[background-color,transform] hover:bg-primary/90 active:scale-[0.97]"
            >
              <Play className="size-3.5 fill-current" aria-hidden /> <span className="hidden min-[400px]:inline">Preview</span>
            </Link>
          ) : null}
        </div>
      </header>
      <main id="main" tabIndex={-1} className="relative mx-auto flex min-h-0 w-full min-w-0 max-w-6xl flex-1 flex-col overflow-y-auto outline-none">
        {children}
        {/* Hidden on AI (it is the chat) and Preview (it would cover the running app). */}
        {tab !== "ai" && tab !== "preview" ? (
          <Link
            href={projectPath(project.owner, project.name, "ai")}
            aria-label={`Start a new AI chat for ${project.name}`}
            title="New AI chat"
            data-testid="floating-new-ai-chat"
            className="animate-pop fixed bottom-5 right-5 z-40 grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-black/25 transition-transform active:scale-95 sm:bottom-7 sm:right-7"
          >
            <MessageCirclePlus className="size-6" aria-hidden />
          </Link>
        ) : null}
      </main>
    </div>
  );
}
