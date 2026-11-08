import { useMemo, useRef, useState, type FormEvent } from "react";
import { BookMarked, Download, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { AppShell, PageIntro } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { BottomSheet } from "@/components/ui/sheet";
import { ConfirmSheet } from "@/components/dialogs";
import { useSession } from "@/stores/session";
import { useKnowledge } from "@/features/knowledge/store";
import { KNOWLEDGE_LIMITS, KnowledgeError, scopeLabel, searchNotes, toMarkdown, type KnowledgeNote, type KnowledgeScope } from "@/lib/knowledge";
import { cn } from "@/lib/utils";

/**
 * Knowledge: facts and preferences the agent remembers between chats.
 * Stored only in this browser, per GitHub account. Each chat sends just the notes that match it.
 */
export default function KnowledgePage() {
  const { session } = useSession();
  const userId = session.mode === "github" ? session.user.id : null;
  const login = session.mode === "github" ? session.user.login : "you";
  const kb = useKnowledge(userId);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<KnowledgeNote | "new" | null>(null);
  const [deleting, setDeleting] = useState<KnowledgeNote | null>(null);
  const [status, setStatus] = useState<string>("");

  const shown = useMemo(() => (query.trim() ? searchNotes(kb.notes, query, KNOWLEDGE_LIMITS.notes) : kb.notes), [kb.notes, query]);
  const groups = useMemo(() => {
    const m = new Map<KnowledgeScope, KnowledgeNote[]>();
    for (const n of shown) m.set(n.scope, [...(m.get(n.scope) ?? []), n]);
    return [...m.entries()].sort(([a], [b]) => (a === "global" ? -1 : b === "global" ? 1 : a.localeCompare(b)));
  }, [shown]);
  const projectScopes = useMemo(() => [...new Set(kb.notes.map((n) => n.scope).filter((s) => s !== "global"))], [kb.notes]);
  const full = kb.notes.length >= KNOWLEDGE_LIMITS.notes;

  const exportAll = () => {
    const blob = new Blob([toMarkdown(kb.notes, login)], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chrono-knowledge-${login}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppShell
      title="Knowledge"
      width="narrow"
      actions={
        <Button size="sm" onClick={() => setEditing("new")} disabled={full || userId === null} data-testid="button-add-note">
          <Plus /> Add note
        </Button>
      }
    >
      <PageIntro>
        What the agent remembers between chats: your preferences, project decisions and lessons learned. Saved only in this browser for @{login}. Each chat sends just the notes that match it.
      </PageIntro>
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>

      <ul className="mb-6 divide-y overflow-hidden rounded-lg border bg-surface">
        <li className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Use in chats</p>
            <p className="text-xs text-muted-foreground">Relevant notes are added to agent requests.</p>
          </div>
          <Switch checked={kb.settings.enabled} onCheckedChange={(v) => kb.updateSettings({ ...kb.settings, enabled: v })} label="Use knowledge in chats" data-testid="switch-knowledge-enabled" />
        </li>
        <li className="flex items-center gap-3 px-4 py-3">
          <div className={cn("min-w-0 flex-1", !kb.settings.enabled && "opacity-60")}>
            <p className="text-sm font-medium">Save automatically</p>
            <p className="text-xs text-muted-foreground">The agent saves new notes itself. Each save shows in the chat with Undo.</p>
          </div>
          <Switch checked={kb.settings.enabled && kb.settings.autoSave} disabled={!kb.settings.enabled} onCheckedChange={(v) => kb.updateSettings({ ...kb.settings, autoSave: v })} label="Save knowledge automatically" data-testid="switch-knowledge-autosave" />
        </li>
      </ul>

      {kb.notes.length ? (
        <div className="mb-4 flex items-center gap-2">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search knowledge</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${kb.notes.length} note${kb.notes.length === 1 ? "" : "s"}`}
              className="h-11 w-full rounded-md border bg-background pl-9 pr-3 text-base focus:border-primary sm:text-sm"
              data-testid="input-knowledge-search"
            />
          </label>
          <Button variant="secondary" onClick={exportAll} data-testid="button-export-knowledge">
            <Download /> Export
          </Button>
        </div>
      ) : null}

      {kb.notes.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center animate-fade" data-testid="empty-knowledge">
          <BookMarked className="mx-auto size-6 text-muted-foreground" aria-hidden />
          <p className="mt-2 text-sm font-medium">No notes yet</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
            {kb.settings.enabled && kb.settings.autoSave ? "The agent adds them as you work. You can also write one — e.g. \"Use pnpm, not npm\"." : "Write one — e.g. \"Use pnpm, not npm\"."}
          </p>
          <Button className="mt-4" size="sm" onClick={() => setEditing("new")} disabled={userId === null} data-testid="button-add-first-note">
            <Plus /> Write a note
          </Button>
        </div>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">No notes match "{query.trim()}".</p>
      ) : (
        groups.map(([scope, notes]) => (
          <section key={scope} className="mb-6" aria-label={scopeLabel(scope)}>
            <h2 className="section-label mb-2">
              {scope === "global" ? "All projects" : <span className="font-mono normal-case">{scopeLabel(scope)}</span>} · {notes.length}
            </h2>
            <ul className="divide-y overflow-hidden rounded-lg border bg-surface" data-testid={`list-knowledge-${scope}`}>
              {notes.map((n) => (
                <li key={n.id} className="flex items-center gap-2 py-2 pl-4 pr-1" data-testid={`row-note-${n.id}`}>
                  <div className="min-w-0 flex-1 py-1">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <span className="truncate">{n.title}</span>
                      {n.source === "agent" ? <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">agent</span> : null}
                    </p>
                    <p className="line-clamp-3 whitespace-pre-line text-xs text-muted-foreground">{n.body}</p>
                  </div>
                  <button type="button" onClick={() => setEditing(n)} aria-label={`Edit ${n.title}`} className="grid size-11 place-items-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground" data-testid={`button-edit-note-${n.id}`}>
                    <Pencil className="size-4" aria-hidden />
                  </button>
                  <button type="button" onClick={() => setDeleting(n)} aria-label={`Delete ${n.title}`} className="grid size-11 place-items-center rounded-md text-muted-foreground hover:bg-danger/10 hover:text-danger" data-testid={`button-delete-note-${n.id}`}>
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      <NoteEditor
        open={editing !== null}
        note={editing === "new" ? null : editing}
        projectScopes={projectScopes}
        onOpenChange={(o) => !o && setEditing(null)}
        onSubmit={(draft) => {
          const store = kb.store();
          if (!store) return "Sign in first.";
          try {
            const target = editing && editing !== "new" ? editing : null;
            store.save({ id: target?.id, ...draft, source: target?.source ?? "you" });
            setStatus(target ? `Saved "${draft.title}"` : `Added "${draft.title}"`);
            setEditing(null);
            return null;
          } catch (err) {
            return err instanceof KnowledgeError ? err.message : "Couldn't save this note.";
          }
        }}
      />
      <ConfirmSheet
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete "${deleting?.title ?? ""}"?`}
        description="The agent will no longer see this note. This can't be undone."
        confirmLabel="Delete note"
        onConfirm={() => {
          if (deleting) {
            kb.store()?.remove(deleting.id);
            setStatus(`Deleted "${deleting.title}"`);
          }
        }}
      />
    </AppShell>
  );
}

type Draft = { title: string; body: string; scope: KnowledgeScope };

function NoteEditor({ open, note, projectScopes, onOpenChange, onSubmit }: { open: boolean; note: KnowledgeNote | null; projectScopes: KnowledgeScope[]; onOpenChange: (o: boolean) => void; onSubmit: (d: Draft) => string | null }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<"global" | "repo">("global");
  const [repo, setRepo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  // Refill whenever the sheet opens or switches note (during render, not in an effect).
  const [filledFor, setFilledFor] = useState<{ open: boolean; note: KnowledgeNote | null }>({ open: false, note: null });
  if (filledFor.open !== open || filledFor.note !== note) {
    setFilledFor({ open, note });
    if (open) {
      const isRepo = !!note && note.scope !== "global";
      setTitle(note?.title ?? "");
      setBody(note?.body ?? "");
      setKind(isRepo ? "repo" : "global");
      setRepo(isRepo ? note.scope.slice("project:".length) : (projectScopes[0]?.slice("project:".length) ?? ""));
      setError(null);
      setTouched(false);
    }
  }
  const titleErr = !title.trim() ? "Give the note a title." : null;
  const bodyErr = !body.trim() ? "Write what the agent should remember." : null;
  const repoErr = kind === "repo" && !/^[\w.-]+\/[\w.-]+$/.test(repo.trim()) ? "Use owner/repo, e.g. octocat/notes-api." : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (titleErr || bodyErr || repoErr) {
      titleRef.current?.focus();
      return;
    }
    setError(onSubmit({ title, body, scope: kind === "global" ? "global" : `project:${repo.trim().toLowerCase()}` }));
  };
  const input = "h-11 w-full rounded-md border bg-background px-3 text-base focus:border-primary sm:text-sm";

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title={note ? "Edit note" : "New note"} description="Something the agent should remember. Don't put passwords or keys here — they're rejected.">
      <form onSubmit={submit} className="space-y-4 pt-1" data-testid="form-note" noValidate>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Applies to</legend>
          <div className="grid grid-cols-2 gap-1 rounded-md bg-surface-2 p-1" role="radiogroup">
            {(["global", "repo"] as const).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={cn("h-9 rounded-sm text-sm", kind === k ? "bg-background font-medium shadow-sm" : "text-muted-foreground")} data-testid={`radio-note-${k}`}>
                {k === "global" ? "All projects" : "One repository"}
              </button>
            ))}
          </div>
        </fieldset>
        {kind === "repo" ? (
          <div>
            <label htmlFor="note-repo" className="mb-1.5 block text-sm font-medium">Repository</label>
            <input id="note-repo" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repo" autoCapitalize="none" spellCheck={false} className={cn(input, "font-mono", touched && repoErr && "border-danger")} data-testid="input-note-repo" />
            {touched && repoErr ? <p className="mt-1 text-xs text-danger">{repoErr}</p> : null}
          </div>
        ) : null}
        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <label htmlFor="note-title" className="text-sm font-medium">Title</label>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground" aria-hidden>{title.length}/{KNOWLEDGE_LIMITS.title}</span>
          </div>
          <input ref={titleRef} id="note-title" value={title} maxLength={KNOWLEDGE_LIMITS.title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Package manager" className={cn(input, touched && titleErr && "border-danger")} data-testid="input-note-title" />
          {touched && titleErr ? <p className="mt-1 text-xs text-danger">{titleErr}</p> : null}
        </div>
        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <label htmlFor="note-body" className="text-sm font-medium">Note</label>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground" aria-hidden>{body.length}/{KNOWLEDGE_LIMITS.body}</span>
          </div>
          <textarea id="note-body" value={body} maxLength={KNOWLEDGE_LIMITS.body} onChange={(e) => setBody(e.target.value)} rows={5} placeholder="e.g. Use pnpm, not npm. Lockfile is pnpm-lock.yaml." className={cn("w-full resize-y rounded-md border bg-background px-3 py-2 text-base leading-relaxed focus:border-primary sm:text-sm", touched && bodyErr && "border-danger")} data-testid="input-note-body" />
          {touched && bodyErr ? <p className="mt-1 text-xs text-danger">{bodyErr}</p> : null}
        </div>
        {error ? <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm" role="alert" data-testid="text-note-error">{error}</p> : null}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" data-testid="button-save-note">{note ? "Save changes" : "Add note"}</Button>
        </div>
      </form>
    </BottomSheet>
  );
}
