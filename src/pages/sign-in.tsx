import { useEffect, useRef, useState } from "react";
import { Link, Redirect } from "wouter";
import { ChevronLeft, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GitHubIcon, LogoMark } from "@/components/brand";
import { ErrorState } from "@/components/states";
import { useSession } from "@/stores/session";
import { takeAuthError, takeSignInHandoff, useGitHubSignIn } from "@/features/auth/github-sign-in";
import { AppError, isErrorCode } from "@/lib/errors";

export default function SignInPage() {
  const { isAuthed, loading, endedReason, session } = useSession();
  const { start, pending, error } = useGitHubSignIn();
  // Another host sent us here mid-sign-in (see useGitHubSignIn): carry on without a second click.
  const [handoff] = useState(takeSignInHandoff);
  const [includePrivate, setIncludePrivate] = useState(() => handoff?.includePrivate ?? false);
  // Errors reported by the OAuth callback (?auth_error=CODE) or a server-ended session.
  const [callbackError] = useState(() => {
    const code = takeAuthError();
    return code ? new AppError(isErrorCode(code) ? code : "INTERNAL") : null;
  });

  const handoffStarted = useRef(false);
  useEffect(() => {
    if (!handoff || loading || isAuthed || handoffStarted.current) return;
    handoffStarted.current = true;
    void start(handoff.includePrivate);
  }, [handoff, loading, isAuthed, start]);

  if (!loading && isAuthed && session.mode === "github") return <Redirect to="/app/projects" replace />;

  const shownError = error ?? callbackError ?? (endedReason ? new AppError(endedReason) : null);

  return (
    <div className="flex min-h-dvh flex-col px-4 pb-safe pt-safe">
      <nav className="flex h-14 items-center" aria-label="Back">
        <Link href="/" aria-label="Back to home" className="-ml-2 grid size-11 place-items-center rounded-md text-muted-foreground hover:bg-surface-2">
          <ChevronLeft className="size-5" />
        </Link>
      </nav>

      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center pb-16 animate-enter">
        <LogoMark className="size-10" />
        <h1 className="mt-6 text-xl font-semibold tracking-tight">Sign in to Chrono</h1>
        <p className="mt-2 text-sm text-muted-foreground">Connect GitHub to open your repositories. We never ask for your GitHub password.</p>

        <div className="mt-8 space-y-3">
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border bg-surface p-3">
            <input
              type="checkbox"
              checked={includePrivate}
              onChange={(e) => setIncludePrivate(e.target.checked)}
              data-testid="checkbox-include-private"
              className="mt-0.5 size-5 shrink-0 accent-[hsl(var(--primary))]"
            />
            <span className="text-sm">
              <span className="font-medium">Include private repositories</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Requests GitHub's <code className="font-mono">repo</code> scope. Leave off to grant public repositories only (
                <code className="font-mono">public_repo</code>).
              </span>
            </span>
          </label>

          <Button size="lg" className="w-full" onClick={() => void start(includePrivate)} disabled={pending} data-testid="button-github-signin">
            <GitHubIcon /> {pending ? "Redirecting to GitHub…" : "Continue with GitHub"}
          </Button>
          {shownError ? <ErrorState error={shownError} /> : null}
        </div>

        <p className="mt-8 flex gap-2 text-xs leading-relaxed text-muted-foreground">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Your GitHub token stays on the server in an encrypted, HTTP-only cookie. It is never exposed to browser JavaScript, and it's revoked when you sign out.
        </p>
      </main>
    </div>
  );
}
