import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

export interface PreviewEnvVar {
  name: string;
  updatedAt: string;
}

interface PreviewEnvResponse {
  available: boolean;
  reason?: string;
  vars: PreviewEnvVar[];
}

export type PreviewEnvState =
  | { status: "loading" }
  | { status: "ready"; available: boolean; reason?: string; vars: PreviewEnvVar[] }
  | { status: "error"; error: string };

/**
 * Live server variables for one repository (GET/POST /api/preview-env). Values are write-only:
 * the server returns names and timestamps, never the values.
 */
export function usePreviewEnv(owner: string, repo: string, enabled = true) {
  const [state, setState] = useState<PreviewEnvState>({ status: "loading" });

  const load = useCallback(async () => {
    try {
      const res = await api<PreviewEnvResponse>("/preview-env?" + new URLSearchParams({ owner, repo }).toString(), { timeoutMs: 10_000 });
      setState({ status: "ready", available: res.available, reason: res.reason, vars: res.vars });
    } catch (error) {
      setState({ status: "error", error: error instanceof Error ? error.message : "Couldn't load preview variables." });
    }
  }, [owner, repo]);

  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);

  const send = useCallback(async (body: { action: "set"; name: string; value: string } | { action: "delete"; name: string }) => {
    const res = await api<PreviewEnvResponse>("/preview-env", { method: "POST", body: { ...body, owner, repo }, timeoutMs: 15_000 });
    setState({ status: "ready", available: res.available, reason: res.reason, vars: res.vars });
  }, [owner, repo]);

  const save = useCallback((name: string, value: string) => send({ action: "set", name, value }), [send]);
  const remove = useCallback((name: string) => send({ action: "delete", name }), [send]);
  return { state, reload: load, save, remove };
}

/** Same rule as the server (netlify/lib/preview-env.ts), for instant feedback while typing. */
export function previewEnvNameProblem(name: string): string | null {
  if (!name) return "Enter a variable name.";
  if (name.length > 64) return "Variable names can be up to 64 characters.";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return "Use letters, digits and underscores, and don't start with a digit.";
  const upper = name.toUpperCase();
  const reserved = ["PATH", "HOME", "USER", "SHELL", "PWD", "HOST", "PORT", "CI", "LD_PRELOAD", "LD_LIBRARY_PATH", "JAVA_HOME", "PUB_CACHE", "GRADLE_USER_HOME", "GRADLE_OPTS", "MAVEN_OPTS", "FLUTTER_ROOT", "SDK"];
  if (reserved.includes(upper) || ["VERCEL_", "__VITE_", "CHRONO_"].some((p) => upper.startsWith(p))) return name + " is set by the preview sandbox and can't be changed.";
  return null;
}
