import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import health from "../functions/health";
import authStart from "../functions/auth-github-start";
import authCallback from "../functions/auth-github-callback";
import authSession from "../functions/auth-session";
import authLogout from "../functions/auth-logout";
import { CLIENT_SECRET, ORIGIN, SECRET_TOKEN, configureEnv, cookieHeader, gh, mockGitHub } from "./helpers";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("GET /api/health", () => {
  it("reports capabilities as booleans and never leaks secret values", async () => {
    configureEnv();
    vi.stubEnv("OPENAI_API_KEY", SECRET_TOKEN);
    const res = await health(new Request(`${ORIGIN}/api/health`));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(SECRET_TOKEN);
    expect(text).not.toContain(CLIENT_SECRET);
    const body = JSON.parse(text) as { phase: number; capabilities: { githubOAuth: boolean; sessions: boolean } };
    expect(body.capabilities).toMatchObject({ githubOAuth: true, sessions: true });
    expect(body.phase).toBe(8);
  });

  it("rejects non-GET", async () => {
    expect((await health(new Request(`${ORIGIN}/api/health`, { method: "POST" }))).status).toBe(405);
  });
});

describe("POST /api/auth/github/start", () => {
  it("explains missing configuration", async () => {
    vi.stubEnv("GITHUB_CLIENT_ID", "");
    vi.stubEnv("GITHUB_CLIENT_SECRET", "");
    const res = await authStart(new Request(`${ORIGIN}/api/auth/github/start`, { method: "POST", headers: { origin: ORIGIN } }));
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("GITHUB_OAUTH_NOT_CONFIGURED");
  });

  it("blocks cross-site requests", async () => {
    configureEnv();
    const res = await authStart(new Request(`${ORIGIN}/api/auth/github/start`, { method: "POST", headers: { origin: "https://evil.example" } }));
    expect(res.status).toBe(403);
  });

  it("returns an authorize URL with minimal scope and sets a sealed state cookie", async () => {
    configureEnv();
    const res = await authStart(
      new Request(`${ORIGIN}/api/auth/github/start`, { method: "POST", headers: { origin: ORIGIN }, body: JSON.stringify({ includePrivate: false }) }),
    );
    expect(res.status).toBe(200);
    const { authorizeUrl } = (await res.json()) as { authorizeUrl: string };
    const url = new URL(authorizeUrl);
    expect(url.origin).toBe("https://github.com");
    expect(url.searchParams.get("scope")).toBe("read:user public_repo");
    expect(url.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/auth/github/callback`);
    const state = url.searchParams.get("state")!;
    const setCookie = res.headers.getSetCookie().join("\n");
    expect(setCookie).toMatch(/mdai_oauth_state=.+HttpOnly; Secure; SameSite=Lax/);
    expect(setCookie).not.toContain(state); // the state is encrypted inside the cookie
  });

  it("requests the repo scope only when private repos are opted in", async () => {
    configureEnv();
    const res = await authStart(
      new Request(`${ORIGIN}/api/auth/github/start`, { method: "POST", headers: { origin: ORIGIN }, body: JSON.stringify({ includePrivate: true }) }),
    );
    const { authorizeUrl } = (await res.json()) as { authorizeUrl: string };
    expect(new URL(authorizeUrl).searchParams.get("scope")).toBe("read:user repo");
  });

  it("validates the body", async () => {
    configureEnv();
    const res = await authStart(
      new Request(`${ORIGIN}/api/auth/github/start`, { method: "POST", headers: { origin: ORIGIN }, body: JSON.stringify({ includePrivate: "yes", x: 1 }) }),
    );
    expect(res.status).toBe(422);
  });
});

describe("OAuth round trip", () => {
  beforeEach(() => configureEnv());

  async function begin() {
    const res = await authStart(new Request(`${ORIGIN}/api/auth/github/start`, { method: "POST", headers: { origin: ORIGIN } }));
    const { authorizeUrl } = (await res.json()) as { authorizeUrl: string };
    return { state: new URL(authorizeUrl).searchParams.get("state")!, cookies: cookieHeader(res) };
  }

  function mockOAuth() {
    return mockGitHub({
      "POST /login/oauth/access_token": () => gh({ access_token: SECRET_TOKEN, scope: "read:user,public_repo" }),
      "GET /user": () => gh({ id: 7, login: "octo", name: "Octo Cat", avatar_url: "https://avatars.example/7" }),
      "DELETE /applications/Iv1.testclient/token": () => new Response(null, { status: 204 }),
    });
  }

  it("signs in, exposes the profile (not the token), and logs out with revocation", async () => {
    const calls = mockOAuth();
    const { state, cookies } = await begin();

    const cb = await authCallback(new Request(`${ORIGIN}/api/auth/github/callback?code=abc&state=${state}`, { headers: { cookie: cookies } }));
    expect(cb.status).toBe(302);
    expect(cb.headers.get("location")).toBe(`${ORIGIN}/#/app/projects`);
    const jar = cookieHeader(cb, cookies);
    expect(jar).toContain("mdai_session=");
    expect(jar).not.toContain("mdai_oauth_state="); // one-time state is cleared
    expect(cb.headers.getSetCookie().join("\n")).not.toContain(SECRET_TOKEN);

    const tokenCall = calls.find((c) => c.url.pathname === "/login/oauth/access_token")!;
    expect(String(tokenCall.init?.body)).toContain('"code":"abc"');

    const s = await authSession(new Request(`${ORIGIN}/api/auth/session`, { headers: { cookie: jar } }));
    const text = await s.text();
    expect(text).not.toContain(SECRET_TOKEN);
    expect(JSON.parse(text)).toMatchObject({ authenticated: true, user: { login: "octo", name: "Octo Cat" }, includePrivate: false });

    const out = await authLogout(new Request(`${ORIGIN}/api/auth/logout`, { method: "POST", headers: { cookie: jar, origin: ORIGIN } }));
    expect(out.status).toBe(200);
    expect(out.headers.getSetCookie().join()).toMatch(/mdai_session=; .*Max-Age=0/);
    expect(calls.some((c) => c.method === "DELETE" && c.url.pathname.endsWith("/token"))).toBe(true);
  });

  it("rejects a mismatched state", async () => {
    mockOAuth();
    const { cookies } = await begin();
    const cb = await authCallback(new Request(`${ORIGIN}/api/auth/github/callback?code=abc&state=forged`, { headers: { cookie: cookies } }));
    expect(cb.headers.get("location")).toBe(`${ORIGIN}/?auth_error=OAUTH_STATE_MISMATCH#/signin`);
  });

  it("rejects a callback without the state cookie (login CSRF)", async () => {
    mockOAuth();
    const { state } = await begin();
    const cb = await authCallback(new Request(`${ORIGIN}/api/auth/github/callback?code=abc&state=${state}`));
    expect(cb.headers.get("location")).toContain("auth_error=OAUTH_STATE_MISMATCH");
  });

  it("reports when the user denies access", async () => {
    const cb = await authCallback(new Request(`${ORIGIN}/api/auth/github/callback?error=access_denied&state=x`));
    expect(cb.headers.get("location")).toContain("auth_error=OAUTH_DENIED");
  });

  it("reports a failed code exchange", async () => {
    mockGitHub({ "POST /login/oauth/access_token": () => gh({ error: "bad_verification_code" }) });
    const { state, cookies } = await begin();
    const cb = await authCallback(new Request(`${ORIGIN}/api/auth/github/callback?code=old&state=${state}`, { headers: { cookie: cookies } }));
    expect(cb.headers.get("location")).toContain("auth_error=OAUTH_EXCHANGE_FAILED");
  });

  it("treats a tampered session cookie as signed out and clears it", async () => {
    const s = await authSession(new Request(`${ORIGIN}/api/auth/session`, { headers: { cookie: "mdai_session=garbage" } }));
    expect(await s.json()).toEqual({ authenticated: false });
    expect(s.headers.getSetCookie().join()).toMatch(/Max-Age=0/);
  });
});

describe("canonical host (APP_URL) in production", () => {
  beforeEach(() => configureEnv());
  const OTHER = "https://other-alias.example";

  it("tells a browser on another production host to move to APP_URL", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const s = await authSession(new Request(`${OTHER}/api/auth/session`));
    expect(await s.json()).toEqual({ authenticated: false, canonicalOrigin: ORIGIN });
  });

  it("does nothing on the APP_URL host or outside production", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(await (await authSession(new Request(`${ORIGIN}/api/auth/session`))).json()).toEqual({ authenticated: false });
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(await (await authSession(new Request(`${OTHER}/api/auth/session`))).json()).toEqual({ authenticated: false });
  });
});

