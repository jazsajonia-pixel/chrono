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
  PREVIEW_DENY_SUBNETS,
  sandboxConfigured,
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

// Always use absolute paths: the default working directory of a named sandbox is
// `/vercel`, so relative paths and `.` would point outside the project folder.
const ROOT = "/vercel/sandbox";
const META = ROOT + "/.chrono-preview";
const PORT_TIMEOUT = 10 * 60 * 1000;
const SNAPSHOT_TTL = 24 * 60 * 60 * 1000;

type SandboxCredentials = { token: string; teamId: string; projectId: string };

/** Explicit access-token credentials, when all three values are configured. */
function sandboxTokenCredentials(): SandboxCredentials | undefined {
  const token = process.env.VERCEL_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  const teamId = process.env.VERCEL_TEAM_ID;
  return token && projectId && teamId ? { token, teamId, projectId } : undefined;
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
    return await Sandbox.get({ name, ...sandboxTokenCredentials() });
  } catch (error) {
    if (isMissingSandbox(error)) return null;
    throw error;
  }
}

async function authorizeRepository(req: Request, owner: string, repo: string) {
  const { gh, session } = await githubForRequest(req);
  try {
    await gh.get("/repos/" + owner + "/" + repo);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      throw new HttpError(404, "NOT_FOUND", "Chrono couldn't confirm access to " + owner + "/" + repo + " on GitHub. If it's private, sign in again with private repository access.");
    }
    throw error;
  }
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
      ...sandboxTokenCredentials(),
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
        subnets: { deny: [...PREVIEW_DENY_SUBNETS] },
      },
      tags: { "managed-by": "chrono" },
    });

    const reset = await sandbox.runCommand("bash", [
      "-lc",
      "mkdir -p " + ROOT + " && cd " + ROOT + " && find . -mindepth 1 -maxdepth 1 ! -name .chrono-preview -exec rm -rf -- {} + && mkdir -p .chrono-preview && rm -f .chrono-preview/*",
    ], { timeoutMs: 15_000 });
    if (reset.exitCode !== 0) {
      throw new Error("Could not prepare the sandbox workspace.");
    }

    await sandbox.writeFiles([
      ...files.map((file) => ({ path: ROOT + "/" + file.path, content: file.content })),
      { path: META + "/start.sh", content: previewStartScript(runner), mode: 0o755 },
      { path: META + "/ref", content: body.ref },
      { path: META + "/state", content: "queued" },
    ]);

    const url = sandbox.domain(PREVIEW_PORT);
    await sandbox.runCommand({
      cmd: "bash",
      args: [META + "/start.sh"],
      cwd: ROOT,
      env: {
        HOST: "0.0.0.0",
        PORT: String(PREVIEW_PORT),
        CI: "1",
        // Vite (5.4.12+) blocks unknown Host headers; allow only this sandbox's public hostname.
        __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: new URL(url).hostname,
      },
      detached: true,
      timeoutMs: PORT_TIMEOUT - 10_000,
    });

    return json({
      status: "starting",
      url,
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
  switch (sandbox.status) {
    case "running":
      break;
    // Booting or restoring a snapshot: keep the client polling instead of reporting "stopped".
    case "pending":
    case "snapshotting":
      return json({ status: "starting", message: "Starting the sandbox…" });
    case "stopping":
      return json({ status: "stopping" });
    case "failed":
    case "aborted":
      return json({ status: "failed", message: "Vercel Sandbox stopped this preview (" + sandbox.status + "). Start it again." });
    default:
      return json({ status: "stopped", message: "The live server stopped. Servers expire after 10 minutes; start it again." });
  }

  const previewUrl = sandbox.domain(PREVIEW_PORT);
  const state = await sandbox.fs.readFile(META + "/state", "utf8").catch(() => "starting");
  if (state.trim() === "failed") {
    const logs = await sandbox.fs.readFile(META + "/error.log", "utf8").catch(() => "");
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
    if (response.status === 403) {
      const text = await response.text().catch(() => "");
      if (/Blocked request\. This host/i.test(text)) {
        return json({
          status: "failed",
          message: "The dev server rejected the preview hostname. Allow it in the dev server's allowed hosts (for Vite: server.allowedHosts).",
          logs: text.slice(0, 2000),
        });
      }
    }
    if (response.status < 500) return json({ status: "running", url: previewUrl });
  } catch {
    // The VM may be running while dependencies install or the framework compiles.
  }

  const logs = await sandbox.fs.readFile(META + "/server.log", "utf8").catch(() => "");
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
