import type { Config } from "@netlify/functions";
import { z } from "zod";
import { handle, HttpError, json } from "../lib/http.js";
import { githubForRequest } from "../lib/gh-request.js";
import { requireSession } from "../lib/session.js";
import { assertSameOrigin, rateLimit } from "../lib/security.js";
import { ownerSchema, parse, readJson, repoSchema } from "../lib/validate.js";
import {
  deletePreviewEnv,
  listPreviewEnv,
  PREVIEW_ENV_LIMITS,
  previewEnvAvailability,
  setPreviewEnv,
} from "../lib/preview-env.js";

const nameSchema = z.string().min(1).max(PREVIEW_ENV_LIMITS.maxNameLength);
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set"), owner: ownerSchema, repo: repoSchema, name: nameSchema, value: z.string().max(PREVIEW_ENV_LIMITS.maxValueBytes * 4) }).strict(),
  z.object({ action: z.literal("delete"), owner: ownerSchema, repo: repoSchema, name: nameSchema }).strict(),
]);

/**
 * GET  /api/preview-env?owner&repo — names (never values) of this user's Live server variables.
 * POST /api/preview-env {action:"set"|"delete"} — save (encrypted) or remove one variable.
 */
export default handle(["GET", "POST"], async (req) => {
  const session = await requireSession(req);
  const status = previewEnvAvailability();

  if (req.method === "GET") {
    const url = new URL(req.url);
    const owner = parse(ownerSchema, url.searchParams.get("owner"), "owner");
    const repo = parse(repoSchema, url.searchParams.get("repo"), "repo");
    if (!status.available) return json({ available: false, reason: status.reason, vars: [], limits: PREVIEW_ENV_LIMITS });
    return json({ available: true, vars: await listPreviewEnv(session, owner, repo), limits: PREVIEW_ENV_LIMITS });
  }

  assertSameOrigin(req);
  await rateLimit("preview-env:" + session.user.id, 30, 60_000);
  const body = await readJson(req, bodySchema, 100_000);
  if (!status.available) throw new HttpError(503, "BACKEND_UNAVAILABLE", status.reason);
  // Only save variables for repositories this account can open.
  const { gh } = await githubForRequest(req);
  try {
    await gh.get("/repos/" + body.owner + "/" + body.repo);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) throw new HttpError(404, "NOT_FOUND", "Chrono couldn't confirm access to " + body.owner + "/" + body.repo + " on GitHub.");
    throw error;
  }
  if (body.action === "set") await setPreviewEnv(session, body.owner, body.repo, body.name, body.value);
  else await deletePreviewEnv(session, body.owner, body.repo, body.name);
  return json({ available: true, vars: await listPreviewEnv(session, body.owner, body.repo), limits: PREVIEW_ENV_LIMITS });
});

export const config: Config = { path: "/api/preview-env" };
