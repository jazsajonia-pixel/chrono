import { createHash } from "node:crypto";
import { HttpError } from "./http.js";
import { parse, pathSchema } from "./validate.js";

export const PREVIEW_PORT = 3000;
export const MAX_PREVIEW_FILES = 350;
export const MAX_PREVIEW_FILE_BYTES = 500_000;
export const MAX_PREVIEW_TOTAL_BYTES = 1_800_000;

/**
 * Private, loopback, link-local, multicast and reserved IPv4 ranges the sandbox may not reach.
 * The Vercel Sandbox API accepts IPv4 CIDRs only; IPv6 entries are rejected with 400 "Invalid CIDR".
 */
export const PREVIEW_DENY_SUBNETS: readonly string[] = [
  "0.0.0.0/8", "10.0.0.0/8", "127.0.0.0/8", "169.254.0.0/16",
  "172.16.0.0/12", "192.168.0.0/16", "224.0.0.0/4", "240.0.0.0/4",
];

/**
 * Vercel Functions receive the OIDC token per request (x-vercel-oidc-token header), which the
 * SDK reads from the request context, so running on Vercel (`VERCEL=1`) counts as configured.
 */
export function sandboxConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return !!env.VERCEL_OIDC_TOKEN || env.VERCEL === "1" ||
    (!!env.VERCEL_TOKEN && !!env.VERCEL_PROJECT_ID && !!env.VERCEL_TEAM_ID);
}

export interface PreviewFile {
  path: string;
  content: string;
}

export interface PreviewRunner {
  script: "dev" | "start";
  args: string[];
}

/** Stable per-user, repository and ref identity; never expose the raw user id in sandbox names. */
export function previewSandboxName(userId: string | number, owner: string, repo: string, ref: string): string {
  const key = [String(userId), owner.toLowerCase(), repo.toLowerCase(), ref].join(":");
  return "chrono-" + createHash("sha256").update(key).digest("hex").slice(0, 40);
}

const EXCLUDED_SEGMENTS = new Set([
  ".git", ".vercel", ".next", ".nuxt", ".cache", ".turbo", ".chrono-preview",
  "node_modules", "coverage", "dist", "build", ".ssh", ".aws", ".azure",
]);
const SENSITIVE_FILES = new Set([
  ".npmrc", ".yarnrc", ".pypirc", ".netrc", "credentials", "id_rsa", "id_ed25519",
]);
const SENSITIVE_EXTENSIONS = new Set(["pem", "key", "p12", "pfx", "jks", "keystore"]);
const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "ico", "pdf", "zip", "gz", "mp4",
  "mov", "webm", "woff", "woff2", "ttf", "otf", "eot", "wasm", "psd",
  "sketch", "sqlite", "db",
]);

/** Transfer text files only; never copy known local credentials, VCS data or generated files. */
export function preparePreviewFiles(files: PreviewFile[]): PreviewFile[] {
  if (!Array.isArray(files) || files.length === 0) {
    throw new HttpError(422, "VALIDATION_FAILED", "The workspace has no previewable text files.");
  }
  if (files.length > MAX_PREVIEW_FILES) {
    throw new HttpError(413, "VALIDATION_FAILED", "Live preview supports up to " + MAX_PREVIEW_FILES + " text files.");
  }

  const seen = new Set<string>();
  let totalBytes = 0;
  const accepted: PreviewFile[] = [];

  for (const file of files) {
    const path = parse(pathSchema, file.path, "file path");
    const parts = path.split("/");
    const filename = parts[parts.length - 1] ?? "";
    const extension = filename.includes(".") ? filename.split(".").pop()?.toLowerCase() ?? "" : "";
    if (
      parts.some((part) => EXCLUDED_SEGMENTS.has(part.toLowerCase())) ||
      parts.some((part) => /^\.env(?:$|\.)/i.test(part)) ||
      parts.some((part) => SENSITIVE_FILES.has(part.toLowerCase())) ||
      SENSITIVE_EXTENSIONS.has(extension) ||
      BINARY_EXTENSIONS.has(extension)
    ) {
      throw new HttpError(422, "VALIDATION_FAILED", "The workspace file \"" + path + "\" is not allowed in a live preview.");
    }
    if (seen.has(path)) {
      throw new HttpError(422, "VALIDATION_FAILED", "Duplicate workspace file: " + path);
    }
    seen.add(path);
    if (typeof file.content !== "string") {
      throw new HttpError(422, "VALIDATION_FAILED", "The workspace file \"" + path + "\" must be text.");
    }
    const bytes = Buffer.byteLength(file.content, "utf8");
    if (bytes > MAX_PREVIEW_FILE_BYTES) {
      throw new HttpError(413, "VALIDATION_FAILED", "\"" + path + "\" is too large to include in a live preview.");
    }
    totalBytes += bytes;
    if (totalBytes > MAX_PREVIEW_TOTAL_BYTES) {
      throw new HttpError(413, "VALIDATION_FAILED", "This workspace exceeds the 1.8 MB live preview limit.");
    }
    accepted.push({ path, content: file.content });
  }

  return accepted;
}

/** Determine a safe npm script and the host/port options for supported Node frameworks. */
export function previewRunner(files: PreviewFile[]): PreviewRunner {
  const packageFile = files.find((file) => file.path === "package.json");
  if (!packageFile) {
    throw new HttpError(422, "UNSUPPORTED_PROJECT", "Live Server Preview currently supports Node.js projects with a root package.json and a dev or start script.");
  }

  let manifest: {
    scripts?: Record<string, unknown>;
    dependencies?: Record<string, unknown>;
    devDependencies?: Record<string, unknown>;
  };
  try {
    manifest = JSON.parse(packageFile.content) as typeof manifest;
  } catch {
    throw new HttpError(422, "VALIDATION_FAILED", "package.json is not valid JSON.");
  }

  const scripts = manifest.scripts ?? {};
  const script = typeof scripts.dev === "string" ? "dev" : typeof scripts.start === "string" ? "start" : undefined;
  if (!script) {
    throw new HttpError(422, "UNSUPPORTED_PROJECT", "Add a dev or start script to package.json to use Live Server Preview.");
  }

  const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
  if (dependencies.next) {
    return { script, args: script === "dev" ? ["--hostname", "0.0.0.0", "--port", String(PREVIEW_PORT)] : [] };
  }
  if (dependencies.vite) {
    return { script, args: script === "dev" ? ["--host", "0.0.0.0", "--port", String(PREVIEW_PORT), "--strictPort"] : [] };
  }
  if (dependencies["react-scripts"]) return { script, args: [] };
  return { script, args: [] };
}

export function previewStartScript(runner: PreviewRunner): string {
  const command = "npm run " + runner.script + (runner.args.length ? " -- " + runner.args.join(" ") : "");
  return "#!/usr/bin/env bash\n" +
    "set -Eeuo pipefail\n" +
    "cd /vercel/sandbox\n" +
    "mkdir -p .chrono-preview\n" +
    "printf 'installing\\n' > .chrono-preview/state\n" +
    "exec > .chrono-preview/server.log 2>&1\n" +
    "trap 'code=$?; printf \"failed\\n\" > .chrono-preview/state; printf \"\\nPreview startup failed (exit %s).\\n\" \"$code\" >> .chrono-preview/server.log; tail -n 60 .chrono-preview/server.log > .chrono-preview/error.log; exit \"$code\"' ERR\n" +
    "if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi\n" +
    "printf 'starting\\n' > .chrono-preview/state\n" +
    "HOST=0.0.0.0 PORT=" + PREVIEW_PORT + " " + command + "\n";
}
