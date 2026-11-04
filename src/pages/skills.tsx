import { useEffect, useRef, useState, type FormEvent } from "react";
import { Cloud, HardDrive, Pencil, Plus, Sparkles, Trash2, Wand2 } from "lucide-react";
import { AppShell, PageIntro } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { BottomSheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmSheet } from "@/components/dialogs";
import { ErrorState } from "@/components/states";
import { useSkills, type SkillDraft } from "@/features/skills/use-skills";
import { BUILTIN_SKILLS, SKILL_LIMITS, cleanSkillText, type UserSkill } from "@/lib/skills";
import { describeError } from "@/lib/errors";
import { cn } from "@/lib/utils";

/**
 * Skills: reusable guidance added to the agent's instructions.
 * Built-ins can be switched on/off; custom skills are written here and synced to the account.
 */
export default function SkillsPage() {
  const skills = useSkills();
  const [editing, setEditing] = useState<UserSkill | "new" | null>(null);
  const [deleting, setDeleting] = useState<UserSkill | null>(null);
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const atLimit = skills.custom.length >= SKILL_LIMITS.maxCustom;

  useEffect(() => {
    if (!status || status.tone === "error") return;
    const t = window.setTimeout(() => setStatus(null), 3000);
    return () => window.clearTimeout(t);
  }, [status]);

  const run = async (p: Promise<unknown>, ok: string) => {
    try {
      await p;
      setStatus({ tone: "ok", text: ok });
      return true;
    } catch (err) {
      setStatus({ tone: "error", text: (() => { const d = describeError(err); return `${d.title}. ${d.hint}`; })() });
      return false;
    }
  };

  const toggle = (id: string, name: string, on: boolean) => void run(skills.toggle(id), `${name} ${on ? "enabled" : "disabled"}`);

  return (
    <AppShell
      title="Skills"
      width="narrow"
      actions={
        <Button size="sm" onClick={() => setEditing("new")} disabled={atLimit} data-testid="button-add-skill">
          <Plus /> Add skill
        </Button>
      }
    >
      <PageIntro>
        Reusable guidance Chrono adds to every AI request. Enabled skills shape how the agent works — they never change what it's allowed to do.
      </PageIntro>

      <p role="status" aria-live="polite" className="sr-only">
        {status?.text ?? ""}
      </p>
      {status ? (
        <div
          className={cn("mb-4 rounded-md border px-3 py-2 text-sm animate-pop", status.tone === "ok" ? "border-success/40 bg-success/10 text-foreground" : "border-danger/40 bg-danger/10 text-foreground")}
          data-testid={status.tone === "ok" ? "text-skills-saved" : "text-skills-error"}
        >
          {status.text}
        </div>
      ) : null}

      <section aria-labelledby="builtin-heading" className="mb-8">
        <h2 id="builtin-heading" className="section-label mb-2">
          Built-in
        </h2>
        <ul className="stagger divide-y overflow-hidden rounded-lg border bg-surface" data-testid="list-builtin-skills">
          {BUILTIN_SKILLS.map((s) => {
            const on = skills.enabled.includes(s.id);
            return (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                  <Sparkles className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{s.name}</p>
                  <p className="text-xs text-muted-foreground">{s.description}</p>
                </div>
                <Switch checked={on} onCheckedChange={(next) => toggle(s.id, s.name, next)} label={`${s.name} skill`} data-testid={`switch-skill-${s.id}`} />
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="custom-heading">
        <div className="mb-2 flex items-end justify-between gap-3">
          <h2 id="custom-heading" className="section-label">
            Your skills <span className="font-mono normal-case">{skills.custom.length}/{SKILL_LIMITS.maxCustom}</span>
          </h2>
          <StorageNote storage={skills.storage} />
        </div>

        {skills.status === "loading" && skills.custom.length === 0 ? (
          <div className="space-y-2" aria-label="Loading your skills">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : skills.status === "error" && skills.custom.length === 0 ? (
          <ErrorState error={skills.error} onRetry={() => void skills.reload()} />
        ) : skills.custom.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center animate-fade" data-testid="empty-custom-skills">
            <Wand2 className="mx-auto size-6 text-muted-foreground" aria-hidden />
            <p className="mt-2 text-sm font-medium">No custom skills yet</p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
              Write your own — e.g. "Use our design tokens", "Prefer Zod for validation", or your team's commit style.
            </p>
            <Button className="mt-4" size="sm" onClick={() => setEditing("new")} data-testid="button-add-first-skill">
              <Plus /> Write a skill
            </Button>
          </div>
        ) : (
          <ul className="stagger divide-y overflow-hidden rounded-lg border bg-surface" data-testid="list-custom-skills">
            {skills.custom.map((s) => {
              const on = skills.enabled.includes(s.id);
              return (
                <li key={s.id} className="flex items-center gap-2 py-2 pl-4 pr-1" data-testid={`row-skill-${s.id}`}>
                  <div className="min-w-0 flex-1 py-1">
                    <p className="truncate text-sm font-medium">{s.name}</p>
                    <p className="line-clamp-2 text-xs text-muted-foreground">{s.description || s.instructions}</p>
                  </div>
                  <button type="button" onClick={() => setEditing(s)} aria-label={`Edit ${s.name}`} className="grid size-11 place-items-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground" data-testid={`button-edit-skill-${s.id}`}>
                    <Pencil className="size-4" aria-hidden />
                  </button>
                  <button type="button" onClick={() => setDeleting(s)} aria-label={`Delete ${s.name}`} className="grid size-11 place-items-center rounded-md text-muted-foreground hover:bg-danger/10 hover:text-danger" data-testid={`button-delete-skill-${s.id}`}>
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                  <Switch checked={on} onCheckedChange={(next) => toggle(s.id, s.name, next)} label={`${s.name} skill`} data-testid={`switch-skill-${s.id}`} />
                </li>
              );
            })}
          </ul>
        )}
        {atLimit ? <p className="mt-2 text-xs text-muted-foreground">You've reached the limit of {SKILL_LIMITS.maxCustom} custom skills. Delete one to add another.</p> : null}
      </section>

      <SkillEditor
        open={editing !== null}
        skill={editing === "new" ? null : editing}
        onOpenChange={(o) => !o && setEditing(null)}
        onSubmit={async (draft) => {
          const target = editing;
          const ok = await run(target && target !== "new" ? skills.update(target.id, draft) : skills.create(draft), target && target !== "new" ? `Saved "${draft.name}"` : `Added "${draft.name}"`);
          if (ok) setEditing(null);
          return ok;
        }}
      />

      <ConfirmSheet
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete "${deleting?.name ?? ""}"?`}
        description="The agent will stop using it. This can't be undone."
        confirmLabel="Delete skill"
        onConfirm={async () => {
          if (deleting) await run(skills.remove(deleting.id), `Deleted "${deleting.name}"`);
        }}
      />
    </AppShell>
  );
}

function StorageNote({ storage }: { storage: "database" | "session" | null }) {
  if (!storage) return null;
  const db = storage === "database";
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground" data-testid="text-skills-storage">
      {db ? <Cloud className="size-3.5" aria-hidden /> : <HardDrive className="size-3.5" aria-hidden />}
      {db ? "Synced to your account" : "Saved for this sign-in only"}
    </span>
  );
}

function SkillEditor({
  open,
  skill,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  skill: UserSkill | null;
  onOpenChange: (o: boolean) => void;
  onSubmit: (draft: SkillDraft) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName(skill?.name ?? "");
    setDescription(skill?.description ?? "");
    setInstructions(skill?.instructions ?? "");
    setTouched(false);
    setBusy(false);
  }, [open, skill]);

  const nameErr = !name.trim() ? "Give the skill a name." : null;
  const instrErr = !instructions.trim() ? "Write what the agent should do." : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (nameErr || instrErr) {
      nameRef.current?.focus();
      return;
    }
    setBusy(true);
    const ok = await onSubmit({
      name: cleanSkillText(name, SKILL_LIMITS.name),
      description: cleanSkillText(description, SKILL_LIMITS.description),
      instructions: cleanSkillText(instructions, SKILL_LIMITS.instructions),
    });
    if (!ok) setBusy(false);
  };

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title={skill ? "Edit skill" : "New skill"} description="Plain-language guidance the agent follows in every chat.">
      <form onSubmit={submit} className="space-y-4 pt-1" data-testid="form-skill" noValidate>
        <Field label="Name" count={name.length} max={SKILL_LIMITS.name} error={touched ? nameErr : null} id="skill-name">
          <input
            ref={nameRef}
            id="skill-name"
            value={name}
            maxLength={SKILL_LIMITS.name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Our API conventions"
            aria-invalid={touched && !!nameErr}
            aria-describedby={touched && nameErr ? "skill-name-error" : undefined}
            className={cn("h-11 w-full rounded-md border bg-background px-3 text-base focus:border-primary sm:text-sm", touched && nameErr && "border-danger")}
            data-testid="input-skill-name"
          />
        </Field>
        <Field label="Short description" optional count={description.length} max={SKILL_LIMITS.description} id="skill-description">
          <input
            id="skill-description"
            value={description}
            maxLength={SKILL_LIMITS.description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Shown in the skills list"
            className="h-11 w-full rounded-md border bg-background px-3 text-base focus:border-primary sm:text-sm"
            data-testid="input-skill-description"
          />
        </Field>
        <Field label="Instructions" count={instructions.length} max={SKILL_LIMITS.instructions} error={touched ? instrErr : null} id="skill-instructions">
          <textarea
            id="skill-instructions"
            value={instructions}
            maxLength={SKILL_LIMITS.instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={6}
            placeholder="e.g. Validate request bodies with Zod. Return errors as { error: { code, message } }. Never log tokens."
            aria-invalid={touched && !!instrErr}
            aria-describedby={touched && instrErr ? "skill-instructions-error" : undefined}
            className={cn("w-full resize-y rounded-md border bg-background px-3 py-2 text-base leading-relaxed focus:border-primary sm:text-sm", touched && instrErr && "border-danger")}
            data-testid="input-skill-instructions"
          />
        </Field>
        <div className="grid grid-cols-2 gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy} data-testid="button-save-skill">
            {busy ? "Saving…" : skill ? "Save changes" : "Add skill"}
          </Button>
        </div>
      </form>
    </BottomSheet>
  );
}

function Field({ label, optional, count, max, error, id, children }: { label: string; optional?: boolean; count: number; max: number; error?: string | null; id: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          {label} {optional ? <span className="font-normal text-muted-foreground">(optional)</span> : null}
        </label>
        <span className={cn("font-mono text-[11px] tabular-nums text-muted-foreground", count >= max && "text-warning")} aria-hidden>
          {count}/{max}
        </span>
      </div>
      {children}
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
