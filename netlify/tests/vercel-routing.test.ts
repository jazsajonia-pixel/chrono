import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Vercel adds rewrite and dynamic-route parameters to the query string, overwriting
// same-named query parameters. `:path*` once replaced `?path=` for /api/github/.../file,
// so every file read returned 404 on Vercel.
const API_QUERY_PARAMS = ["path", "ref", "owner", "repo", "branch", "q", "page", "per_page", "sha", "base", "head"];

describe("Vercel routing", () => {
  it("never names a rewrite parameter after an API query parameter", () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8")) as { rewrites: { source: string; destination: string }[] };
    const names = config.rewrites.flatMap((r) => [...r.source.matchAll(/:([A-Za-z_]\w*)/g)].map((m) => m[1]!));
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(API_QUERY_PARAMS).not.toContain(name);
  });

  it("never names a dynamic API route segment after an API query parameter", () => {
    const segments = readdirSync("api").flatMap((f) => [...f.matchAll(/\[\[?(?:\.\.\.)?(\w+)\]?\]/g)].map((m) => m[1]!));
    for (const name of segments) expect(API_QUERY_PARAMS).not.toContain(name);
  });
});
