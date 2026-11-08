import { decryptField, encryptField } from "./crypto.js";
import { db } from "./db.js";
import { encryptionSecret } from "./env.js";
import { HttpError } from "./http.js";
import { log } from "./log.js";
import type { SessionData } from "./session.js";
import { userRowId } from "./ai/store.js";

/**
 * Per-project Live server variables (DATABASE_URL, AUTH_SECRET, …).
 *  - Stored only as AES-256-GCM ciphertext bound to user + repository + name.
 *  - Values never leave the server: the API returns names and timestamps only, and values are
 *    decrypted solely to start that user's own preview sandbox. Nothing here logs a value.
 *  - Needs DATABASE_URL and ENCRYPTION_KEY on the server; without them the feature reports
 *    itself unavailable (Live server still works without variables).
 */

export const PREVIEW_ENV_LIMITS = { maxVars: 40, maxValueBytes: 16_384, maxTotalBytes: 65_536, maxNameLength: 64 } as const;

export const PREVIEW_ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Names the sandbox sets itself, or that would change how the runtime starts. */
const RESERVED = new Set([
  "PATH", "HOME", "USER", "SHELL", "PWD", "HOST", "PORT", "CI", "LD_PRELOAD", "LD_LIBRARY_PATH",
  "JAVA_HOME", "PUB_CACHE", "GRADLE_USER_HOME", "GRADLE_OPTS", "MAVEN_OPTS", "FLUTTER_ROOT", "SDK",
]);
const RESERVED_PREFIXES = ["VERCEL_", "__VITE_", "CHRONO_"];

export function previewEnvNameError(name: string): string | null {
  if (!name) return "Enter a variable name.";
  if (name.length > PREVIEW_ENV_LIMITS.maxNameLength) return "Variable names can be up to 64 characters.";
  if (!PREVIEW_ENV_NAME.test(name)) return "Use letters, digits and underscores, and don't start with a digit.";
  const upper = name.toUpperCase();
  if (RESERVED.has(upper) || RESERVED_PREFIXES.some((p) => upper.startsWith(p))) return name + " is set by the preview sandbox and can't be changed.";
  return null;
}

/** `owner/repo`, lower-cased: GitHub names are case-insensitive. */
export function previewEnvRepoKey(owner: string, repo: string): string {
  return (owner + "/" + repo).toLowerCase();
}

function aad(session: SessionData, repoKey: string, name: string): string {
  return "user:" + session.user.id + "|preview-env:" + repoKey + "|" + name;
}

export type PreviewEnvAvailability = { available: true } | { available: false; reason: string };

export function previewEnvAvailability(): PreviewEnvAvailability {
  if (!db()) return { available: false, reason: "Saving preview variables needs a database on the Chrono server (DATABASE_URL)." };
  if (!encryptionSecret()) return { available: false, reason: "Saving preview variables needs ENCRYPTION_KEY on the Chrono server." };
  return { available: true };
}

type Sql = NonNullable<ReturnType<typeof db>>;

let tableReady: Promise<void> | null = null;
function ensureTable(sql: Sql): Promise<void> {
  tableReady ??= Promise.resolve(sql`
    CREATE TABLE IF NOT EXISTS preview_env (
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      repo TEXT NOT NULL,
      name TEXT NOT NULL,
      value_ciphertext TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, repo, name)
    )`).then(
    () => undefined,
    (error: unknown) => {
      tableReady = null;
      throw error;
    },
  );
  return tableReady;
}

function requireStore(): { sql: Sql; secret: string } {
  const sql = db();
  const secret = encryptionSecret();
  if (!sql || !secret) {
    const status = previewEnvAvailability();
    throw new HttpError(503, "BACKEND_UNAVAILABLE", status.available ? "Preview variables are unavailable." : status.reason);
  }
  return { sql, secret };
}

export interface PreviewEnvEntry {
  name: string;
  updatedAt: string;
}

export async function listPreviewEnv(session: SessionData, owner: string, repo: string): Promise<PreviewEnvEntry[]> {
  const { sql } = requireStore();
  await ensureTable(sql);
  const uid = await userRowId(sql, session);
  const rows = (await sql`
    SELECT name, updated_at FROM preview_env
    WHERE user_id = ${uid} AND repo = ${previewEnvRepoKey(owner, repo)}
    ORDER BY name`) as { name: string; updated_at: string | Date }[];
  return rows.map((row) => ({ name: row.name, updatedAt: new Date(row.updated_at).toISOString() }));
}

export async function setPreviewEnv(session: SessionData, owner: string, repo: string, name: string, value: string): Promise<void> {
  const problem = previewEnvNameError(name);
  if (problem) throw new HttpError(422, "VALIDATION_FAILED", problem);
  if (new TextEncoder().encode(value).byteLength > PREVIEW_ENV_LIMITS.maxValueBytes) {
    throw new HttpError(413, "VALIDATION_FAILED", "Values can be up to 16 KB.");
  }
  if (value.includes("\u0000")) throw new HttpError(422, "VALIDATION_FAILED", "Values can't contain null characters.");
  const { sql, secret } = requireStore();
  await ensureTable(sql);
  const uid = await userRowId(sql, session);
  const repoKey = previewEnvRepoKey(owner, repo);
  const existing = (await sql`
    SELECT name, length(value_ciphertext) AS size FROM preview_env WHERE user_id = ${uid} AND repo = ${repoKey}`) as { name: string; size: number }[];
  const others = existing.filter((row) => row.name !== name);
  if (others.length >= PREVIEW_ENV_LIMITS.maxVars) {
    throw new HttpError(409, "VALIDATION_FAILED", "A project can have up to " + PREVIEW_ENV_LIMITS.maxVars + " preview variables.");
  }
  const cipher = await encryptField(value, secret, aad(session, repoKey, name));
  // Ciphertext is ~4/3 of the value; this bounds the decrypted total passed to one sandbox.
  if (others.reduce((n, row) => n + Number(row.size), 0) + cipher.length > (PREVIEW_ENV_LIMITS.maxTotalBytes * 4) / 3 + 1024) {
    throw new HttpError(413, "VALIDATION_FAILED", "This project's preview variables are over the 64 KB total.");
  }
  await sql`
    INSERT INTO preview_env (user_id, repo, name, value_ciphertext, updated_at)
    VALUES (${uid}, ${repoKey}, ${name}, ${cipher}, now())
    ON CONFLICT (user_id, repo, name) DO UPDATE SET value_ciphertext = EXCLUDED.value_ciphertext, updated_at = now()`;
}

export async function deletePreviewEnv(session: SessionData, owner: string, repo: string, name: string): Promise<void> {
  const { sql } = requireStore();
  await ensureTable(sql);
  const uid = await userRowId(sql, session);
  await sql`DELETE FROM preview_env WHERE user_id = ${uid} AND repo = ${previewEnvRepoKey(owner, repo)} AND name = ${name}`;
}

/**
 * Decrypted variables for starting this user's sandbox. Never throws: without storage, or when a
 * value can't be decrypted (the server key changed), the preview starts without it.
 */
export async function loadPreviewEnv(session: SessionData, owner: string, repo: string): Promise<{ env: Record<string, string>; unreadable: string[] }> {
  const sql = db();
  const secret = encryptionSecret();
  if (!sql || !secret) return { env: {}, unreadable: [] };
  try {
    await ensureTable(sql);
    const uid = await userRowId(sql, session);
    const repoKey = previewEnvRepoKey(owner, repo);
    const rows = (await sql`
      SELECT name, value_ciphertext FROM preview_env WHERE user_id = ${uid} AND repo = ${repoKey}`) as { name: string; value_ciphertext: string }[];
    const env: Record<string, string> = {};
    const unreadable: string[] = [];
    for (const row of rows) {
      if (previewEnvNameError(row.name)) continue;
      const value = await decryptField(row.value_ciphertext, secret, aad(session, repoKey, row.name));
      if (value === null) unreadable.push(row.name);
      else env[row.name] = value;
    }
    return { env, unreadable };
  } catch (error) {
    log("warn", "preview env load failed", { error: error instanceof Error ? error.name : "unknown" });
    return { env: {}, unreadable: [] };
  }
}
