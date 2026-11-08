import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspace } from "@/features/workspace/context";
import { api } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { liveOmitFolders, type LiveRuntime } from "@/lib/live-runtime";

export type LiveServerStatus = "idle" | "starting" | "running" | "stopping" | "stopped" | "failed";

interface LiveServerResponse {
  status: LiveServerStatus;
  url?: string;
  message?: string;
  logs?: string;
  files?: number;
  bytes?: number;
  assets?: number;
  assetBytes?: number;
  skippedAssets?: string[];
  runtime?: string;
  label?: string;
  /** Sandbox lifetime in minutes. */
  minutes?: number;
  /** Names of saved preview variables passed to this start (never values). */
  env?: string[];
  unreadableEnv?: string[];
}

interface LiveServerState extends LiveServerResponse {
  error?: string;
}

const MAX_FILES = 350;
const MAX_CONCURRENT_FILE_READS = 8;
const MAX_BYTES = 1_800_000;
const OMIT_SEGMENTS = new Set([
  ".git", ".vercel", ".next", ".nuxt", ".cache", ".turbo",
  "node_modules", "coverage", "dist", "build", ".ssh", ".aws", ".azure",
]);
const OMIT_FILES = new Set([
  ".npmrc", ".yarnrc", ".pypirc", ".netrc", "credentials", "id_rsa", "id_ed25519",
]);
const OMIT_SECRET_EXTENSIONS = new Set(["pem", "key", "p12", "pfx", "jks", "keystore"]);
const OMIT_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "ico", "pdf", "zip", "gz", "mp4",
  "mov", "webm", "woff", "woff2", "ttf", "otf", "eot", "wasm", "psd",
  "sketch", "sqlite", "db", "avif", "bmp", "tif", "tiff", "heic", "jfif",
  "mp3", "wav", "ogg", "m4a", "flac", "glb", "bin", "jar",
]);

const SKIPPABLE_FILE_ERRORS = new Set<string>(["NOT_FOUND", "BINARY_FILE", "FILE_TOO_LARGE"]);

function describeFailure(error: unknown, fallback: string): string {
  const message = error instanceof Error && error.message ? error.message : fallback;
  return error instanceof AppError && error.requestId ? message + " (request " + error.requestId + ")" : message;
}

/** Binary assets are fetched server-side from GitHub; secrets and generated folders never are. */
function isBinaryAsset(path: string): boolean {
  const parts = path.split("/");
  if (parts.some((part) => OMIT_SEGMENTS.has(part.toLowerCase()) || OMIT_FILES.has(part.toLowerCase()) || /^\.env(?:$|\.)/i.test(part))) return false;
  const filename = parts[parts.length - 1] ?? "";
  const extension = filename.includes(".") ? filename.split(".").pop()?.toLowerCase() ?? "" : "";
  return OMIT_EXTENSIONS.has(extension) && !OMIT_SECRET_EXTENSIONS.has(extension);
}

function includeInPreview(path: string): boolean {
  const parts = path.split("/");
  if (parts.some((part) =>
    OMIT_SEGMENTS.has(part.toLowerCase()) ||
    OMIT_FILES.has(part.toLowerCase()) ||
    /^\.env(?:$|\.)/i.test(part)
  )) return false;
  const filename = parts[parts.length - 1] ?? "";
  const extension = filename.includes(".") ? filename.split(".").pop()?.toLowerCase() ?? "" : "";
  return !OMIT_EXTENSIONS.has(extension) && !OMIT_SECRET_EXTENSIONS.has(extension);
}

export function useLiveServer(owner: string, repo: string, runtime?: LiveRuntime) {
  const workspace = useWorkspace();
  const [state, setState] = useState<LiveServerState>({ status: "idle" });
  const stateRef = useRef(state);
  stateRef.current = state;
  const [frameKey, setFrameKey] = useState(0);
  const busy = useRef(false);
  const identity = { owner, repo, ref: workspace.source.commitSha };

  const query = useCallback(
    () => new URLSearchParams(identity).toString(),
    [owner, repo, workspace.source.commitSha],
  );

  const refresh = useCallback(async () => {
    const result = await api<LiveServerResponse>("/preview-server?" + query(), { timeoutMs: 8_000 });
    setState((current) => ({ ...current, ...result, error: undefined }));
    return result;
  }, [query]);

  const start = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setState((current) => ({
      ...current,
      status: "starting",
      error: undefined,
      message: "Collecting the current workspace…",
    }));
    try {
      const files: { path: string; content: string }[] = [];
      const skipped: string[] = [];
      // Binary or oversized files: the server copies them from GitHub at this commit.
      const assets: string[] = [];
      const textPaths: string[] = [];
      // Platform folders a runtime doesn't build (android/ and ios/ for a Flutter web build…).
      const skipFolders = new Set(runtime ? liveOmitFolders(runtime) : []);
      for (const path of workspace.paths) {
        if (skipFolders.has(path.split("/")[0]!)) continue;
        if (isBinaryAsset(path)) assets.push(path);
        else if (includeInPreview(path)) textPaths.push(path);
      }
      if (textPaths.length > MAX_FILES) {
        throw new Error("Live preview supports up to " + MAX_FILES + " text files. Exclude generated or unused files and retry.");
      }
      const contents: ({ path: string; content: string } | null)[] = Array(textPaths.length).fill(null);
      let bytes = 0;
      let cursor = 0;
      const readNext = async () => {
        while (cursor < textPaths.length) {
          const index = cursor++;
          const path = textPaths[index]!;
          let content: string;
          try {
            content = await workspace.getBuffer(path);
          } catch (error) {
            // Files GitHub can't serve as text (missing at this commit, binary, over 1 MB) are left out
            // instead of aborting the whole preview; anything else names the file that failed.
            if (error instanceof AppError && (error.code === "BINARY_FILE" || error.code === "FILE_TOO_LARGE")) {
              assets.push(path);
              continue;
            }
            if (error instanceof AppError && SKIPPABLE_FILE_ERRORS.has(error.code)) {
              skipped.push(path);
              continue;
            }
            throw new Error("Couldn't load " + path + ": " + (error instanceof Error ? error.message : "unknown error"));
          }
          const size = new TextEncoder().encode(content).byteLength;
          if (size > 500_000) throw new Error(path + " is too large to include in a live preview.");
          if (bytes + size > MAX_BYTES) {
            throw new Error("This workspace exceeds the 1.8 MB live preview limit. Exclude large files and retry.");
          }
          bytes += size;
          contents[index] = { path, content };
        }
      };
      await Promise.all(Array.from(
        { length: Math.min(MAX_CONCURRENT_FILE_READS, textPaths.length) },
        () => readNext(),
      ));
      for (const file of contents) if (file) files.push(file);
      if (files.length === 0) {
        throw new Error(skipped.length
          ? "Chrono couldn't load any project files from GitHub (" + skipped.length + " skipped). Reload and try again."
          : "This workspace has no text files to run.");
      }
      if (skipped.length) console.warn("Live preview skipped files GitHub couldn't serve as text:", skipped);
      const result = await api<LiveServerResponse>("/preview-server", {
        method: "POST",
        body: { action: "start", ...identity, files, assets },
        timeoutMs: 90_000,
      });
      setState((current) => ({ ...current, ...result, error: undefined }));
    } catch (error) {
      setState((current) => ({
        ...current,
        status: "failed",
        error: describeFailure(error, "Could not start the live preview."),
      }));
    } finally {
      busy.current = false;
    }
  }, [workspace, owner, repo, workspace.source.commitSha, runtime]);

  const stop = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setState((current) => ({ ...current, status: "stopping", error: undefined }));
    try {
      const result = await api<LiveServerResponse>("/preview-server", {
        method: "POST",
        body: { action: "stop", ...identity },
        timeoutMs: 30_000,
      });
      setState((current) => ({ ...current, ...result, error: undefined }));
    } catch (error) {
      setState((current) => ({
        ...current,
        status: "failed",
        error: error instanceof Error ? error.message : "Could not stop the live preview.",
      }));
    } finally {
      busy.current = false;
    }
  }, [owner, repo, workspace.source.commitSha]);

  const reload = useCallback(() => setFrameKey((key) => key + 1), []);

  useEffect(() => {
    if (state.status !== "starting" && state.status !== "running") return;
    const interval = state.status === "starting" ? 2500 : 10_000;
    const timer = window.setInterval(() => void refresh().catch(() => undefined), interval);
    return () => window.clearInterval(timer);
  }, [state.status, refresh]);

  useEffect(() => {
    setState({ status: "idle" });
  }, [workspace.source.storageKey, workspace.source.commitSha]);

  // Preview remains mounted across tabs in this workspace; leaving the workspace releases its sandbox.
  useEffect(() => () => {
    const previous = stateRef.current;
    if (previous.status === "running" || previous.status === "starting" || previous.status === "stopping") {
      void api<LiveServerResponse>("/preview-server", {
        method: "POST",
        body: { action: "stop", ...identity },
        timeoutMs: 30_000,
      }).catch(() => undefined);
    }
  }, [owner, repo, workspace.source.storageKey, workspace.source.commitSha]);
  return { state, start, stop, refresh, reload, frameKey };
}
