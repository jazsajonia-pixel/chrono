/**
 * Personal knowledge base: short Markdown notes about the user and their projects that the agent
 * reads at the start of a chat and can save on its own (save_knowledge). Local-first: notes live
 * only on this device (localStorage on the web, AsyncStorage in the app), one store per GitHub
 * account, and only the notes relevant to the current chat are sent with each agent request.
 *
 * Shared, byte-identical, by the website (src/lib/knowledge.ts) and the app.
 */

export type KnowledgeScope = "global" | `project:${string}`;

export interface KnowledgeNote {
  id: string;
  title: string;
  body: string;
  /** "global" applies everywhere; "project:owner/repo" only in that repository. */
  scope: KnowledgeScope;
  /** Who last wrote it. Agent notes are shown with a badge so the user can review them. */
  source: "you" | "agent";
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeSettings {
  /** Send relevant notes with agent requests. */
  enabled: boolean;
  /** Let the agent save notes without asking (each save is shown in the chat with Undo). */
  autoSave: boolean;
}

/** What the agent request carries (validated again by the server). */
export interface KnowledgePayload {
  autoSave: boolean;
  notes: { id: string; title: string; body: string; scope: "global" | "project"; updatedAt: string }[];
  /** Notes stored but not included, so the model knows search_knowledge may find more. */
  more: number;
}

export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export const KNOWLEDGE_LIMITS = { notes: 300, title: 120, body: 4000, promptChars: 12_000, promptNotes: 40 } as const;
export const DEFAULT_KNOWLEDGE_SETTINGS: KnowledgeSettings = { enabled: true, autoSave: true };

export class KnowledgeError extends Error {}

/** Values that must never be stored: tokens, keys, passwords, connection strings with credentials. */
const SECRET_PATTERNS: RegExp[] = [
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]+@/i,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/,
  /\bsk-(?:ant-|proj-|live_|test_)?[A-Za-z0-9_-]{16,}/,
  /\b(?:rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/,
  /\bnpg_[A-Za-z0-9]{12,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b[A-Za-z0-9_]*(?:password|passwd|secret|token|api[_-]?key|private[_-]?key|client[_-]?secret)[A-Za-z0-9_]*["']?\s*[:=]\s*["']?[^\s"',;]{6,}/i,
];

export function looksLikeSecret(text: string): boolean {
  return SECRET_PATTERNS.some((re) => re.test(text));
}

export function projectScope(owner: string, repo: string): KnowledgeScope {
  return `project:${owner.toLowerCase()}/${repo.toLowerCase()}`;
}

export function scopeLabel(scope: KnowledgeScope): string {
  return scope === "global" ? "All projects" : scope.slice("project:".length);
}

const WORD = /[\p{L}\p{N}][\p{L}\p{N}_.+-]*/gu;
const STOP = new Set("the a an and or of to in on for with is are be it this that my our your i we you use using should always never please about from into at by as".split(" "));

function words(text: string): string[] {
  return (text.toLowerCase().match(WORD) ?? []).filter((w) => w.length > 1 && !STOP.has(w));
}

function newId(): string {
  return "k_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function clean(note: Partial<KnowledgeNote>): KnowledgeNote | null {
  if (typeof note.id !== "string" || typeof note.title !== "string" || typeof note.body !== "string") return null;
  const scope = note.scope === "global" || (typeof note.scope === "string" && /^project:[^/\s]+\/[^/\s]+$/.test(note.scope)) ? note.scope : null;
  if (!scope) return null;
  return {
    id: note.id,
    title: note.title.slice(0, KNOWLEDGE_LIMITS.title),
    body: note.body.slice(0, KNOWLEDGE_LIMITS.body),
    scope,
    source: note.source === "agent" ? "agent" : "you",
    createdAt: typeof note.createdAt === "string" ? note.createdAt : new Date(0).toISOString(),
    updatedAt: typeof note.updatedAt === "string" ? note.updatedAt : new Date(0).toISOString(),
  };
}

/** One user's notes in a key-value store (key `knowledge:<userId>`), newest first. */
export class KnowledgeStore {
  constructor(private readonly kv: KeyValueStore, private readonly userId: string | number) {}

  private get key() {
    return `knowledge:${this.userId}`;
  }

  list(): KnowledgeNote[] {
    try {
      const raw = JSON.parse(this.kv.get(this.key) ?? "[]") as unknown;
      if (!Array.isArray(raw)) return [];
      return raw.map((n) => clean(n as Partial<KnowledgeNote>)).filter((n): n is KnowledgeNote => n !== null).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    } catch {
      return [];
    }
  }

  private write(notes: KnowledgeNote[]) {
    this.kv.set(this.key, JSON.stringify(notes));
  }

  get(id: string): KnowledgeNote | undefined {
    return this.list().find((n) => n.id === id);
  }

  /** Create or update. Throws KnowledgeError for empty, oversized or secret-looking notes. */
  save(input: { id?: string; title: string; body: string; scope: KnowledgeScope; source: "you" | "agent" }): KnowledgeNote {
    const title = input.title.trim().replace(/\s+/g, " ");
    const body = input.body.trim();
    if (!title) throw new KnowledgeError("Give the note a title.");
    if (!body) throw new KnowledgeError("The note is empty.");
    if (title.length > KNOWLEDGE_LIMITS.title) throw new KnowledgeError(`Keep the title under ${KNOWLEDGE_LIMITS.title} characters.`);
    if (body.length > KNOWLEDGE_LIMITS.body) throw new KnowledgeError(`Keep notes under ${KNOWLEDGE_LIMITS.body} characters; split long ones.`);
    if (looksLikeSecret(title) || looksLikeSecret(body)) throw new KnowledgeError("That looks like a password, key or token. Notes can't hold secrets; use Preview → Variables for those.");
    const notes = this.list();
    const now = new Date().toISOString();
    // Updating by id, or by an identical title in the same scope, avoids duplicates.
    const existing = notes.find((n) => (input.id && n.id === input.id) || (n.scope === input.scope && n.title.toLowerCase() === title.toLowerCase()));
    if (input.id && !existing) throw new KnowledgeError(`No note with id ${input.id}.`);
    if (!existing && notes.length >= KNOWLEDGE_LIMITS.notes) throw new KnowledgeError(`The knowledge base is full (${KNOWLEDGE_LIMITS.notes} notes). Delete some first.`);
    const note: KnowledgeNote = existing
      ? { ...existing, title, body, scope: input.scope, source: input.source, updatedAt: now }
      : { id: newId(), title, body, scope: input.scope, source: input.source, createdAt: now, updatedAt: now };
    this.write([note, ...notes.filter((n) => n.id !== note.id)]);
    return note;
  }

  /** Put back an earlier version (Undo after an agent save). `null` deletes. */
  restore(id: string, previous: KnowledgeNote | null) {
    const rest = this.list().filter((n) => n.id !== id);
    this.write(previous ? [previous, ...rest] : rest);
  }

  remove(id: string) {
    this.write(this.list().filter((n) => n.id !== id));
  }

  /** Replace everything (import). Invalid entries are dropped. */
  replaceAll(notes: KnowledgeNote[]) {
    this.write(notes.map((n) => clean(n)).filter((n): n is KnowledgeNote => n !== null).slice(0, KNOWLEDGE_LIMITS.notes));
  }
}

function score(note: KnowledgeNote, query: string[], scope: KnowledgeScope | null): number {
  const hay = new Set(words(note.title + " " + note.body));
  const titleWords = new Set(words(note.title));
  let s = 0;
  for (const w of query) {
    if (titleWords.has(w)) s += 3;
    else if (hay.has(w)) s += 1;
  }
  if (scope && note.scope === scope) s += 4;
  return s;
}

/** Notes matching a query, best first (search_knowledge and the in-app search). */
export function searchNotes(notes: readonly KnowledgeNote[], query: string, limit = 10): KnowledgeNote[] {
  const q = words(query);
  const needle = query.trim().toLowerCase();
  return notes
    .map((n) => ({ n, s: score(n, q, null) + (needle && (n.title + "\n" + n.body).toLowerCase().includes(needle) ? 2 : 0) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || b.n.updatedAt.localeCompare(a.n.updatedAt))
    .slice(0, limit)
    .map((x) => x.n);
}

/**
 * Notes for one agent request: this repo's notes and global notes, ranked by overlap with the
 * user's message, then recency, within a character budget. Other projects' notes stay local.
 */
export function selectForPrompt(notes: readonly KnowledgeNote[], project: { owner: string; repo: string }, message: string, settings: KnowledgeSettings): KnowledgePayload {
  const scope = projectScope(project.owner, project.repo);
  const eligible = notes.filter((n) => n.scope === "global" || n.scope === scope);
  const q = words(message);
  const ranked = eligible
    .map((n, i) => ({ n, s: score(n, q, scope), i }))
    .sort((a, b) => b.s - a.s || a.i - b.i);
  const picked: KnowledgePayload["notes"] = [];
  let used = 0;
  for (const { n } of ranked) {
    if (picked.length >= KNOWLEDGE_LIMITS.promptNotes) break;
    const size = n.title.length + n.body.length + 40;
    if (used + size > KNOWLEDGE_LIMITS.promptChars) continue;
    used += size;
    picked.push({ id: n.id, title: n.title, body: n.body, scope: n.scope === "global" ? "global" : "project", updatedAt: n.updatedAt });
  }
  return { autoSave: settings.autoSave, notes: picked, more: notes.length - picked.length };
}

/** Markdown export (one file, sapphire-knowledge style headings) for backup or sharing. */
export function toMarkdown(notes: readonly KnowledgeNote[], owner: string): string {
  const groups = new Map<string, KnowledgeNote[]>();
  for (const n of notes) groups.set(scopeLabel(n.scope), [...(groups.get(scopeLabel(n.scope)) ?? []), n]);
  const out = [`# Chrono knowledge — @${owner}`, "", `Exported ${new Date().toISOString().slice(0, 10)} · ${notes.length} note(s)`, ""];
  for (const [label, list] of [...groups].sort(([a], [b]) => (a === "All projects" ? -1 : b === "All projects" ? 1 : a.localeCompare(b)))) {
    out.push(`## ${label}`, "");
    for (const n of list) out.push(`### ${n.title}`, "", n.body, "", `<sub>${n.source === "agent" ? "Saved by the agent" : "Written by you"} · updated ${n.updatedAt.slice(0, 10)}</sub>`, "");
  }
  return out.join("\n");
}

/** Text the save_knowledge / search_knowledge tools return to the model. */
export function describeNote(n: Pick<KnowledgeNote, "id" | "title" | "body" | "scope">): string {
  return `[${n.id}] ${n.title} (${n.scope === "global" ? "all projects" : "this project"})\n${n.body}`;
}
