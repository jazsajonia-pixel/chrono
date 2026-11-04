import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { ChevronLeft, ChevronRight, Loader2, Paperclip, Plus, WandSparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { AppError, describeError } from "@/lib/errors";
import { useSkills } from "@/features/skills/use-skills";

type View = "menu" | "skills";

/**
 * The composer's "+" button: rotates into an ×, and a small menu grows out of it with
 * Skills / Add files. "Skills" swaps the menu for the skills list (toggle on/off, or add new).
 */
export function PlusMenu({ onAddFiles, disabled }: { onAddFiles: () => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("menu");
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const skills = useSkills();
  const [toggleError, setToggleError] = useState<string | null>(null);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Move focus into the menu when it opens or switches view (keyboard users land on the first item).
  useEffect(() => {
    if (open) requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus());
  }, [open, view]);

  const enabledCount = skills.all.filter((s) => skills.enabled.includes(s.id)).length;

  return (
    <div ref={root} className="relative shrink-0">
      <button
        ref={button}
        type="button"
        onClick={() => {
          setView("menu");
          setToggleError(null);
          setOpen((o) => !o);
        }}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={open ? "Close chat tools" : "More chat tools"}
        data-testid="button-chat-plus"
        className={cn(
          "grid size-9 place-items-center rounded-lg border text-muted-foreground transition-[color,background-color,border-color] hover:text-foreground disabled:opacity-50",
          open && "border-primary/50 bg-primary/10 text-primary",
        )}
      >
        <Plus className={cn("size-4 transition-transform duration-base", open && "rotate-45")} aria-hidden />
      </button>

      {open ? (
        <div
          ref={panel}
          className="animate-pop absolute bottom-full left-0 z-30 mb-2 w-[min(18rem,calc(100vw-2rem))] origin-bottom-left overflow-hidden rounded-xl border bg-surface shadow-xl shadow-black/20"
          data-testid="chat-tools-menu"
        >
          {view === "menu" ? (
            <div role="menu" aria-label="Chat tools" className="animate-view p-1.5">
              <button
                type="button"
                role="menuitem"
                data-autofocus
                onClick={() => setView("skills")}
                className="flex h-11 w-full items-center gap-3 rounded-lg px-2.5 text-left text-sm hover:bg-surface-2 focus-visible:bg-surface-2"
                data-testid="button-chat-skills"
              >
                <span className="grid size-7 place-items-center rounded-md bg-primary/10 text-primary">
                  <WandSparkles className="size-4" aria-hidden />
                </span>
                <span className="flex-1">
                  Skills
                  <span className="block text-[11px] text-muted-foreground">{enabledCount} enabled</span>
                </span>
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  close(false);
                  onAddFiles();
                }}
                className="flex h-11 w-full items-center gap-3 rounded-lg px-2.5 text-left text-sm hover:bg-surface-2 focus-visible:bg-surface-2"
                data-testid="button-agent-upload"
              >
                <span className="grid size-7 place-items-center rounded-md bg-surface-2 text-muted-foreground">
                  <Paperclip className="size-4" aria-hidden />
                </span>
                <span className="flex-1">
                  Add files
                  <span className="block text-[11px] text-muted-foreground">Images or text, up to 2 MB each</span>
                </span>
              </button>
            </div>
          ) : (
            <div className="animate-view" data-testid="chat-skills-list">
              <div className="flex items-center gap-1 border-b px-1.5 py-1.5">
                <button
                  type="button"
                  onClick={() => setView("menu")}
                  aria-label="Back to chat tools"
                  data-testid="button-skills-back"
                  className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <p className="flex-1 text-sm font-semibold">Skills</p>
                {skills.saving || skills.status === "loading" ? <Loader2 className="mr-2 size-3.5 animate-spin text-muted-foreground" aria-label="Syncing" /> : null}
              </div>
              <ul className="max-h-64 overflow-y-auto p-1.5" aria-label="Skills">
                {skills.all.map((s, i) => {
                  const on = skills.enabled.includes(s.id);
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={on}
                        {...(i === 0 ? { "data-autofocus": true } : {})}
                        onClick={() => {
                          setToggleError(null);
                          skills.toggle(s.id).catch((e: unknown) => setToggleError(e instanceof AppError ? e.message || describeError(e).title : "Couldn't save."));
                        }}
                        className="flex min-h-10 w-full items-center gap-3 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-surface-2 focus-visible:bg-surface-2"
                        data-testid={`skill-toggle-${s.id}`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{s.name}</span>
                          {s.id.startsWith("u_") ? <span className="block text-[10px] uppercase tracking-wide text-primary">Custom</span> : null}
                        </span>
                        <span className={cn("relative h-5 w-8 shrink-0 rounded-full border transition-colors", on ? "border-primary bg-primary" : "bg-surface-2")} aria-hidden>
                          <span className={cn("absolute top-0.5 size-3.5 rounded-full bg-background shadow transition-transform", on ? "translate-x-[14px]" : "translate-x-0.5")} />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {toggleError ? (
                <p role="alert" className="px-3 pb-2 text-xs text-danger">
                  {toggleError}
                </p>
              ) : null}
              <div className="border-t p-1.5">
                <Link
                  href="/app/skills"
                  onClick={() => close(false)}
                  className="flex h-10 items-center justify-center gap-2 rounded-lg text-sm font-medium text-primary hover:bg-primary/10"
                  data-testid="link-add-skills"
                >
                  <Plus className="size-4" aria-hidden /> Add skills
                </Link>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
