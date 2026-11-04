import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { Link } from "wouter";
import { Moon, Search, Sun, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Wordmark } from "@/components/brand";
import { useTheme } from "@/stores/theme";
import { openCommandPalette } from "@/features/command/palette-store";

/**
 * One sidebar for the whole app: an opaque, theme-aware panel (fixed rail on md+, drawer on phones).
 * Both the app shell and the workspace shell render it so they look and behave the same.
 */
export function Sidebar({
  open,
  onClose,
  label,
  homeHref = "/app",
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  homeHref?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  // Esc closes the phone drawer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const { theme, toggle } = useTheme();
  const desktop = useIsDesktop();
  // On phones a closed drawer is off-screen: keep it out of the tab order and the accessibility tree.
  const hidden = !open && !desktop;
  return (
    <>
      {open ? (
        <button type="button" aria-label="Close navigation" className="animate-fade fixed inset-0 z-40 bg-black/50 md:hidden" onClick={onClose} />
      ) : null}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform ease-out md:translate-x-0",
          // Enter at the slow duration, leave faster.
          open ? "translate-x-0 shadow-2xl shadow-black/30 duration-slow" : "-translate-x-full duration-base",
        )}
        aria-label={label}
        data-state={open || desktop ? "open" : "closed"}
        {...(hidden ? { inert: "", "aria-hidden": true } : {})}
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-sidebar-border px-4">
          <Link href={homeHref} onClick={onClose} aria-label="Chrono home" className="rounded-md">
            <Wordmark />
          </Link>
          <button
            type="button"
            className="grid size-10 place-items-center rounded-lg text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground md:hidden"
            aria-label="Close navigation"
            onClick={onClose}
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="px-3 pt-4">
          <button
            type="button"
            onClick={() => {
              onClose();
              openCommandPalette();
            }}
            data-testid="button-open-palette"
            className="flex h-10 w-full items-center gap-2 rounded-lg border border-sidebar-border bg-background/60 px-3 text-left text-sm text-sidebar-muted transition-colors hover:border-primary/50 hover:text-sidebar-foreground"
          >
            <Search className="size-4" aria-hidden />
            <span className="flex-1">Search or jump to…</span>
            <kbd className="rounded border border-sidebar-border px-1.5 py-0.5 font-mono text-[10px]">{isMac() ? "⌘K" : "Ctrl K"}</kbd>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-5">{children}</div>
        <div className="shrink-0 space-y-2 border-t border-sidebar-border p-3">
          {footer}
          <button
            type="button"
            onClick={toggle}
            data-testid="button-toggle-theme"
            className="flex h-10 w-full items-center gap-2.5 rounded-lg px-3 text-sm text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            {theme === "dark" ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
        </div>
      </aside>
    </>
  );
}

export function SidebarSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-6 last:mb-0">
      <p className="mb-2 px-3 section-label !text-sidebar-muted">{title}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

export function SidebarLink({
  href,
  icon: Icon,
  label,
  active,
  onNavigate,
  testId,
  trailing,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  active: boolean;
  onNavigate?: () => void;
  testId?: string;
  trailing?: ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      data-testid={testId}
      className={cn(
        "group relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
        active ? "bg-primary/10 text-primary" : "text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary transition-transform",
          active ? "scale-y-100" : "scale-y-0",
        )}
      />
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
      {trailing}
    </Link>
  );
}

export function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

const DESKTOP = "(min-width: 768px)";
function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia?.(DESKTOP);
      mq?.addEventListener?.("change", cb);
      return () => mq?.removeEventListener?.("change", cb);
    },
    () => window.matchMedia?.(DESKTOP).matches ?? true,
    () => true,
  );
}
