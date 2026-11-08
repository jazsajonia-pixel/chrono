import { PROVIDERS } from "../../../src/lib/ai-catalog.js";
import type { ProviderKind, ProviderStorage } from "../../../src/types/ai.js";
import { isSecureRequest, parseCookies, serializeCookie } from "../cookies.js";
import { decryptField, encryptField, seal, unseal } from "../crypto.js";
import { db } from "../db.js";
import { capabilities, encryptionSecret, isSet, sessionSecret } from "../env.js";
import { HttpError } from "../http.js";
import { AI_COOKIE, SESSION_TTL, type SessionData } from "../session.js";
import { emptyState, sanitizeProviderState, type PlatformProvider, type ProviderState, type StoredProvider } from "./state.js";
import { geminiKeys } from "./gemini-pool.js";
import { effectiveGeminiModel } from "../../../src/lib/gemini-models.js";

/**
 * Where AI provider keys live:
 *  - database: ENCRYPTION_KEY + DATABASE_URL → ciphertext in Postgres (survives sign-out, devices).
 *  - session:  SESSION_SECRET only → encrypted HTTP-only cookie scoped to /api/ai (this device,
 *              until sign-out / session expiry). Nothing is written to a database.
 * In both modes each key is field-encrypted and bound to user + provider id.
 */

export interface ProviderStore {
  mode: Exclude<ProviderStorage, "unavailable">;
  note: string;
  max: number;
  load(): Promise<ProviderState>;
  /** Persist; returns Set-Cookie headers (session mode) to attach to the response. */
  save(next: ProviderState, prev: ProviderState): Promise<string[]>;
  encryptKey(apiKey: string, providerId: string): Promise<string>;
  decryptKey(rec: StoredProvider): Promise<string>;
}

const SESSION_MAX = 6;
const DB_MAX = 20;
const COOKIE_LIMIT = 3800;

function aad(session: SessionData, providerId: string): string {
  return `user:${session.user.id}|provider:${providerId}`;
}

function fieldKeys(secret: string, session: SessionData) {
  return {
    encryptKey: (apiKey: string, id: string) => encryptField(apiKey, secret, aad(session, id)),
    decryptKey: async (rec: StoredProvider) => {
      const key = await decryptField(rec.keyCipher, secret, aad(session, rec.id));
      if (key === null) throw new HttpError(409, "AI_INVALID_KEY", "This saved key can't be decrypted (the server key changed). Paste the key again.");
      return key;
    },
  };
}

function cookieStore(req: Request, session: SessionData, secret: string, note: string): ProviderStore {
  // Purpose binds the cookie to this GitHub user: another account on the same browser can't open it.
  const purpose = `ai-providers:${session.user.id}`;
  return {
    mode: "session",
    note,
    max: SESSION_MAX,
    async load() {
      const raw = parseCookies(req.headers.get("cookie"))[AI_COOKIE];
      const data = await unseal<ProviderState>(raw, secret, purpose);
      return data?.v === 1 ? sanitizeProviderState(data) : emptyState();
    },
    async save(next) {
      const ttl = Math.max(60, Math.min(SESSION_TTL, session.exp - Math.floor(Date.now() / 1000)));
      const value = await seal(next, secret, purpose, ttl);
      if (value.length > COOKIE_LIMIT) throw new HttpError(409, "AI_STORAGE_FULL", "Session-only storage is full. Remove a provider first.");
      return [serializeCookie(AI_COOKIE, value, { maxAge: ttl, path: "/api/ai", secure: isSecureRequest(req), sameSite: "Strict" })];
    },
    ...fieldKeys(secret, session),
  };
}

type Sql = NonNullable<ReturnType<typeof db>>;

export async function userRowId(sql: Sql, session: SessionData): Promise<number> {
  const rows = (await sql`
    INSERT INTO users (github_id, login, name, avatar_url)
    VALUES (${session.user.id}, ${session.user.login}, ${session.user.name}, ${session.user.avatarUrl})
    ON CONFLICT (github_id) DO UPDATE SET login = EXCLUDED.login
    RETURNING id`) as { id: number }[];
  const id = rows[0]?.id;
  if (id === undefined) throw new HttpError(500, "INTERNAL", "Couldn't load your account.");
  return id;
}

function dbStore(sql: Sql, session: SessionData, secret: string): ProviderStore {
  let uid: number | null = null;
  const userId = async () => (uid ??= await userRowId(sql, session));
  return {
    mode: "database",
    note: "Keys are encrypted (AES-256-GCM) and saved in the app's database. They're decrypted only inside server functions and are never sent back to your browser.",
    max: DB_MAX,
    async load() {
      const id = await userId();
      const rows = (await sql`
        SELECT id, kind, label, model, effort, base_url, enabled, key_ciphertext, key_hint, last_test, created_at, updated_at
        FROM ai_providers WHERE user_id = ${id} AND kind <> 'groq' ORDER BY created_at`) as Record<string, unknown>[];
      const user = (await sql`SELECT ai_default_provider FROM users WHERE id = ${id}`) as { ai_default_provider: string | null }[];
      const preference = (await sql`SELECT ai_gemini_model FROM users WHERE id = ${id}`) as { ai_gemini_model: string | null }[];
      return sanitizeProviderState({
        v: 1,
        defaultId: user[0]?.ai_default_provider ?? null,
        geminiModel: effectiveGeminiModel(preference[0]?.ai_gemini_model),
        providers: rows.map((r) => ({
          id: String(r.id),
          kind: r.kind as ProviderKind,
          label: String(r.label),
          model: String(r.model),
          effort: (r.effort as StoredProvider["effort"]) ?? "medium",
          baseUrl: (r.base_url as string | null) ?? null,
          enabled: Boolean(r.enabled),
          keyCipher: String(r.key_ciphertext),
          keyHint: String(r.key_hint),
          lastTest: (r.last_test as StoredProvider["lastTest"]) ?? null,
          createdAt: new Date(r.created_at as string).toISOString(),
          updatedAt: new Date(r.updated_at as string).toISOString(),
        })),
      });
    },
    async save(next, prev) {
      const id = await userId();
      const keep = new Set(next.providers.map((p) => p.id));
      const queries = [
        ...prev.providers.filter((p) => !keep.has(p.id)).map((p) => sql`DELETE FROM ai_providers WHERE id = ${p.id} AND user_id = ${id}`),
        ...next.providers.map(
          (p) => sql`
          INSERT INTO ai_providers (id, user_id, kind, label, model, effort, base_url, enabled, key_ciphertext, key_hint, last_test, created_at, updated_at)
          VALUES (${p.id}, ${id}, ${p.kind}, ${p.label}, ${p.model}, ${p.effort}, ${p.baseUrl}, ${p.enabled}, ${p.keyCipher}, ${p.keyHint}, ${p.lastTest ? JSON.stringify(p.lastTest) : null}, ${p.createdAt}, ${p.updatedAt})
          ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, model = EXCLUDED.model, effort = EXCLUDED.effort, base_url = EXCLUDED.base_url,
            enabled = EXCLUDED.enabled, key_ciphertext = EXCLUDED.key_ciphertext, key_hint = EXCLUDED.key_hint,
            last_test = EXCLUDED.last_test, updated_at = EXCLUDED.updated_at
          WHERE ai_providers.user_id = ${id}`,
        ),
        sql`UPDATE users SET ai_default_provider = ${next.defaultId}, ai_gemini_model = ${effectiveGeminiModel(next.geminiModel)} WHERE id = ${id}`,
      ];
      await sql.transaction(queries);
      return [];
    },
    ...fieldKeys(secret, session),
  };
}

export function storageInfo(): { mode: ProviderStorage; note: string } {
  const caps = capabilities();
  if (caps.database && caps.encryption) return { mode: "database", note: "" };
  if (sessionSecret()) {
    const hint = caps.database && !caps.encryption ? " Set ENCRYPTION_KEY on the server to save keys in the database instead." : "";
    return {
      mode: "session",
      note: `Session-only: keys are kept encrypted in an HTTP-only cookie on this device. They aren't saved in any database and are deleted when you sign out or your session ends (7 days).${hint}`,
    };
  }
  return { mode: "unavailable", note: "The server isn't configured to store AI provider keys." };
}

export function openStore(req: Request, session: SessionData): ProviderStore {
  const info = storageInfo();
  const sql = db();
  const enc = encryptionSecret();
  if (info.mode === "database" && sql && enc) return dbStore(sql, session, enc);
  const secret = enc ?? sessionSecret();
  if (info.mode === "session" && secret) return cookieStore(req, session, secret, info.note);
  throw new HttpError(503, "AI_NOT_CONFIGURED", info.note);
}

/** Operator-supplied keys (OPENAI_API_KEY, …) — usable by every signed-in user, never shown. */
export function platformProviders(env: Record<string, string | undefined> = process.env, geminiModel?: string): (PlatformProvider & { apiKey: string })[] {
  const out: (PlatformProvider & { apiKey: string })[] = [];
  const add = (kind: ProviderKind, key: string | undefined, model: string | undefined) => {
    if (!isSet(key)) return;
    out.push({ id: `platform:${kind}`, kind, label: `${PROVIDERS[kind].name} (server)`, model: isSet(model) ? model : PROVIDERS[kind].defaultModel, effort: "medium", apiKey: key });
  };
  add("openai", env.OPENAI_API_KEY, env.OPENAI_MODEL);
  add("anthropic", env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL);
  add("gemini", geminiKeys(env)[0], effectiveGeminiModel(geminiModel ?? (isSet(env.GEMINI_MODEL) ? env.GEMINI_MODEL : null)));
  const preferred = geminiKeys(env).length ? "gemini" : env.AI_DEFAULT_PROVIDER?.trim().toLowerCase();
  if (!preferred) return out;
  const index = out.findIndex((p) => p.kind === preferred);
  return index > 0 ? [out[index]!, ...out.slice(0, index), ...out.slice(index + 1)] : out;
}

export const publicPlatform = (geminiModel?: string): PlatformProvider[] => platformProviders(process.env, geminiModel).map(({ apiKey: _k, ...p }) => p);
