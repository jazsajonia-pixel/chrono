import { errorResponse } from "../../netlify/lib/http.js";
import aiAgent from "../../netlify/functions/ai-agent.js";
import aiGeminiModel from "../../netlify/functions/ai-gemini-model.js";
import aiProvider from "../../netlify/functions/ai-provider.js";
import aiProviders from "../../netlify/functions/ai-providers.js";
import aiTestProvider from "../../netlify/functions/ai-test-provider.js";
import authGithubCallback from "../../netlify/functions/auth-github-callback.js";
import authGithubStart from "../../netlify/functions/auth-github-start.js";
import authMobileExchange from "../../netlify/functions/auth-mobile-exchange.js";
import authLogout from "../../netlify/functions/auth-logout.js";
import authSession from "../../netlify/functions/auth-session.js";
import clientErrors from "../../netlify/functions/client-errors.js";
import githubBranch from "../../netlify/functions/github-branch.js";
import githubBranches from "../../netlify/functions/github-branches.js";
import githubCommit from "../../netlify/functions/github-commit.js";
import githubCommits from "../../netlify/functions/github-commits.js";
import githubFile from "../../netlify/functions/github-file.js";
import githubPulls from "../../netlify/functions/github-pulls.js";
import githubRepo from "../../netlify/functions/github-repo.js";
import githubRepos from "../../netlify/functions/github-repos.js";
import githubTree from "../../netlify/functions/github-tree.js";
import health from "../../netlify/functions/health.js";
import skills from "../../netlify/functions/skills.js";
import previewServer from "../../netlify/functions/preview-server.js";

type VercelRequest = {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  socket?: { remoteAddress?: string };
  on?: (event: "data" | "end" | "error", listener: (...args: unknown[]) => void) => void;
};

type VercelResponse = {
  statusCode: number;
  writableEnded?: boolean;
  on?: (event: "close", listener: () => void) => void;
  setHeader(name: string, value: string | string[]): void;
  end(body?: string | Uint8Array): void;
};

type Handler = (req: Request, ctx?: { params?: Record<string, string>; ip?: string }) => Promise<Response>;

type Route = { handler: Handler; params?: Record<string, string> };

function headerEntries(headers: VercelRequest["headers"]): Headers {
  const result = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    result.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  return result;
}

async function readIncomingBody(req: VercelRequest): Promise<string | undefined> {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === "string") return req.body;
    if (req.body instanceof Uint8Array) return new TextDecoder().decode(req.body);
    return JSON.stringify(req.body);
  }
  if (!req.on) return undefined;
  const chunks: Uint8Array[] = [];
  return await new Promise<string | undefined>((resolve, reject) => {
    req.on?.("data", (chunk: unknown) => {
      if (typeof chunk === "string") chunks.push(new TextEncoder().encode(chunk));
      else if (chunk instanceof Uint8Array) chunks.push(chunk);
    });
    req.on?.("end", () => {
      if (!chunks.length) return resolve(undefined);
      const total = chunks.reduce((size, chunk) => size + chunk.byteLength, 0);
      const body = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
      }
      resolve(new TextDecoder().decode(body));
    });
    req.on?.("error", (error: unknown) => reject(error));
  });
}

function pathParts(pathname: string): string[] {
  return pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
}

function routeFor(pathname: string): Route | null {
  const parts = pathParts(pathname);
  const key = parts.join("/");
  if (key === "health") return { handler: health };
  if (key === "client-errors") return { handler: clientErrors };
  if (key === "skills") return { handler: skills };
  if (key === "preview-server") return { handler: previewServer };
  if (key === "auth/github/start") return { handler: authGithubStart };
  if (key === "auth/github/callback") return { handler: authGithubCallback };
  if (key === "auth/logout") return { handler: authLogout };
  if (key === "auth/mobile/exchange") return { handler: authMobileExchange };
  if (key === "auth/session") return { handler: authSession };
  if (key === "ai/agent") return { handler: aiAgent };
  if (key === "ai/platform/gemini") return { handler: aiGeminiModel };
  if (key === "ai/providers") return { handler: aiProviders };
  if (key === "ai/test-provider") return { handler: aiTestProvider };
  if (parts.length === 3 && parts[0] === "ai" && parts[1] === "providers") {
    return { handler: aiProvider, params: { id: parts[2]! } };
  }
  if (key === "github/repos") return { handler: githubRepos };
  if (parts.length === 4 && parts[0] === "github" && parts[1] === "repos") {
    const params = { owner: parts[2]!, repo: parts[3]! };
    return { handler: githubRepo, params };
  }
  if (parts.length === 5 && parts[0] === "github" && parts[1] === "repos") {
    const params = { owner: parts[2]!, repo: parts[3]! };
    const handlers: Record<string, Handler> = {
      branch: githubBranch,
      branches: githubBranches,
      commit: githubCommit,
      commits: githubCommits,
      file: githubFile,
      pulls: githubPulls,
      tree: githubTree,
    };
    const handler = handlers[parts[4]!];
    if (handler) return { handler, params };
  }
  return null;
}

export async function handleVercelRequest(req: VercelRequest, res: VercelResponse): Promise<void> {
  const protocol = Array.isArray(req.headers["x-forwarded-proto"]) ? req.headers["x-forwarded-proto"][0] : req.headers["x-forwarded-proto"] ?? "https";
  const host = Array.isArray(req.headers.host) ? req.headers.host[0] : req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "/", `${protocol}://${host}`);
  // Vercel's Vite routing can collapse nested `/api/*` paths into the explicit
  // `/api/index` function. The rewrite records the original path in this query
  // parameter so the shared adapter still sees the public API URL.
  const rewrittenPath = url.pathname === "/api/index" ? url.searchParams.get("__chrono_path") : null;
  const routePath = rewrittenPath ? `/api/${rewrittenPath.replace(/^\/+/, "")}` : url.pathname;
  const route = routeFor(routePath);
  if (!route) {
    const missing = errorResponse(404, "VALIDATION_FAILED", "API route not found.");
    res.statusCode = missing.status;
    res.setHeader("Content-Type", missing.headers.get("content-type") ?? "application/json");
    res.end(await missing.text());
    return;
  }

  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readIncomingBody(req);
  // Propagate client disconnects (Stop, navigation, project exit) so the Gemini failover loop
  // stops instead of spending more keys on a response nobody will read.
  const abort = new AbortController();
  res.on?.("close", () => {
    if (!res.writableEnded) abort.abort();
  });
  const request = new Request(url, {
    method: req.method ?? "GET",
    headers: headerEntries(req.headers),
    body,
    signal: abort.signal,
  });
  const response = await route.handler(request, { params: route.params, ip: req.socket?.remoteAddress });
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  const cookies = response.headers.getSetCookie?.();
  if (cookies?.length) res.setHeader("Set-Cookie", cookies);
  if (response.status === 204 || response.status === 304) {
    res.end();
    return;
  }
  res.end(new Uint8Array(await response.arrayBuffer()));
}
