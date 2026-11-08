import { createHash } from "node:crypto";
import { HttpError } from "./http.js";
import { parse, pathSchema } from "./validate.js";
import { detectLiveRuntime, LIVE_PREVIEW_PORT, type LiveRuntime } from "../../src/lib/live-runtime.js";

export type PreviewRunner = LiveRuntime;

export const PREVIEW_PORT = LIVE_PREVIEW_PORT;
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
  "mp3", "wav", "ogg", "m4a", "flac", "glb", "bin", "jar",
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

/** Pick the runtime for the uploaded files (same rules as the clients, see src/lib/live-runtime.ts). */
export async function previewRunner(files: PreviewFile[]): Promise<PreviewRunner> {
  const byPath = new Map(files.map((file) => [file.path, file.content]));
  const runtime = await detectLiveRuntime([...byPath.keys()], (path) => byPath.get(path) ?? null);
  if (runtime.kind === "unsupported") {
    throw new HttpError(422, runtime.reason.includes("not valid JSON") ? "VALIDATION_FAILED" : "UNSUPPORTED_PROJECT", runtime.reason + " " + runtime.hint);
  }
  return runtime;
}

/** Sandbox lifetime: SDK installs and compiles need longer than a Node dev server. */
export function previewTimeoutMs(runner: PreviewRunner): number {
  return (runner.kind === "node" ? 10 : 20) * 60 * 1000;
}

/** Name for the runtime in status messages. */
export function previewKindLabel(runner: PreviewRunner): string {
  return runner.label;
}

const q = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";

/**
 * Shared shell prelude. SDKs, JDKs and package caches live under $HOME/.chrono-sdk, outside the
 * workspace folder that is reset on every start, so a resumed sandbox snapshot reuses them.
 * `pkg` installs system packages with dnf (Vercel Sandbox is Amazon Linux 2023) or apt elsewhere.
 */
const PRELUDE =
  "#!/usr/bin/env bash\n" +
  "set -Eeuo pipefail\n" +
  "cd /vercel/sandbox\n" +
  "mkdir -p .chrono-preview\n" +
  "printf 'installing\\n' > .chrono-preview/state\n" +
  "exec > .chrono-preview/server.log 2>&1\n" +
  "trap 'code=$?; printf \"failed\\n\" > .chrono-preview/state; printf \"\\nPreview startup failed (exit %s).\\n\" \"$code\" >> .chrono-preview/server.log; tail -n 60 .chrono-preview/server.log > .chrono-preview/error.log; exit \"$code\"' ERR\n" +
  "SDK=\"${HOME:-/tmp}/.chrono-sdk\"\n" +
  "mkdir -p \"$SDK\"\n" +
  "state() { printf '%s\\n' \"$1\" > /vercel/sandbox/.chrono-preview/state; }\n" +
  "pkg() { if command -v dnf >/dev/null 2>&1; then sudo dnf install -y -q \"$@\"; else sudo apt-get update -qq && sudo apt-get install -y -qq \"$@\"; fi; }\n" +
  // Tools the SDK installers need; Vercel Sandbox ships them, other hosts may not.
  "need() { for c in \"$@\"; do command -v \"$c\" >/dev/null 2>&1 || pkg \"$c\"; done; }\n";

function jdkSetup(version: number): string {
  // Corretto on Amazon Linux; OpenJDK on Debian/Ubuntu (local test runs).
  return "state installing-sdk\n" +
    "if command -v dnf >/dev/null 2>&1; then\n" +
    "  [ -d /usr/lib/jvm/java-" + version + "-amazon-corretto ] || pkg java-" + version + "-amazon-corretto-devel\n" +
    "  export JAVA_HOME=/usr/lib/jvm/java-" + version + "-amazon-corretto\n" +
    "else\n" +
    "  [ -d /usr/lib/jvm/java-" + version + "-openjdk-amd64 ] || pkg openjdk-" + version + "-jdk-headless\n" +
    "  export JAVA_HOME=/usr/lib/jvm/java-" + version + "-openjdk-amd64\n" +
    "fi\n" +
    "export PATH=\"$JAVA_HOME/bin:$PATH\"\n" +
    "java -version\n";
}

/** Forward PREVIEW_PORT to whatever port the app opens; `any` also accepts non-HTML (API) servers. */
function forwarder(any: boolean): string {
  return (any ? "CHRONO_PROXY_ANY=1 " : "") + "node .chrono-preview/proxy.mjs > .chrono-preview/proxy.log 2>&1 &\n";
}

export function previewStartScript(runner: PreviewRunner): string {
  switch (runner.kind) {
    case "node": {
      const command = "npm run " + runner.script + (runner.args.length ? " -- " + runner.args.join(" ") : "");
      return PRELUDE +
        "if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi\n" +
        "state starting\n" +
        (runner.proxy
          // The forwarder owns PREVIEW_PORT; leave PORT unset so the app's own processes keep their defaults.
          ? forwarder(false) + "unset PORT\n" + command + "\n"
          : "HOST=0.0.0.0 PORT=" + PREVIEW_PORT + " " + command + "\n");
    }
    case "flutter-web":
      return PRELUDE +
        "state installing-sdk\n" +
        "need git curl unzip which\n" +
        "export PUB_CACHE=\"$SDK/pub-cache\" FLUTTER_SUPPRESS_ANALYTICS=true CI=true\n" +
        "if [ ! -x \"$SDK/flutter/bin/flutter\" ]; then\n" +
        "  rm -rf \"$SDK/flutter\"\n" +
        "  git clone --depth 1 --branch stable https://github.com/flutter/flutter.git \"$SDK/flutter\"\n" +
        "fi\n" +
        "export PATH=\"$SDK/flutter/bin:$PUB_CACHE/bin:$PATH\"\n" +
        "flutter --disable-analytics >/dev/null 2>&1 || true\n" +
        "flutter config --no-analytics --enable-web >/dev/null\n" +
        "flutter --version\n" +
        "state installing\n" +
        // Projects created without web support get the standard web/ folder (index.html, manifest).
        "[ -f web/index.html ] || flutter create --platforms web --project-name " + q(runner.projectName) + " --no-pub .\n" +
        "flutter pub get\n" +
        "state building\n" +
        "flutter build web --release --no-wasm-dry-run\n" +
        "state starting\n" +
        "exec node .chrono-preview/static.mjs build/web\n";
    case "dart":
      return PRELUDE +
        "state installing-sdk\n" +
        "need curl unzip\n" +
        "export PUB_CACHE=\"$SDK/pub-cache\"\n" +
        "if [ ! -x \"$SDK/dart-sdk/bin/dart\" ]; then\n" +
        "  arch=x64; [ \"$(uname -m)\" = aarch64 ] && arch=arm64\n" +
        "  curl -fsSL -o /tmp/dart.zip \"https://storage.googleapis.com/dart-archive/channels/stable/release/latest/sdk/dartsdk-linux-$arch-release.zip\"\n" +
        "  unzip -q -o /tmp/dart.zip -d \"$SDK\" && rm -f /tmp/dart.zip\n" +
        "fi\n" +
        "export PATH=\"$SDK/dart-sdk/bin:$PATH\"\n" +
        "dart --disable-analytics >/dev/null 2>&1 || true\n" +
        "dart --version\n" +
        "state installing\n" +
        "dart pub get\n" +
        "state starting\n" +
        // Most Dart servers read PORT (shelf template default 8080); the forwarder finds the real port.
        forwarder(true) +
        "export PORT=8080\n" +
        "dart run " + q(runner.entry) + "\n";
    case "gradle":
      return PRELUDE +
        // Install the toolchain JDK first so JAVA_HOME ends up pointing at the one that runs Gradle.
        (runner.toolchainJdk ? jdkSetup(runner.toolchainJdk) + "TOOLCHAIN_HOME=\"$JAVA_HOME\"\n" : "") +
        jdkSetup(runner.jdk) +
        "export GRADLE_USER_HOME=\"$SDK/gradle\" GRADLE_OPTS=\"-Xmx1536m -Dorg.gradle.daemon=false\"\n" +
        "chmod +x gradlew\n" +
        "state starting\n" +
        forwarder(!/BrowserDevelopmentRun$/.test(runner.task)) +
        "unset PORT\n" +
        "./gradlew --no-daemon --console=plain -Pkotlin.compiler.execution.strategy=in-process " +
        (runner.toolchainJdk ? "-Porg.gradle.java.installations.paths=\"$TOOLCHAIN_HOME\" " : "") + q(runner.task) + "\n";
    case "maven":
      return PRELUDE +
        jdkSetup(runner.jdk) +
        "export MAVEN_OPTS=\"-Xmx1024m -Dmaven.repo.local=$SDK/m2\"\n" +
        (runner.wrapper
          ? "chmod +x mvnw\nMVN=./mvnw\n"
          : "if [ ! -x \"$SDK/maven/bin/mvn\" ]; then\n" +
            "  curl -fsSL https://archive.apache.org/dist/maven/maven-3/3.9.9/binaries/apache-maven-3.9.9-bin.tar.gz | tar -xz -C \"$SDK\"\n" +
            "  mv \"$SDK/apache-maven-3.9.9\" \"$SDK/maven\"\n" +
            "fi\nMVN=\"$SDK/maven/bin/mvn\"\n") +
        "state starting\n" +
        forwarder(true) +
        "unset PORT\n" +
        "\"$MVN\" -B -q -Dmaven.repo.local=\"$SDK/m2\" " + q(runner.goal) + "\n";
  }
}

/** Static file server for build output (Flutter web): SPA fallback to index.html, wasm MIME type. */
export const PREVIEW_STATIC_SOURCE = `import http from "node:http";
import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
const root = normalize(process.argv[2] || ".");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css", ".wasm": "application/wasm", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webp": "image/webp", ".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff", ".woff2": "font/woff2", ".map": "application/json", ".txt": "text/plain" };
http.createServer((req, res) => {
  let path = decodeURIComponent((req.url || "/").split("?")[0]);
  let file = normalize(join(root, path));
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  let st = null;
  try { st = statSync(file); if (st.isDirectory()) { file = join(file, "index.html"); st = statSync(file); } } catch { st = null; }
  if (!st) { file = join(root, "index.html"); try { st = statSync(file); } catch { res.writeHead(404); res.end("Not found"); return; } }
  res.writeHead(200, { "content-type": types[extname(file).toLowerCase()] || "application/octet-stream", "cache-control": "no-cache" });
  createReadStream(file).pipe(res);
}).listen(${PREVIEW_PORT}, "0.0.0.0", () => console.log("Serving " + root + " on http://localhost:${PREVIEW_PORT}"));
`;

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
const COMMON = [5173, 3001, 4321, 8080, 4200, 8000, 5000, 3002, 8888, 8081, 9000];
const ANY = process.env.CHRONO_PROXY_ANY === "1";
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
      resolve(ANY || String(res.headers["content-type"] || "").includes("text/html") ? port : null);
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
