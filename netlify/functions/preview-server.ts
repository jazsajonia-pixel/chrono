import type { Config } from "@netlify/functions";
import { z } from "zod";
import { handle, HttpError, json } from "../lib/http.js";
import { githubForRequest } from "../lib/gh-request.js";
import { requireSession } from "../lib/session.js";
import { rateLimit } from "../lib/security.js";
import { ownerSchema, parse, readJson, refSchema, repoSchema } from "../lib/validate.js";
import {
  MAX_PREVIEW_FILE_BYTES,
  PREVIEW_PORT,
  preparePreviewFiles,
  previewRunner,
  previewSandboxName,
  previewStartScript,
  type PreviewFile,
} from "../lib/sandbox-preview.js";

const fileSchema = z.object({
  path: z.string().min(1).max(1024),
  content: z.string().max(MAX_PREVIEW_FILE_BYTES),
});
const startSchema = z.object({
  action: z.literal("start"),
  owner: ownerSchema,
  repo: repoSchema,
  ref: refSchema,
  files: z.array(fileSchema).min(1).max(350),
});
const stopSchema = z.object({
  action: z.literal("stop"),
  owner: ownerSchema,
  repo: repoSchema,
  ref: refSchema,
});
const bodySchema = z.discriminatedUnion("action", [startSchema, stopSchema]);
type PreviewBody = z.infer<typeof bodySchema>;

const ROOT = "/vercel/sandbox";
const PORT_TIMEOUT = 10 * 60 * 1000;
const SNAPSHOT_TTL = 24 * 60 * 60 * 1000;

function sandboxConfigured(): boolean {
  return !!process.env.VERCEL_OIDC_TOKEN ||
    (!!process.env.VERCEL_TOKEN && !!process.env.VERCEL_PROJECT_ID && !!process.env.VERCEL_TEAM_ID);
}

async function getSandboxSdk() {
  if (!sandboxConfigured()) {
    throw new HttpError(503, "BACKEND_UNAVAILABLE", "Live Server Preview requires Vercel Sandbox credentials.");
  }
  return import("@vercel/sandbox");
}

function isMissingSandbox(error: unknown): boolean {
  const e = error as { status?: number; statusCode?: number; code?: string; message?: string };
  return e?.status === 404 || e?.statusCode === 404 || e?.code === "not_found" ||
    /not.?found|does not exist/i.test(e?.message ?? "");
}

async function findSandbox(name: string) {
  const { Sandbox } = await getSandboxSdk();
  try {
    return await Sandbox.get({ name });
  } catch (error) {
    if (isMissingSandbox(error)) return null;
    throw error;
  }
}

async function authorizeRepository(req: Request, owner: string, repo: string) {
  const { gh, session } = await githubForRequest(req);
  await gh.get("/repos/" + owner + "/" + repo);
  return session;
}

async function startPreview(req: Request, body: Extract<PreviewBody, { action: "start" }>) {
  const session = await authorizeRepository(req, body.owner, body.repo);
  await rateLimit("preview-start:" + session.user.id, 4, 60_000);

  const files = preparePreviewFiles(body.files as PreviewFile[]);
  const runner = previewRunner(files);
  const name = previewSandboxName(session.user.id, body.owner, body.repo, body.ref);
  const { Sandbox } = await getSandboxSdk();

  try {
    const existing = await findSandbox(name);
    if (existing?.status === "running" || existing?.status === "stopping") {
      await existing.stop();
    }

    const sandbox = await Sandbox.getOrCreate({
      name,
      resume: true,
      image: "vercel/sandbox/node:24",
      region: "sin1",
      timeout: PORT_TIMEOUT,
      ports: [PREVIEW_PORT],
      persistent: true,
      snapshotExpiration: SNAPSHOT_TTL,
      keepLastSnapshots: { count: 1, expiration: SNAPSHOT_TTL, deleteEvicted: true },
      networkPolicy: {
        allow: ["*"],
        subnets: {
          deny: [
            "0.0.0.0/8", "10.0.0.0/8", "127.0.0.0/8", "169.254.0.0/16",
            "172.16.0.0/12", "192.168.0.0/16", "224.0.0.0/4", "240.0.0.0/4",
            "::/128", "::1/128", "::ffff:0:0/96", "fc00::/7", "fe80::/10", "ff00::/8",
          ],
        },
      },
      tags: { "managed-by": "chrono" },
    });

    const reset = await sandbox.runCommand("bash", [
      "-lc",
      "find . -mindepth 1 -maxdepth 1 ! -name .chrono-preview -exec rm -rf -- {} +; mkdir -p .chrono-preview; rm -f .chrono-preview/*",
    ], { timeoutMs: 15_000 });
    if (reset.exitCode !== 0) {
      throw new Error("Could not prepare the sandbox workspace.");
    }

    await sandbox.writeFiles([
      ...files.map((file) => ({ path: file.path, content: file.content })),
      { path: ".chrono-preview/start.sh", content: previewStartScript(runner), mode: 0o755 },
      { path: ".chrono-preview/ref", content: body.ref },
      { path: ".chrono-preview/state", content: "queued" },
    ]);

    await sandbox.runCommand({
      cmd: "bash",
      args: [".chrono-preview/start.sh"],
      cwd: ROOT,
      env: { HOST: "0.0.0.0", PORT: String(PREVIEW_PORT), CI: "1" },
      detached: true,
      timeoutMs: PORT_TIMEOUT - 10_000,
    });

    return json({
      status: "starting",
      url: sandbox.domain(PREVIEW_PORT),
      files: files.length,
      bytes: files.reduce((n, file) => n + Buffer.byteLength(file.content, "utf8"), 0),
    }, { status: 202 });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error("Chrono live preview start failed", {
      name,
      error: error instanceof Error ? error.name : "unknown",
    });
    throw new HttpError(502, "BACKEND_UNAVAILABLE", "Vercel Sandbox could not start this project. Check the project's run script and try again.");
  }
}

async function stopPreview(req: Request, body: Extract<PreviewBody, { action: "stop" }>) {
  const session = await requireSession(req);
  const name = previewSandboxName(session.user.id, body.owner, body.repo, body.ref);
  const sandbox = await findSandbox(name);
  if (sandbox && (sandbox.status === "running" || sandbox.status === "stopping")) {
    try {
      await sandbox.stop();
    } catch {
      throw new HttpError(502, "BACKEND_UNAVAILABLE", "Vercel Sandbox couldn't stop the preview. Try again.");
    }
  }
  return json({ status: "stopped" });
}

async function getPreview(req: Request) {
  const url = new URL(req.url);
  const owner = parse(ownerSchema, url.searchParams.get("owner"), "owner");
  const repo = parse(repoSchema, url.searchParams.get("repo"), "repo");
  const ref = parse(refSchema, url.searchParams.get("ref"), "ref");
  const session = await requireSession(req);
  const sandbox = await findSandbox(previewSandboxName(session.user.id, owner, repo, ref));

  if (!sandbox) return json({ status: "idle" });
  if (sandbox.status !== "running") {
    return json({ status: sandbox.status === "stopping" ? "stopping" : "stopped" });
  }

  const previewUrl = sandbox.domain(PREVIEW_PORT);
  const state = await sandbox.fs.readFile(".chrono-preview/state", "utf8").catch(() => "starting");
  if (state.trim() === "failed") {
    const logs = await sandbox.fs.readFile(".chrono-preview/error.log", "utf8").catch(() => "");
    return json({
      status: "failed",
      message: "The project server stopped during startup.",
      logs: logs.slice(-6000),
    });
  }

  try {
    const response = await fetch(previewUrl, {
      signal: AbortSignal.timeout(2500),
      redirect: "manual",
    });
    if (response.status < 500) return json({ status: "running", url: previewUrl });
  } catch {
    // The VM may be running while dependencies install or the framework compiles.
  }

  const logs = await sandbox.fs.readFile(".chrono-preview/server.log", "utf8").catch(() => "");
  return json({
    status: "starting",
    url: previewUrl,
    message: state.trim() === "installing" ? "Installing project dependencies…" : "Starting the project server…",
    logs: logs.slice(-6000),
  });
}

export default handle(["GET", "POST"], async (req) => {
  if (req.method === "GET") return getPreview(req);
  const body = await readJson(req, bodySchema, 4_000_000);
  return body.action === "start" ? startPreview(req, body) : stopPreview(req, body);
});

export const config: Config = { path: "/api/preview-server" };
