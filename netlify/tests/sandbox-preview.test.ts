import { describe, expect, it } from "vitest";
import { HttpError } from "../lib/http.js";
import {
  MAX_PREVIEW_TOTAL_BYTES,
  preparePreviewFiles,
  previewRunner,
  previewSandboxName,
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
});
