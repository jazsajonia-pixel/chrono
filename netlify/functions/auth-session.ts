import type { Config } from "@netlify/functions";
import { handle, json } from "../lib/http.js";
import { canonicalRedirectOrigin } from "../lib/env.js";
import { SESSION_COOKIE, clearCookie, readSession } from "../lib/session.js";
import { parseCookies } from "../lib/cookies.js";
import type { AuthSessionResponse } from "../../src/types/github.js";

/** GET /api/auth/session — who is signed in. Never returns the access token. */
export default handle(["GET"], async (req) => {
  const canonical = canonicalRedirectOrigin(req);
  if (canonical) return json({ authenticated: false, canonicalOrigin: canonical } satisfies AuthSessionResponse);
  const session = await readSession(req);
  if (!session) {
    const stale = SESSION_COOKIE in parseCookies(req.headers.get("cookie"));
    const body: AuthSessionResponse = { authenticated: false };
    return json(body, { cookies: stale ? [clearCookie(req, SESSION_COOKIE)] : [] });
  }
  const body: AuthSessionResponse = {
    authenticated: true,
    user: session.user,
    scopes: session.scopes,
    includePrivate: session.includePrivate,
    expiresAt: new Date(session.exp * 1000).toISOString(),
  };
  return json(body);
});

export const config: Config = { path: "/api/auth/session" };
