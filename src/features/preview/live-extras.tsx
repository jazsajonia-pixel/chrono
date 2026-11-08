import { useEffect, useState } from "react";
import { Download, KeyRound, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/sheet";
import { api } from "@/lib/api";
import { previewEnvNameProblem, usePreviewEnv } from "./use-preview-env";

/**
 * Live server variables for this repository. Values are write-only: once saved they're encrypted
 * on the server and never shown again; only names are listed.
 */
export function LiveEnvSheet({ owner, repo, open, onOpenChange, suggested = [] }: { owner: string; repo: string; open: boolean; onOpenChange: (open: boolean) => void; suggested?: string[] }) {
  const env = usePreviewEnv(owner, repo, open);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setName("");
      setValue("");
      setError(null);
    }
  }, [open]);

  const saved = env.state.status === "ready" ? env.state.vars : [];
  const missing = suggested.filter((s) => !saved.some((v) => v.name === s));
  const problem = name ? previewEnvNameProblem(name.trim()) : null;

  const submit = async () => {
    const n = name.trim();
    const p = previewEnvNameProblem(n);
    if (p) return setError(p);
    setBusy("save");
    setError(null);
    try {
      await env.save(n, value);
      setName("");
      setValue("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the variable.");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (n: string) => {
    setBusy(n);
    setError(null);
    try {
      await env.remove(n);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove the variable.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="Preview variables" description={`Passed to ${owner}/${repo}'s live server only. Use development credentials, never production ones.`}>
      <div className="space-y-4 pt-1" data-testid="live-env-sheet">
        {env.state.status === "loading" ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading…</p>
        ) : env.state.status === "error" ? (
          <p role="alert" className="text-sm text-danger">{env.state.error}</p>
        ) : !env.state.available ? (
          <p className="text-sm text-muted-foreground">{env.state.reason}</p>
        ) : (
          <>
            {saved.length ? (
              <ul className="divide-y rounded-md border" data-testid="live-env-list">
                {saved.map((v) => (
                  <li key={v.name} className="flex items-center gap-2 px-3 py-2">
                    <KeyRound className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{v.name}</span>
                    <span className="text-[11px] text-muted-foreground">saved {new Date(v.updatedAt).toLocaleDateString()}</span>
                    <Button variant="ghost" size="icon" aria-label={`Remove ${v.name}`} disabled={busy !== null} onClick={() => void remove(v.name)}>
                      {busy === v.name ? <Loader2 className="animate-spin" /> : <Trash2 />}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No variables yet. The live server starts without any.</p>
            )}
            {missing.length ? (
              <div className="flex flex-wrap gap-1.5" aria-label="Suggested names">
                {missing.map((s) => (
                  <button key={s} type="button" onClick={() => setName(s)} className="rounded-full border px-2.5 py-1 font-mono text-[11px] text-muted-foreground hover:text-foreground">
                    + {s}
                  </button>
                ))}
              </div>
            ) : null}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
              className="space-y-2"
            >
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="DATABASE_URL"
                aria-label="Variable name"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={!!problem}
                className="h-11 w-full rounded-md border bg-background px-3 font-mono text-base aria-[invalid=true]:border-danger"
                data-testid="input-env-name"
              />
              <input
                type="password"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Value"
                aria-label="Variable value"
                autoComplete="off"
                className="h-11 w-full rounded-md border bg-background px-3 font-mono text-base"
                data-testid="input-env-value"
              />
              {problem || error ? <p role="alert" className="text-sm text-danger">{problem ?? error}</p> : null}
              <Button type="submit" className="w-full" disabled={busy !== null || !name.trim() || !!problem} data-testid="button-save-env">
                {busy === "save" ? <Loader2 className="animate-spin" /> : null} Save variable
              </Button>
            </form>
            <p className="text-xs text-muted-foreground">
              Values are encrypted on Chrono's server and can't be viewed again. Restart the live server to use changes. Anyone with the preview URL can use the running app, so keep these to test data.
            </p>
          </>
        )}
      </div>
    </BottomSheet>
  );
}

interface ReleaseApk { name: string; size: number; url: string; kind: "apk" | "aab" }
interface Release { tag: string; name: string; url: string; prerelease: boolean; publishedAt: string | null; apks: ReleaseApk[] }

/** Android apps can't run on a web server; offer the repository's own release builds instead. */
export function AndroidReleases({ owner, repo }: { owner: string; repo: string }) {
  const [state, setState] = useState<{ status: "loading" } | { status: "ready"; releases: Release[] } | { status: "error"; error: string }>({ status: "loading" });
  useEffect(() => {
    let alive = true;
    api<{ releases: Release[] }>(`/github/repos/${owner}/${repo}/releases`)
      .then((r) => alive && setState({ status: "ready", releases: r.releases }))
      .catch((e: unknown) => alive && setState({ status: "error", error: e instanceof Error ? e.message : "Couldn't load releases." }));
    return () => {
      alive = false;
    };
  }, [owner, repo]);

  return (
    <div className="mt-4 rounded-md border p-3 text-left" data-testid="android-releases">
      <h3 className="text-sm font-semibold">Install a build on your phone</h3>
      {state.status === "loading" ? (
        <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Checking releases…</p>
      ) : state.status === "error" ? (
        <p className="mt-2 text-xs text-danger">{state.error}</p>
      ) : state.releases.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">No release on GitHub has an .apk yet. Publish one (for example from a GitHub Actions build) and it shows up here.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {state.releases.map((r) => (
            <li key={r.tag} className="text-xs">
              <a href={r.url} target="_blank" rel="noopener noreferrer" className="font-medium underline-offset-2 hover:underline">{r.name}</a>
              <span className="text-muted-foreground">{r.prerelease ? " · pre-release" : ""}{r.publishedAt ? " · " + new Date(r.publishedAt).toLocaleDateString() : ""}</span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {r.apks.map((a) => (
                  <Button key={a.url} asChild size="sm" variant="secondary">
                    <a href={a.url} target="_blank" rel="noopener noreferrer"><Download /> {a.name} · {(a.size / 1_048_576).toFixed(1)} MB</a>
                  </Button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
