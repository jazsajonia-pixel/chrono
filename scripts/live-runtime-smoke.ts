/**
 * Runs the real live-preview start script for one fixture project, outside Vercel, and waits until
 * the preview port answers. Used by .github/workflows/live-runtimes.yml in an Amazon Linux 2023
 * container (the Vercel Sandbox OS). It needs /vercel/sandbox to be writable and passwordless sudo.
 *
 *   npx tsx scripts/live-runtime-smoke.ts <fixture-dir> <expected-kind> [minutes]
 *
 * This proves the scripts, SDK downloads and port forwarding work on that OS. It does not prove
 * the Vercel Sandbox API, its network policy or its public URL; only a real sandbox run does.
 */
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { detectLiveRuntime, LIVE_PREVIEW_PORT } from "../src/lib/live-runtime";
import { PREVIEW_PROXY_SOURCE, PREVIEW_STATIC_SOURCE, previewStartScript, previewTimeoutMs } from "../netlify/lib/sandbox-preview";

const [fixture, expected, minutesArg] = process.argv.slice(2);
if (!fixture || !expected) {
  console.error("usage: live-runtime-smoke.ts <fixture-dir> <expected-kind> [minutes]");
  process.exit(2);
}
const ROOT = "/vercel/sandbox";
const META = ROOT + "/.chrono-preview";

function walk(dir: string, base = dir, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === ".git" || name === "node_modules" || name === "build" || name === ".gradle") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, base, out);
    else out.push(relative(base, full));
  }
  return out;
}

const paths = walk(fixture);
const runtime = await detectLiveRuntime(paths, (p) => (existsSync(join(fixture, p)) ? readFileSync(join(fixture, p), "utf8") : null));
console.log("detected:", JSON.stringify(runtime));
if (runtime.kind !== expected) {
  console.error(`expected ${expected}, got ${runtime.kind}`);
  process.exit(1);
}
if (runtime.kind === "unsupported") process.exit(0);

rmSync(ROOT, { recursive: true, force: true });
mkdirSync(META, { recursive: true });
cpSync(fixture, ROOT, { recursive: true });
writeFileSync(META + "/start.sh", previewStartScript(runtime), { mode: 0o755 });
writeFileSync(META + "/" + (runtime.kind === "flutter-web" ? "static.mjs" : "proxy.mjs"), runtime.kind === "flutter-web" ? PREVIEW_STATIC_SOURCE : PREVIEW_PROXY_SOURCE);

const started = Date.now();
const limitMs = minutesArg ? Number(minutesArg) * 60_000 : previewTimeoutMs(runtime) - 60_000;
const child = spawn("bash", [META + "/start.sh"], { cwd: ROOT, env: { ...process.env, HOST: "0.0.0.0", PORT: String(LIVE_PREVIEW_PORT), CI: "1" }, stdio: "inherit", detached: true });
let exited: number | null = null;
child.on("exit", (code) => (exited = code ?? 1));

const read = (f: string) => { try { return readFileSync(META + "/" + f, "utf8"); } catch { return ""; } };
const finish = (ok: boolean, why: string) => {
  console.log(`\n${ok ? "PASS" : "FAIL"} ${runtime.kind} (${runtime.label}) after ${Math.round((Date.now() - started) / 1000)} s: ${why}`);
  console.log("---- server.log (last 80 lines) ----\n" + read("server.log").split("\n").slice(-80).join("\n"));
  try { process.kill(-child.pid!, "SIGTERM"); } catch { /* already gone */ }
  process.exit(ok ? 0 : 1);
};

let lastState = "";
for (;;) {
  const state = read("state").trim();
  if (state !== lastState) console.log(`[${Math.round((Date.now() - started) / 1000)} s] state: ${state}`);
  lastState = state;
  if (state === "failed" || exited !== null) finish(false, `start script exited (${exited ?? "failed state"})`);
  try {
    const res = await fetch(`http://127.0.0.1:${LIVE_PREVIEW_PORT}/`, { signal: AbortSignal.timeout(5000) });
    const body = await res.text();
    // The forwarder answers 502 "Starting the app…" until the real server is reachable.
    if (res.status !== 502) finish(true, `HTTP ${res.status} ${res.headers.get("content-type") ?? ""} · ${body.slice(0, 120).replace(/\s+/g, " ")}`);
  } catch { /* not listening yet */ }
  if (Date.now() - started > limitMs) finish(false, `no answer on port ${LIVE_PREVIEW_PORT} within ${Math.round(limitMs / 60_000)} min`);
  await new Promise((r) => setTimeout(r, 5000));
}
