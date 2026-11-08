import { describe, expect, it } from "vitest";
import { KNOWLEDGE_LIMITS, KnowledgeError, KnowledgeStore, looksLikeSecret, projectScope, searchNotes, selectForPrompt, toMarkdown } from "./knowledge";

function memoryKv() {
  const m = new Map<string, string>();
  return { m, kv: { get: (k: string) => m.get(k) ?? null, set: (k: string, v: string) => void m.set(k, v), remove: (k: string) => void m.delete(k) } };
}
const on = { enabled: true, autoSave: true };

describe("KnowledgeStore", () => {
  it("keeps each GitHub account's notes under its own key", () => {
    const { m, kv } = memoryKv();
    new KnowledgeStore(kv, 1).save({ title: "Package manager", body: "Use pnpm.", scope: "global", source: "you" });
    expect(new KnowledgeStore(kv, 2).list()).toEqual([]);
    expect([...m.keys()]).toEqual(["knowledge:1"]);
  });

  it("updates a note with the same title in the same scope instead of duplicating it", () => {
    const { kv } = memoryKv();
    const s = new KnowledgeStore(kv, 1);
    const a = s.save({ title: "Package manager", body: "Use npm.", scope: "global", source: "agent" });
    const b = s.save({ title: "package manager", body: "Use pnpm.", scope: "global", source: "agent" });
    expect(b.id).toBe(a.id);
    expect(s.list()).toHaveLength(1);
    expect(s.list()[0]!.body).toBe("Use pnpm.");
    // Different scope → separate note.
    s.save({ title: "Package manager", body: "Use bun.", scope: projectScope("Octo", "Api"), source: "agent" });
    expect(s.list()).toHaveLength(2);
  });

  it("rejects empty, unknown-id and secret-looking notes", () => {
    const s = new KnowledgeStore(memoryKv().kv, 1);
    expect(() => s.save({ title: " ", body: "x", scope: "global", source: "you" })).toThrow(KnowledgeError);
    expect(() => s.save({ id: "k_missing", title: "t", body: "x", scope: "global", source: "you" })).toThrow(/No note/);
    expect(() => s.save({ title: "DB", body: "postgres://app:hunter22@db.example.com/app", scope: "global", source: "agent" })).toThrow(KnowledgeError);
    expect(s.list()).toEqual([]);
  });

  it("restores the previous version or removes a new note (Undo)", () => {
    const s = new KnowledgeStore(memoryKv().kv, 1);
    const first = s.save({ title: "Style", body: "Tabs.", scope: "global", source: "you" });
    s.save({ title: "Style", body: "Spaces.", scope: "global", source: "agent" });
    s.restore(first.id, first);
    expect(s.get(first.id)!.body).toBe("Tabs.");
    const fresh = s.save({ title: "New", body: "x", scope: "global", source: "agent" });
    s.restore(fresh.id, null);
    expect(s.get(fresh.id)).toBeUndefined();
  });

  it("survives corrupt storage", () => {
    const { m, kv } = memoryKv();
    m.set("knowledge:1", "{not json");
    expect(new KnowledgeStore(kv, 1).list()).toEqual([]);
    m.set("knowledge:1", JSON.stringify([{ id: "a", title: "ok", body: "b", scope: "global" }, { id: 3 }, { id: "b", title: "x", body: "y", scope: "project:bad" }]));
    expect(new KnowledgeStore(kv, 1).list().map((n) => n.id)).toEqual(["a"]);
  });
});

describe("looksLikeSecret", () => {
  it("flags tokens and keys but not ordinary notes", () => {
    expect(looksLikeSecret("ghp_" + "a".repeat(36))).toBe(true);
    expect(looksLikeSecret("API_KEY=abcdef123456")).toBe(true);
    expect(looksLikeSecret("sk-proj-" + "x".repeat(24))).toBe(true);
    expect(looksLikeSecret("Never log the token; read it from AUTH_SECRET in env.")).toBe(false);
    expect(looksLikeSecret("Use pnpm, not npm.")).toBe(false);
  });
});

describe("selectForPrompt", () => {
  const s = new KnowledgeStore(memoryKv().kv, 1);
  s.save({ title: "Other repo", body: "Only for landing.", scope: projectScope("octo", "landing"), source: "you" });
  s.save({ title: "Testing", body: "Use vitest with jsdom.", scope: "global", source: "you" });
  s.save({ title: "Errors", body: "Return { error: { code, message } }.", scope: projectScope("octo", "notes-api"), source: "agent" });

  it("sends this repo's and global notes only, best match first", () => {
    const p = selectForPrompt(s.list(), { owner: "Octo", repo: "notes-api" }, "write a vitest test", on);
    expect(p.notes.map((n) => n.title)).toEqual(["Errors", "Testing"]);
    expect(p.notes.find((n) => n.title === "Errors")!.scope).toBe("project");
    expect(p.more).toBe(1);
    expect(p.autoSave).toBe(true);
  });

  it("stays within the character budget", () => {
    const big = new KnowledgeStore(memoryKv().kv, 1);
    for (let i = 0; i < 10; i++) big.save({ title: `Note ${i}`, body: "x".repeat(3000), scope: "global", source: "you" });
    const p = selectForPrompt(big.list(), { owner: "a", repo: "b" }, "", on);
    const chars = p.notes.reduce((n, x) => n + x.title.length + x.body.length + 40, 0);
    expect(chars).toBeLessThanOrEqual(KNOWLEDGE_LIMITS.promptChars);
    expect(p.notes.length).toBeLessThan(10);
  });
});

describe("searchNotes and toMarkdown", () => {
  it("finds notes by words in title or body", () => {
    const s = new KnowledgeStore(memoryKv().kv, 1);
    s.save({ title: "Testing", body: "Use vitest.", scope: "global", source: "you" });
    s.save({ title: "Deploy", body: "Vercel preview per PR.", scope: "global", source: "you" });
    expect(searchNotes(s.list(), "vercel").map((n) => n.title)).toEqual(["Deploy"]);
    expect(searchNotes(s.list(), "nothing-matches")).toEqual([]);
    const md = toMarkdown(s.list(), "jazz");
    expect(md).toContain("# Chrono knowledge — @jazz");
    expect(md).toContain("## All projects");
    expect(md).toContain("### Deploy");
  });
});
