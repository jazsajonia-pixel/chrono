import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { AppRoutes } from "./App";
import { SessionProvider } from "./stores/session";
import { ThemeProvider } from "./stores/theme";
import { browserNav } from "./lib/navigate";

const CANONICAL = "https://canonical.example";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function mockApi(routes: Record<string, (init?: RequestInit) => Response>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString(), window.location.origin);
    const route = routes[url.pathname];
    return route ? route(init) : json({ error: { code: "NOT_FOUND", message: "nope" } }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderAt(path: string, withInitial = true) {
  const loc = memoryLocation({ path, record: true });
  render(
    <ThemeProvider>
      <SessionProvider initial={withInitial ? { mode: "anonymous" } : undefined}>
        <Router hook={loc.hook}>
          <AppRoutes />
        </Router>
      </SessionProvider>
    </ThemeProvider>,
  );
  return loc;
}

const authorize = (redirectOrigin: string) =>
  `https://github.com/login/oauth/authorize?client_id=x&redirect_uri=${encodeURIComponent(`${redirectOrigin}/api/auth/github/callback`)}&state=s`;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("sign-in across hosts", () => {
  it("goes straight to GitHub when the callback is on this host", async () => {
    const assign = vi.spyOn(browserNav, "assign").mockImplementation(() => {});
    mockApi({ "/api/auth/github/start": () => json({ authorizeUrl: authorize(window.location.origin) }) });
    renderAt("/signin");
    fireEvent.click(await screen.findByTestId("button-github-signin"));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(expect.stringContaining("https://github.com/login/oauth/authorize")));
  });

  it("restarts sign-in on the callback host instead of failing the first attempt", async () => {
    const assign = vi.spyOn(browserNav, "assign").mockImplementation(() => {});
    mockApi({ "/api/auth/github/start": () => json({ authorizeUrl: authorize(CANONICAL) }) });
    renderAt("/signin");
    fireEvent.click(screen.getByTestId("checkbox-include-private"));
    fireEvent.click(await screen.findByTestId("button-github-signin"));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(`${CANONICAL}/?signin=github&private=1#/signin`));
  });

  it("continues a hand-off automatically and clears the flag from the URL", async () => {
    window.history.replaceState(null, "", "/?signin=github&private=1");
    const assign = vi.spyOn(browserNav, "assign").mockImplementation(() => {});
    const fetchMock = mockApi({ "/api/auth/github/start": () => json({ authorizeUrl: authorize(window.location.origin) }) });
    renderAt("/signin");
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls.find(([u]) => String(u).includes("/auth/github/start"))!;
    expect(JSON.parse(String(init?.body))).toEqual({ includePrivate: true });
    expect(window.location.search).toBe("");
  });

  it("moves the whole app to the canonical host when the server asks", async () => {
    const replace = vi.spyOn(browserNav, "replace").mockImplementation(() => {});
    mockApi({ "/api/auth/session": () => json({ authenticated: false, canonicalOrigin: CANONICAL }) });
    renderAt("/signin", false);
    await waitFor(() => expect(replace).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^${CANONICAL}/`))));
  });
});
