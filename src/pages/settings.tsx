import { APP_VERSION } from "@/lib/monitoring";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { ChevronRight, LogOut, Moon, Sparkles, Sun } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { ActiveProviderLink } from "@/features/ai/active-provider";
import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/sheet";
import { BackendStatus } from "@/features/settings/backend-status";
import { useSession } from "@/stores/session";
import { useTheme } from "@/stores/theme";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 first:mt-0">
      <h2 className="section-label mb-2">{title}</h2>
      <div className="rounded-lg border bg-surface p-4">{children}</div>
    </section>
  );
}

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { session, signOut } = useSession();
  const [, navigate] = useLocation();
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <AppShell title="Settings" width="narrow">
      <Section title="Appearance">
        <div role="radiogroup" aria-label="Theme" className="grid grid-cols-2 gap-2">
          {(["dark", "light"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={theme === t}
              onClick={() => setTheme(t)}
              data-testid={`radio-theme-${t}`}
              className="flex h-11 items-center justify-center gap-2 rounded-md border text-sm font-medium aria-checked:border-primary aria-checked:bg-primary/10 aria-checked:text-primary"
            >
              {t === "dark" ? <Moon className="size-4" aria-hidden /> : <Sun className="size-4" aria-hidden />}
              {t === "dark" ? "Dark" : "Light"}
            </button>
          ))}
        </div>
      </Section>

      <section className="mt-6">
        <h2 className="section-label mb-2">AI providers</h2>
        <div className="space-y-2">
          <ActiveProviderLink />
          <Button asChild variant="secondary" className="w-full justify-between" data-testid="button-chrono-flex">
            <Link href="/app/settings/ai">
              <span className="flex items-center gap-2"><Sparkles className="size-4 text-primary" aria-hidden /> Manage providers</span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">Add your own key <ChevronRight className="size-4" aria-hidden /></span>
            </Link>
          </Button>
        </div>
      </section>

      <Section title="Backend">
        <BackendStatus />
      </Section>

      <Section title="Account">
        {session.mode === "github" ? (
          <div className="space-y-3" data-testid="section-github-account">
            <div className="flex items-center gap-3">
              <img src={session.user.avatarUrl} alt="" className="size-10 rounded-full border" referrerPolicy="no-referrer" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{session.user.name ?? session.user.login}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">@{session.user.login}</p>
              </div>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
              <dt className="text-muted-foreground">Access</dt>
              <dd>{session.includePrivate ? "Public and private repositories" : "Public repositories only"}</dd>
              <dt className="text-muted-foreground">Scopes</dt>
              <dd className="font-mono">{session.scopes.join(", ") || "—"}</dd>
              <dt className="text-muted-foreground">Session ends</dt>
              <dd>{new Date(session.expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</dd>
            </dl>
            <p className="text-xs text-muted-foreground">Your token is held in an encrypted HTTP-only cookie and revoked on sign out.</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Not signed in.</p>
        )}
        <Button variant="secondary" className="mt-3 w-full" onClick={() => setConfirmOpen(true)} data-testid="button-signout">
          <LogOut /> Sign out
        </Button>
      </Section>

      <p className="mt-6 text-center font-mono text-[11px] text-muted-foreground">Chrono · v{APP_VERSION} · Phase 8</p>

      <BottomSheet
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Sign out?"
        description="You'll return to the start screen."
      >
        <div className="grid grid-cols-2 gap-2 pt-2">
          <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            data-testid="button-confirm-signout"
            onClick={() => {
              setConfirmOpen(false);
              void signOut().then(() => navigate("/"));
            }}
          >
            Sign out
          </Button>
        </div>
      </BottomSheet>
    </AppShell>
  );
}
