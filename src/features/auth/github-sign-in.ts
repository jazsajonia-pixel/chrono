import { useCallback, useState } from "react";
import { api } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { browserNav } from "@/lib/navigate";

/** Origins we're willing to send the browser to for OAuth (github.com, or a configured GHE/mock). */
export function allowedOAuthOrigins(): string[] {
  const extra = import.meta.env.VITE_GITHUB_WEB_URL as string | undefined;
  return ["https://github.com", ...(extra ? [new URL(extra).origin] : [])];
}

/**
 * Starts GitHub OAuth: POST /api/auth/github/start sets a sealed, HTTP-only `state` cookie and
 * returns the authorize URL; we then navigate there. GitHub redirects back to
 * /api/auth/github/callback, which exchanges the code server-side.
 */
export function useGitHubSignIn() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const start = useCallback(async (includePrivate: boolean) => {
    setPending(true);
    setError(null);
    try {
      const { authorizeUrl } = await api<{ authorizeUrl: string }>("/auth/github/start", {
        method: "POST",
        body: { includePrivate },
      });
      const url = new URL(authorizeUrl);
      if (!allowedOAuthOrigins().includes(url.origin)) throw new AppError("OAUTH_EXCHANGE_FAILED", "Unexpected OAuth origin");
      // GitHub returns to redirect_uri's host. If that's not this host, the state cookie we just got
      // won't be sent there and the first attempt fails — restart sign-in on that host instead.
      const callbackOrigin = safeOrigin(url.searchParams.get("redirect_uri"));
      if (callbackOrigin && callbackOrigin !== window.location.origin && callbackOrigin.startsWith("https://")) {
        browserNav.assign(`${callbackOrigin}/?${SIGNIN_PARAM}=github${includePrivate ? "&private=1" : ""}#/signin`);
        return;
      }
      browserNav.assign(url.toString());
    } catch (err) {
      setError(err);
      setPending(false);
    }
  }, []);

  return { start, pending, error };
}

const SIGNIN_PARAM = "signin";

function safeOrigin(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** Reads and clears `?signin=github[&private=1]` (a hand-off from another host). Returns includePrivate. */
export function takeSignInHandoff(): { includePrivate: boolean } | null {
  const params = new URLSearchParams(window.location.search);
  if (params.get(SIGNIN_PARAM) !== "github") return null;
  const includePrivate = params.get("private") === "1";
  params.delete(SIGNIN_PARAM);
  params.delete("private");
  const qs = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`);
  return { includePrivate };
}

/** Reads and clears `?auth_error=CODE` left by the OAuth callback. */
export function takeAuthError(): string | null {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("auth_error");
  if (code) {
    params.delete("auth_error");
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`);
  }
  return code;
}
