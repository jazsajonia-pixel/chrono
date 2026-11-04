import { describe, expect, it } from "vitest";
import { HttpError } from "../lib/http.js";
import {
  MAX_PREVIEW_TOTAL_BYTES,
  preparePreviewFiles,
  previewRunner,
  previewStartScript,
  PREVIEW_PROXY_SOURCE,
  previewSandboxName,
  prepareAssetPaths,
  PREVIEW_DENY_SUBNETS,
  sandboxConfigured,
} from "../lib/sandbox-preview.js";

describe("Vercel live preview validation", () => {
  it("creates stable, user-and-repo scoped sandbox names", () => {
    const one = previewSandboxName("42", "Jaz", "Chrono", "abc123");
    expect(one).toBe(previewSandboxName("42", "jaz", "chrono", "abc123"));
    expect(one).not.toBe(previewSandboxName("43", "jaz", "chrono", "abc123"));
    expect(one).not.toBe(previewSandboxName("42", "jaz", "chrono", "def456"));
    expect(one).toMatch(/^chrono-[a-f0-9]{40}$/);
  });

  it("accepts safe text files and preserves workspace order", () => {
    const files = preparePreviewFiles([
      { path: "package.json", content: "{\"scripts\":{\"dev\":\"vite\"}}" },
      { path: "src/main.tsx", content: "export default 1;" },
    ]);
    expect(files.map((file) => file.path)).toEqual(["package.json", "src/main.tsx"]);
  });

  it.each([
    "../secret.txt", ".env", ".env.production", "src/.env.local", ".git/config",
    "node_modules/a/index.js", ".npmrc", "src/.netrc", ".ssh/id_rsa",
    "secrets/private.pem", "certs/app.p12", "assets/photo.png",
  ])("rejects unsafe path %s", (path) => {
    expect(() => preparePreviewFiles([{ path, content: "x" }])).toThrow(HttpError);
  });

  it("rejects duplicate paths and oversized workspaces", () => {
    expect(() => preparePreviewFiles([
      { path: "index.html", content: "a" },
      { path: "index.html", content: "b" },
    ])).toThrow(/Duplicate/);
    expect(() => preparePreviewFiles([
      { path: "index.html", content: "x".repeat(MAX_PREVIEW_TOTAL_BYTES + 1) },
    ])).toThrow(HttpError);
  });

  it("chooses Vite and Next command arguments", () => {
    expect(previewRunner([{
      path: "package.json",
      content: JSON.stringify({ scripts: { dev: "vite" }, devDependencies: { vite: "^6" } }),
    }]).args).toContain("--host");
    expect(previewRunner([{
      path: "package.json",
      content: JSON.stringify({ scripts: { dev: "next dev" }, dependencies: { next: "^15" } }),
    }]).args).toContain("--hostname");
  });

  it("forwards the port instead of passing flags when the dev script wraps several processes", () => {
    const runner = (dev: string, deps: Record<string, string> = { vite: "^6" }) =>
      previewRunner([{ path: "package.json", content: JSON.stringify({ scripts: { dev }, devDependencies: deps }) }]);
    expect(runner('concurrently "npm:dev:api" "npm:dev:web"')).toEqual({ script: "dev", args: [], proxy: true });
    expect(runner("npm run build:css && vite").proxy).toBe(true);
    expect(runner("turbo run dev", { next: "^15" }).proxy).toBe(true);
    expect(runner("NODE_ENV=development vite").proxy).toBeUndefined();
    expect(runner("npx vite --open").args).toContain("--strictPort");
    expect(runner("next dev --turbo", { next: "^15" }).args).toContain("--hostname");

    const script = previewStartScript(runner('concurrently "a" "b"'));
    expect(script).toContain("node .chrono-preview/proxy.mjs");
    expect(script).toContain("unset PORT");
    expect(script.trim().endsWith("npm run dev")).toBe(true);
    expect(previewStartScript(runner("vite"))).toContain("PORT=3000 npm run dev -- --host 0.0.0.0 --port 3000 --strictPort");
  });

  it("ships a forwarder that is valid JavaScript and listens on the preview port", () => {
    expect(() => new Function(PREVIEW_PROXY_SOURCE.replace(/^import .*$/gm, ""))).not.toThrow();
    expect(PREVIEW_PROXY_SOURCE).toContain("server.listen(LISTEN");
    expect(PREVIEW_PROXY_SOURCE).toContain("const LISTEN = 3000");
  });

  it("rejects malformed manifests and unsupported projects", () => {
    expect(() => previewRunner([{ path: "package.json", content: "{" }])).toThrow(HttpError);
    expect(() => previewRunner([{ path: "README.md", content: "# no app" }])).toThrow(HttpError);
  });

  it("only sends IPv4 CIDRs in the network policy (the Sandbox API rejects IPv6)", () => {
    expect(PREVIEW_DENY_SUBNETS.length).toBeGreaterThan(0);
    for (const cidr of PREVIEW_DENY_SUBNETS) expect(cidr).toMatch(/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/);
  });

  it("detects sandbox credentials from OIDC, the Vercel runtime or a full token set", () => {
    expect(sandboxConfigured({})).toBe(false);
    expect(sandboxConfigured({ VERCEL: "1" })).toBe(true);
    expect(sandboxConfigured({ VERCEL_OIDC_TOKEN: "t" })).toBe(true);
    expect(sandboxConfigured({ VERCEL_TOKEN: "t", VERCEL_PROJECT_ID: "p" })).toBe(false);
    expect(sandboxConfigured({ VERCEL_TOKEN: "t", VERCEL_PROJECT_ID: "p", VERCEL_TEAM_ID: "team" })).toBe(true);
  });

  it("keeps safe asset paths and drops secrets, generated output, duplicates and text overlaps", () => {
    const text = new Set(["src/app/page.jsx"]);
    expect(prepareAssetPaths(undefined, text)).toEqual([]);
    expect(prepareAssetPaths([
      "assets/profile.jpeg", "public/fonts/a.woff2", "assets/profile.jpeg",
      "certs/server.key", ".env.png", "node_modules/x/logo.png", "dist/a.png", "src/app/page.jsx",
    ], text)).toEqual(["assets/profile.jpeg", "public/fonts/a.woff2"]);
    expect(() => prepareAssetPaths(["../etc/passwd"], text)).toThrow(HttpError);
    expect(() => prepareAssetPaths("x", text)).toThrow(HttpError);
  });
});
