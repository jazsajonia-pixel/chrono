/**
 * Server-side configuration. Reads process.env inside functions only.
 * Exposes *booleans* about what is configured — never the values themselves.
 */

type Env = Record<string, string | undefined>;

const PLACEHOLDER = /^(your-|replace-|changeme|xxx)/i;

/** A value counts as configured only if it's present and not a .env.example placeholder. */
export function isSet(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0 && !PLACEHOLDER.test(value.trim());
}

export interface Capabilities {
  githubOAuth: boolean;
  sessions: boolean;
  database: boolean;
  encryption: boolean;
  platformAiProviders: { openai: boolean; anthropic: boolean; gemini: boolean };
}

export function capabilities(env: Env = process.env): Capabilities {
  return {
    githubOAuth: isSet(env.GITHUB_CLIENT_ID) && isSet(env.GITHUB_CLIENT_SECRET),
    sessions: isSet(env.SESSION_SECRET) && (env.SESSION_SECRET?.length ?? 0) >= 32,
    database: isSet(env.DATABASE_URL),
    encryption: isSet(env.ENCRYPTION_KEY) && (env.ENCRYPTION_KEY?.trim().length ?? 0) >= 32,
    platformAiProviders: {
      openai: isSet(env.OPENAI_API_KEY),
      anthropic: isSet(env.ANTHROPIC_API_KEY),
      gemini: isSet(env.GEMINI_API_KEYS) || isSet(env.GEMINI_API_KEY),
    },
  };
}

export interface GitHubConfig {
  clientId: string;
  clientSecret: string;
  sessionSecret: string;
  apiUrl: string;
  webUrl: string;
}

/** Returns null when GitHub sign-in isn't fully configured. */
export function githubConfig(env: Env = process.env): GitHubConfig | null {
  const caps = capabilities(env);
  if (!caps.githubOAuth || !caps.sessions) return null;
  return {
    clientId: env.GITHUB_CLIENT_ID!,
    clientSecret: env.GITHUB_CLIENT_SECRET!,
    sessionSecret: env.SESSION_SECRET!,
    // Overridable for GitHub Enterprise or a local mock; defaults to github.com.
    apiUrl: (isSet(env.GITHUB_API_URL) ? env.GITHUB_API_URL : "https://api.github.com").replace(/\/$/, ""),
    webUrl: (isSet(env.GITHUB_WEB_URL) ? env.GITHUB_WEB_URL : "https://github.com").replace(/\/$/, ""),
  };
}

export function sessionSecret(env: Env = process.env): string | null {
  return capabilities(env).sessions ? env.SESSION_SECRET! : null;
}

/** Public base URL of the app (for OAuth redirect_uri). APP_URL wins; otherwise the request origin. */
export function appOrigin(req: Request, env: Env = process.env): string {
  if (isSet(env.APP_URL)) {
    try {
      return new URL(env.APP_URL).origin;
    } catch {
      /* fall through to request origin */
    }
  }
  return new URL(req.url).origin;
}

/**
 * When a production deployment is reachable on several hosts (e.g. a project domain and a branch
 * alias) but OAuth is bound to APP_URL, cookies set on the "other" host never reach the callback —
 * sign-in fails once and old sessions look expired. Returns the APP_URL origin the browser should
 * move to, or null when the request is already on it (or this isn't production).
 */
export function canonicalRedirectOrigin(req: Request, env: Env = process.env): string | null {
  if (!isSet(env.APP_URL)) return null;
  if (!(isProduction(env) || env.VERCEL_ENV === "production")) return null;
  const canonical = appOrigin(req, env);
  return canonical === new URL(req.url).origin ? null : canonical;
}

/** Secret used to encrypt stored AI provider keys, or null when ENCRYPTION_KEY isn't usable. */
export function encryptionSecret(env: Env = process.env): string | null {
  return capabilities(env).encryption ? env.ENCRYPTION_KEY!.trim() : null;
}

/* ── Production readiness (Phase 8) ─────────────────────────────── */

/** Netlify sets CONTEXT=production for production deploys; APP_ENV=production forces it elsewhere. */
export function isProduction(env: Env = process.env): boolean {
  return env.CONTEXT === "production" || env.APP_ENV === "production";
}

export interface ReadinessCheck {
  id: string;
  ok: boolean;
  /** error = the app is broken or unsafe in production; warn = degraded. */
  level: "error" | "warn";
  message: string;
}

/** Validate configuration. Messages name variables, never their values. */
export function readiness(env: Env = process.env, production = isProduction(env)): { ready: boolean; checks: ReadinessCheck[] } {
  const caps = capabilities(env);
  const checks: ReadinessCheck[] = [];
  const add = (id: string, ok: boolean, level: "error" | "warn", message: string) => checks.push({ id, ok, level, message });

  add("github-oauth", caps.githubOAuth, "error", "GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are required for GitHub sign-in.");
  add("session-secret", caps.sessions, "error", "SESSION_SECRET must be at least 32 random characters.");
  add("encryption-key", caps.encryption, "warn", "ENCRYPTION_KEY (32+ chars) is needed to save AI provider keys.");
  add("database", caps.database, "warn", "DATABASE_URL enables shared rate limits and saved AI providers across devices.");
  add("keys-distinct", !(caps.sessions && caps.encryption && env.SESSION_SECRET?.trim() === env.ENCRYPTION_KEY?.trim()), "warn", "Use different values for SESSION_SECRET and ENCRYPTION_KEY.");

  let appUrlOk = false;
  if (isSet(env.APP_URL)) {
    try {
      const u = new URL(env.APP_URL);
      appUrlOk = !production || u.protocol === "https:";
    } catch {
      appUrlOk = false;
    }
  }
  add("app-url", appUrlOk || (!production && !isSet(env.APP_URL)), production ? "error" : "warn", "APP_URL must be the site's https:// URL (used for the OAuth callback).");

  const secretVite = Object.keys(env).filter((k) => k.startsWith("VITE_") && /SECRET|KEY|TOKEN|PASSWORD|PRIVATE/i.test(k));
  add("no-client-secrets", secretVite.length === 0, "error", `Secret-looking VITE_* variables are bundled into client JavaScript: ${secretVite.join(", ") || "none"}.`);

  if (production) {
    add("no-private-ai-urls", env.AI_ALLOW_PRIVATE_BASE_URLS !== "true", "error", "AI_ALLOW_PRIVATE_BASE_URLS must not be set in production (SSRF risk). It is ignored there.");
    add("github-endpoints", !isSet(env.GITHUB_API_URL) && !isSet(env.GITHUB_WEB_URL), "warn", "GITHUB_API_URL / GITHUB_WEB_URL are overridden — only do this for GitHub Enterprise.");
    add("rate-limit-store", env.RATE_LIMIT_STORE !== "memory" && caps.database, "warn", "Rate limits are per function instance without DATABASE_URL (or with RATE_LIMIT_STORE=memory).");
  }
  return { ready: checks.every((c) => c.ok || c.level !== "error"), checks };
}
