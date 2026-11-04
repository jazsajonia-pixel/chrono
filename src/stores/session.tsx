import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@/types/session";
import type { AuthSessionResponse } from "@/types/github";
import { safeStorage } from "@/lib/storage";
import { api, SESSION_EXPIRED_EVENT } from "@/lib/api";
import { browserNav } from "@/lib/navigate";
import type { ErrorCode } from "@/lib/errors";

/**
 * Client session state.
 *  - github: hydrated from GET /api/auth/session. The GitHub token never enters this store —
 *    it stays in an encrypted HTTP-only cookie that only Netlify Functions can read.
 */

interface SessionContextValue {
  session: Session;
  /** True while the initial /api/auth/session check is in flight. */
  loading: boolean;
  isAuthed: boolean;
  /** Set when the server ended the session (expired/revoked) so sign-in can explain why. */
  endedReason: ErrorCode | null;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/** Removes the flag left by older builds that had a sample workspace. */
function clearLegacyDemoFlag(): void {
  safeStorage.remove("demo-session", "session");
}

/** Same page on the host OAuth is bound to. Keeps path, query and #route. */
function moveToCanonical(origin: string): boolean {
  try {
    const target = new URL(origin);
    if (target.protocol !== "https:" || target.origin === window.location.origin) return false;
    const { pathname, search, hash } = window.location;
    browserNav.replace(`${target.origin}${pathname}${search}${hash}`);
    return true;
  } catch {
    return false;
  }
}

async function fetchGitHubSession(): Promise<Session> {
  try {
    const res = await api<AuthSessionResponse>("/auth/session", { timeoutMs: 8_000 });
    if (!res.authenticated && res.canonicalOrigin && moveToCanonical(res.canonicalOrigin)) return new Promise<Session>(() => {});
    if (res.authenticated) {
      return { mode: "github", user: res.user, scopes: res.scopes, includePrivate: res.includePrivate, expiresAt: res.expiresAt };
    }
  } catch {
    // Backend unreachable → behave as signed out; the sign-in screen surfaces the real error.
  }
  return { mode: "anonymous" };
}

export function SessionProvider({ children, initial }: { children: ReactNode; initial?: Session }) {
  const [session, setSession] = useState<Session>(() => initial ?? { mode: "anonymous" });
  const [loading, setLoading] = useState(() => !initial);
  const [endedReason, setEndedReason] = useState<ErrorCode | null>(null);

  const refresh = useCallback(async () => {
    setSession(await fetchGitHubSession());
  }, []);

  useEffect(() => {
    if (!loading) return;
    let alive = true;
    clearLegacyDemoFlag();
    fetchGitHubSession().then((s) => {
      if (!alive) return;
      setSession(s);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [loading]);

  useEffect(() => {
    const onExpired = (e: Event) => {
      const code = (e as CustomEvent<ErrorCode>).detail;
      setSession((cur) => (cur.mode === "github" ? { mode: "anonymous" } : cur));
      setEndedReason(code === "UNAUTHENTICATED" ? "SESSION_EXPIRED" : code);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  const signOut = useCallback(async () => {
    if (session.mode === "github") {
      try {
        await api("/auth/logout", { method: "POST" });
      } catch {
        // Even if the request fails, drop local state; the cookie expires on its own.
      }
    }
    setEndedReason(null);
    setSession({ mode: "anonymous" });
  }, [session.mode]);

  const value = useMemo<SessionContextValue>(
    () => ({ session, loading, isAuthed: session.mode === "github", endedReason, signOut, refresh }),
    [session, loading, endedReason, signOut, refresh],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>");
  return ctx;
}
