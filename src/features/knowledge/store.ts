import { useCallback, useSyncExternalStore } from "react";
import { safeStorage } from "@/lib/storage";
import {
  DEFAULT_KNOWLEDGE_SETTINGS,
  KnowledgeStore,
  projectScope,
  searchNotes,
  selectForPrompt,
  type KnowledgeNote,
  type KnowledgePayload,
  type KnowledgeScope,
  type KnowledgeSettings,
} from "@/lib/knowledge";
import type { KnowledgeTools } from "@/features/agent/tools-exec";

/**
 * On-device knowledge base for the signed-in GitHub account (same file in the website and the app).
 * Notes are kept in local storage under `knowledge:<userId>` and never uploaded on their own; the
 * agent request carries only the notes picked for that chat (see selectForPrompt).
 */

const kv = { get: (k: string) => safeStorage.get(k), set: (k: string, v: string) => safeStorage.set(k, v), remove: (k: string) => safeStorage.remove(k) };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** KnowledgeStore that notifies every screen (chat, Knowledge page) after each write. */
class ObservedStore extends KnowledgeStore {
  override save(...args: Parameters<KnowledgeStore["save"]>) {
    const note = super.save(...args);
    emit();
    return note;
  }
  override restore(...args: Parameters<KnowledgeStore["restore"]>) {
    super.restore(...args);
    emit();
  }
  override remove(id: string) {
    super.remove(id);
    emit();
  }
  override replaceAll(notes: KnowledgeNote[]) {
    super.replaceAll(notes);
    emit();
  }
}

export function knowledgeStore(userId: string | number): KnowledgeStore {
  return new ObservedStore(kv, userId);
}

const settingsKey = (userId: string | number) => `knowledge-settings:${userId}`;

export function knowledgeSettings(userId: string | number): KnowledgeSettings {
  try {
    const v = JSON.parse(safeStorage.get(settingsKey(userId)) ?? "null") as Partial<KnowledgeSettings> | null;
    return { enabled: v?.enabled ?? DEFAULT_KNOWLEDGE_SETTINGS.enabled, autoSave: v?.autoSave ?? DEFAULT_KNOWLEDGE_SETTINGS.autoSave };
  } catch {
    return DEFAULT_KNOWLEDGE_SETTINGS;
  }
}

export function setKnowledgeSettings(userId: string | number, next: KnowledgeSettings) {
  safeStorage.set(settingsKey(userId), JSON.stringify(next));
  emit();
}

/* ── Undo for agent saves (this app run only; older saves are edited on the Knowledge page) ── */

const undo = new Map<string, { userId: string | number; noteId: string; previous: KnowledgeNote | null; undone: boolean }>();

export function canUndoSave(callId: string): boolean {
  const u = undo.get(callId);
  return !!u && !u.undone;
}

export function undoSave(callId: string): boolean {
  const u = undo.get(callId);
  if (!u || u.undone) return false;
  knowledgeStore(u.userId).restore(u.noteId, u.previous);
  u.undone = true;
  return true;
}

/* ── Agent wiring ── */

/** Tools the agent uses in one repository (scope "project" means this repo). */
export function knowledgeTools(userId: string | number, project: { owner: string; repo: string }): KnowledgeTools {
  const store = knowledgeStore(userId);
  return {
    save: (input, callId) => {
      const scope: KnowledgeScope = input.scope === "project" ? projectScope(project.owner, project.repo) : "global";
      const previous = input.id ? (store.get(input.id) ?? null) : (store.list().find((n) => n.scope === scope && n.title.toLowerCase() === input.title.trim().toLowerCase()) ?? null);
      const note = store.save({ id: input.id, title: input.title, body: input.body, scope, source: "agent" });
      if (callId) undo.set(callId, { userId, noteId: note.id, previous, undone: false });
      return note;
    },
    search: (query) => searchNotes(store.list(), query, 8),
  };
}

/** What to send with an agent request, or undefined when the user turned the knowledge base off. */
export function knowledgePayload(userId: string | number, project: { owner: string; repo: string }, message: string): KnowledgePayload | undefined {
  const settings = knowledgeSettings(userId);
  if (!settings.enabled) return undefined;
  return selectForPrompt(knowledgeStore(userId).list(), project, message, settings);
}

/* ── React ── */

let version = 0;
listeners.add(() => {
  version++;
});
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Notes and settings for the signed-in user; re-renders on every change from any screen. */
export function useKnowledge(userId: string | number | null) {
  const v = useSyncExternalStore(subscribe, () => version, () => version);
  const notes = readNotes(userId, v);
  const settings = userId === null ? { enabled: false, autoSave: false } : knowledgeSettings(userId);
  const store = useCallback(() => (userId === null ? null : knowledgeStore(userId)), [userId]);
  const updateSettings = useCallback((next: KnowledgeSettings) => userId !== null && setKnowledgeSettings(userId, next), [userId]);
  return { notes, settings, store, updateSettings };
}

const cache = new Map<string, { v: number; notes: KnowledgeNote[] }>();
function readNotes(userId: string | number | null, v: number): KnowledgeNote[] {
  if (userId === null) return EMPTY;
  const key = String(userId);
  const hit = cache.get(key);
  if (hit && hit.v === v) return hit.notes;
  const notes = new KnowledgeStore(kv, userId).list();
  cache.set(key, { v, notes });
  return notes;
}
const EMPTY: KnowledgeNote[] = [];
