import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspace } from "@/features/workspace/context";
import { api } from "@/lib/api";
import { AppError } from "@/lib/errors";

export type LiveServerMode = "browser" | "server";
export type LiveServerStatus = "idle" | "starting" | "running" | "stopping" | "stopped" | "failed";

interface LiveServerResponse {
  status: LiveServerStatus;
  url?: string;
  message?: string;
  logs?: string;
  files?: number;
  bytes?: number;
}

interface LiveServerState extends LiveServerResponse {
  mode: LiveServerMode;
  error?: string;
}

const MAX_FILES = 350;
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
  "sketch", "sqlite", "db",
]);

const SKIPPABLE_FILE_ERRORS = new Set<string>(["NOT_FOUND", "BINARY_FILE", "FILE_TOO_LARGE"]);

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

export function useLiveServer(owner: string, repo: string) {
  const workspace = useWorkspace();
  const [state, setState] = useState<LiveServerState>({ mode: "browser", status: "idle" });
  const [frameKey, setFrameKey] = useState(0);
  const busy = useRef(false);
  const identity = { owner, repo, ref: workspace.source.commitSha };

  const query = useCallback(
    () => new URLSearchParams(identity).toString(),
    [owner, repo, workspace.source.commitSha],
  );

  const refresh = useCallback(async () => {
    const result = await api<LiveServerResponse>("/preview-server?" + query(), { timeoutMs: 8_000 });
    setState((current) => ({ ...current, ...result, mode: current.mode, error: undefined }));
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
      let bytes = 0;

      for (const path of workspace.paths) {
        if (!includeInPreview(path)) continue;
        if (files.length >= MAX_FILES) {
          throw new Error("Live preview supports up to " + MAX_FILES + " text files. Exclude generated or unused files and retry.");
        }
        let content: string;
        try {
          content = await workspace.getBuffer(path);
        } catch (error) {
          // Files GitHub can't serve as text (missing at this commit, binary, over 1 MB) are left out
          // instead of aborting the whole preview; anything else names the file that failed.
          if (error instanceof AppError && SKIPPABLE_FILE_ERRORS.has(error.code)) {
            skipped.push(path);
            continue;
          }
          throw new Error("Couldn't load " + path + ": " + (error instanceof Error ? error.message : "unknown error"));
        }
        const size = new TextEncoder().encode(content).byteLength;
        if (size > 500_000) throw new Error(path + " is too large to include in a live preview.");
        bytes += size;
        if (bytes > MAX_BYTES) {
          throw new Error("This workspace exceeds the 1.8 MB live preview limit. Exclude large files and retry.");
        }
        files.push({ path, content });
      }

      if (skipped.length) console.warn("Live preview skipped files GitHub couldn't serve as text:", skipped);

      const result = await api<LiveServerResponse>("/preview-server", {
        method: "POST",
        body: { action: "start", ...identity, files },
        timeoutMs: 90_000,
      });
      setState((current) => ({ ...current, ...result, mode: "server", error: undefined }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not start the live preview.";
      const requestId = error instanceof AppError && error.requestId ? " (request " + error.requestId + ")" : "";
      setState((current) => ({
        ...current,
        mode: "server",
        status: "failed",
        error: message + requestId,
      }));
    } finally {
      busy.current = false;
    }
  }, [workspace, owner, repo, workspace.source.commitSha]);

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
      setState((current) => ({ ...current, ...result, mode: "server", error: undefined }));
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

  const setMode = useCallback((mode: LiveServerMode) => {
    setState((current) => ({ ...current, mode }));
    if (mode === "server") void refresh().catch(() => undefined);
  }, [refresh]);

  const reload = useCallback(() => setFrameKey((key) => key + 1), []);

  useEffect(() => {
    if (state.mode !== "server" || (state.status !== "starting" && state.status !== "running")) return;
    const interval = state.status === "starting" ? 2500 : 10_000;
    const timer = window.setInterval(() => void refresh().catch(() => undefined), interval);
    return () => window.clearInterval(timer);
  }, [state.mode, state.status, refresh]);

  useEffect(() => {
    setState({ mode: "browser", status: "idle" });
  }, [workspace.source.storageKey, workspace.source.commitSha]);

  return { state, setMode, start, stop, refresh, reload, frameKey };
}
