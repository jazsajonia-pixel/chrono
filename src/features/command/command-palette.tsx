import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import { CornerDownLeft, FileCode2, FolderGit2, LogOut, MessageSquarePlus, Moon, Plus, Search, Sun, type LucideIcon } from "lucide-react";
import { MAIN_NAV, projectPath } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { useSession } from "@/stores/session";
import { useTheme } from "@/stores/theme";
import { githubApi } from "@/features/github/api";
import { recentRepos } from "@/features/github/recent";
import type { RepoSummary } from "@/types/github";
import { closeCommandPalette, requestNewRepo, toggleCommandPalette, usePaletteState } from "./palette-store";

interface Item {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  /** Extra text matched by the search. */
  keywords?: string;
  run: () => void;
}

/** Simple ranked match: prefix > word start > substring > in-order characters. 0 = no match. */
export function score(text: string, query: string): number {
  if (!query) return 1;
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (t.startsWith(q)) return 4;
  if (t.includes(` ${q}`) || t.includes(`/${q}`)) return 3;
  if (t.includes(q)) return 2;
  let i = 0;
  for (const ch of t) if (ch === q[i]) i++;
  return i === q.length ? 1 : 0;
}

const GROUP_LIMIT: Record<string, number> = { Files: 8, Repositories: 6 };

// Repo list fetched once per page load when the palette first opens.
let repoCache: Promise<RepoSummary[]> | null = null;

/** Global ⌘K / Ctrl+K palette: pages, actions, repositories and (inside a workspace) files. */
export function CommandPalette() {
  const { open, files } = usePaletteState();
  const { session, isAuthed, signOut } = useSession();
  const { theme, toggle } = useTheme();
  const [location, navigate] = useLocation();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const listId = useId();

  // Global shortcut (signed-in app only, so the landing page stays untouched).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        if (!isAuthed) return;
        e.preventDefault();
        toggleCommandPalette();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isAuthed]);

  useEffect(() => {
    if (!open) return;
    restoreFocus.current = document.activeElement as HTMLElement | null;
    setQuery("");
    setActive(0);
    requestAnimationFrame(() => inputRef.current?.focus());
    if (isAuthed) {
      repoCache ??= githubApi.repos(1).then((r) => r.repos).catch(() => {
        repoCache = null;
        return [];
      });
      void repoCache.then(setRepos);
    }
    return () => restoreFocus.current?.focus?.();
  }, [open, isAuthed]);

  // Close if the user signs out or navigates elsewhere by other means.
  useEffect(() => {
    if (!isAuthed) closeCommandPalette();
  }, [isAuthed]);

  const workspace = /^\/app\/projects\/([^/]+)\/([^/]+)/.exec(location);

  const items = useMemo<Item[]>(() => {
    const go = (href: string) => () => navigate(href);
    const out: Item[] = [];
    out.push({
      id: "action-new-chat",
      group: "Actions",
      label: workspace ? "New AI chat in this project" : "New AI chat",
      icon: MessageSquarePlus,
      keywords: "ask agent assistant",
      run: go(workspace ? projectPath(decodeURIComponent(workspace[1]!), decodeURIComponent(workspace[2]!), "ai") : "/app/ai"),
    });
    out.push({
      id: "action-new-repo",
      group: "Actions",
      label: "Create new repository",
      icon: Plus,
      keywords: "github repo project add",
      run: () => {
        requestNewRepo();
        navigate("/app/projects");
      },
    });
    out.push({
      id: "action-theme",
      group: "Actions",
      label: theme === "dark" ? "Switch to light mode" : "Switch to dark mode",
      icon: theme === "dark" ? Sun : Moon,
      keywords: "theme appearance",
      run: toggle,
    });
    for (const n of MAIN_NAV) out.push({ id: `page-${n.href}`, group: "Go to", label: n.label, hint: "Page", icon: n.icon, run: go(n.href) });
    out.push({ id: "page-ai-providers", group: "Go to", label: "AI providers", hint: "Settings", icon: MAIN_NAV.find((n) => n.label === "Settings")!.icon, keywords: "api key model", run: go("/app/settings/ai") });

    const seen = new Set<string>();
    const repoItem = (owner: string, name: string, hint?: string): Item => ({
      id: `repo-${owner}/${name}`,
      group: "Repositories",
      label: `${owner}/${name}`,
      hint,
      icon: FolderGit2,
      run: go(projectPath(owner, name)),
    });
    for (const r of recentRepos()) {
      seen.add(`${r.owner}/${r.name}`);
      out.push(repoItem(r.owner, r.name, "Recent"));
    }
    for (const r of repos) if (!seen.has(r.fullName)) out.push(repoItem(r.owner, r.name, r.private ? "Private" : undefined));

    if (files) {
      for (const p of files.paths) {
        out.push({ id: `file-${p}`, group: "Files", label: p, hint: files.label, icon: FileCode2, run: () => files.open(p) });
      }
    }
    if (session.mode === "github") {
      out.push({ id: "action-signout", group: "Actions", label: "Sign out", icon: LogOut, run: () => void signOut().then(() => navigate("/signin")) });
    }
    return out;
  }, [navigate, workspace?.[1], workspace?.[2], theme, toggle, repos, files, session.mode, signOut]); // eslint-disable-line react-hooks/exhaustive-deps

  const results = useMemo(() => {
    const q = query.trim();
    const scored = items
      .map((it) => ({ it, s: Math.max(score(it.label, q), it.keywords ? score(it.keywords, q) * 0.9 : 0) }))
      .filter((x) => x.s > 0);
    // Without a query, files are noise — show them only when searching.
    const visible = q ? scored : scored.filter((x) => x.it.group !== "Files");
    if (q) visible.sort((a, b) => b.s - a.s);
    const perGroup = new Map<string, number>();
    const capped = visible.filter(({ it }) => {
      const n = (perGroup.get(it.group) ?? 0) + 1;
      perGroup.set(it.group, n);
      return n <= (GROUP_LIMIT[it.group] ?? 20);
    });
    // Keep groups together in a stable order, best group first.
    const order = [...new Set(capped.map((x) => x.it.group))];
    return order.flatMap((g) => capped.filter((x) => x.it.group === g).map((x) => x.it));
  }, [items, query]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const run = (it: Item | undefined) => {
    if (!it) return;
    closeCommandPalette();
    it.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (results.length ? (a + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (results.length ? (a - 1 + results.length) % results.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(results[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeCommandPalette();
    } else if (e.key === "Tab") {
      // Single focus stop — keep focus in the dialog.
      e.preventDefault();
    }
  };

  let lastGroup = "";
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-3 pt-[12vh] sm:pt-[15vh]" data-testid="command-palette">
      <button type="button" aria-label="Close command palette" tabIndex={-1} className="animate-fade absolute inset-0 bg-black/50" onClick={closeCommandPalette} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="animate-pop relative flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border bg-surface shadow-2xl shadow-black/40"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={files ? "Search pages, repositories, files…" : "Search pages, repositories, actions…"}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
            aria-autocomplete="list"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            data-testid="input-palette"
            className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground sm:text-sm"
          />
          <kbd className="hidden rounded border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:block">Esc</kbd>
        </div>
        <ul ref={listRef} id={listId} role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto p-1.5" data-testid="list-palette">
          {results.length === 0 ? (
            <li className="px-3 py-8 text-center text-sm text-muted-foreground" role="presentation">
              No results for “{query}”
            </li>
          ) : (
            results.map((it, i) => {
              const header = it.group !== lastGroup ? it.group : null;
              lastGroup = it.group;
              return (
                <li key={it.id} role="presentation">
                  {header ? (
                    <p className="px-2.5 pb-1 pt-2.5 section-label" aria-hidden>
                      {header}
                    </p>
                  ) : null}
                  <div
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    data-index={i}
                    data-testid={`palette-item-${it.id}`}
                    onMouseMove={() => i !== active && setActive(i)}
                    onClick={() => run(it)}
                    className={cn(
                      "flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-sm",
                      i === active ? "bg-primary/10 text-foreground" : "text-foreground/90",
                    )}
                  >
                    <it.icon className={cn("size-4 shrink-0", i === active ? "text-primary" : "text-muted-foreground")} aria-hidden />
                    <span className={cn("min-w-0 flex-1 truncate", it.group === "Files" && "font-mono text-[13px]")}>{it.label}</span>
                    {it.hint ? <span className="hidden shrink-0 truncate text-xs text-muted-foreground sm:block">{it.hint}</span> : null}
                    {i === active ? <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /> : null}
                  </div>
                </li>
              );
            })
          )}
        </ul>
        <div className="hidden items-center gap-4 border-t px-3 py-2 text-[11px] text-muted-foreground sm:flex">
          <span><kbd className="font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono">↵</kbd> open</span>
          <span><kbd className="font-mono">esc</kbd> close</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
