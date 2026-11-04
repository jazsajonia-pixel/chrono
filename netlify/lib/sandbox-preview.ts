import { createHash } from "node:crypto";
import { HttpError } from "./http.js";
import { parse, pathSchema } from "./validate.js";

export const PREVIEW_PORT = 3000;
export const MAX_PREVIEW_FILES = 350;
export const MAX_PREVIEW_FILE_BYTES = 500_000;
export const MAX_PREVIEW_TOTAL_BYTES = 1_800_000;
/** Binary assets (images, fonts, …) are copied from GitHub at the previewed commit. */
export const MAX_PREVIEW_ASSETS = 400;
export const MAX_PREVIEW_ASSET_BYTES = 8_000_000;
export const MAX_PREVIEW_ASSET_TOTAL_BYTES = 40_000_000;

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
  /**
   * The script wraps several processes (concurrently, npm-run-all, turbo, `a && b`…), so host/port
   * flags can't reach the dev server. Run it untouched and forward PREVIEW_PORT to whatever port the
   * app opens (see PREVIEW_PROXY_SOURCE).
   */
  proxy?: boolean;
}

/** `vite …` / `next dev …` run directly (optionally behind env assignments or npx), with nothing chained. */
function runsDirectly(command: string, binary: "vite" | "next"): boolean {
  if (/&&|\|\||[;|&]/.test(command)) return false;
  const words = command.trim().split(/\s+/).filter((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word));
  if (words[0] === "npx" || words[0] === "cross-env") words.shift();
  return words[0] === binary;
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
  "sketch", "sqlite", "db", "avif", "bmp", "tif", "tiff", "heic", "jfif",
  "mp3", "wav", "ogg", "m4a", "flac", "glb", "bin",
]);

/** Shared rule for both text files and assets: never copy credentials, VCS data or generated output. */
function isForbiddenPath(path: string): boolean {
  const parts = path.split("/");
  const filename = parts[parts.length - 1] ?? "";
  const extension = filename.includes(".") ? filename.split(".").pop()?.toLowerCase() ?? "" : "";
  return parts.some((part) => EXCLUDED_SEGMENTS.has(part.toLowerCase())) ||
    parts.some((part) => /^\.env(?:$|\.)/i.test(part)) ||
    parts.some((part) => SENSITIVE_FILES.has(part.toLowerCase())) ||
    SENSITIVE_EXTENSIONS.has(extension);
}

/**
 * Validate the asset paths the client could not send as text. Unsafe, duplicate or text-overlapping
 * paths are dropped rather than failing the preview; the files themselves come from GitHub.
 */
export function prepareAssetPaths(paths: unknown, textPaths: ReadonlySet<string>): string[] {
  if (paths === undefined) return [];
  if (!Array.isArray(paths)) throw new HttpError(422, "VALIDATION_FAILED", "assets must be a list of paths.");
  const accepted: string[] = [];
  const seen = new Set<string>();
  for (const raw of paths) {
    const path = parse(pathSchema, raw, "asset path");
    if (isForbiddenPath(path) || textPaths.has(path) || seen.has(path)) continue;
    seen.add(path);
    accepted.push(path);
    if (accepted.length >= MAX_PREVIEW_ASSETS) break;
  }
  return accepted;
}

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
  const command = String(scripts[script]);
  if (dependencies.next) {
    if (script === "dev" && !runsDirectly(command, "next")) return { script, args: [], proxy: true };
    return { script, args: script === "dev" ? ["--hostname", "0.0.0.0", "--port", String(PREVIEW_PORT)] : [] };
  }
  if (dependencies.vite) {
    if (script === "dev" && !runsDirectly(command, "vite")) return { script, args: [], proxy: true };
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
    (runner.proxy
      // The forwarder owns PREVIEW_PORT; leave PORT unset so the app's own processes keep their defaults.
      ? "node .chrono-preview/proxy.mjs > .chrono-preview/proxy.log 2>&1 &\n" + "unset PORT\n" + command + "\n"
      : "HOST=0.0.0.0 PORT=" + PREVIEW_PORT + " " + command + "\n");
}

/**
 * Dependency-free forwarder for wrapped dev scripts. Listens on PREVIEW_PORT and forwards HTTP and
 * WebSocket (HMR) traffic to the app's page server: the first localhost URL in server.log that
 * answers with HTML, else common dev ports. Rewrites Host so dev-server host checks pass.
 * Answers 502 until the app is up, which the status check treats as "still starting".
 */
export const PREVIEW_PROXY_SOURCE = `import http from "node:http";
import net from "node:net";
import { readFileSync } from "node:fs";
const LISTEN = ${PREVIEW_PORT};
const COMMON = [5173, 3001, 4321, 8080, 4200, 8000, 5000, 3002, 8888];
let target = null;
let probing = null;
function candidates() {
  let log = "";
  try { log = readFileSync("/vercel/sandbox/.chrono-preview/server.log", "utf8"); } catch {}
  const clean = log.replace(/\\u001b\\[[0-9;]*m/g, "");
  const seen = [...clean.matchAll(/https?:\\/\\/(?:localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0|\\[::1?\\]):(\\d{2,5})/g)].map((m) => Number(m[1]));
  return [...new Set([...seen, ...COMMON])].filter((p) => p !== LISTEN);
}
function probe(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: "localhost", port, path: "/", headers: { host: "localhost:" + port, accept: "text/html" }, timeout: 1500 }, (res) => {
      res.resume();
      resolve(String(res.headers["content-type"] || "").includes("text/html") ? port : null);
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}
async function findTarget() {
  if (target) return target;
  probing ??= (async () => {
    for (const port of candidates()) if (await probe(port)) { target = port; console.log("forwarding to " + port); break; }
    probing = null;
    return target;
  })();
  return probing;
}
setInterval(() => { if (!target) void findTarget(); }, 1000);
const server = http.createServer(async (req, res) => {
  const port = await findTarget();
  if (!port) { res.writeHead(502, { "content-type": "text/plain" }); res.end("Starting the app\\u2026"); return; }
  const headers = { ...req.headers, host: "localhost:" + port, "x-forwarded-host": req.headers.host || "", "x-forwarded-proto": "https" };
  const upstream = http.request({ host: "localhost", port, method: req.method, path: req.url, headers }, (up) => {
    res.writeHead(up.statusCode || 502, up.headers);
    up.pipe(res);
  });
  upstream.on("error", () => { target = null; if (!res.headersSent) res.writeHead(502); res.end(); });
  req.pipe(upstream);
});
server.on("upgrade", async (req, socket, head) => {
  const port = await findTarget();
  if (!port) return socket.destroy();
  const up = net.connect({ host: "localhost", port }, () => {
    const lines = [req.method + " " + req.url + " HTTP/1.1"];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i];
      lines.push(name + ": " + (name.toLowerCase() === "host" ? "localhost:" + port : req.rawHeaders[i + 1]));
    }
    up.write(lines.join("\\r\\n") + "\\r\\n\\r\\n");
    if (head && head.length) up.write(head);
    socket.pipe(up).pipe(socket);
  });
  up.on("error", () => socket.destroy());
  socket.on("error", () => up.destroy());
});
server.listen(LISTEN, "0.0.0.0");
`;
