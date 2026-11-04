import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { AlertTriangle, Code2, ExternalLink, Info, Loader2, Maximize2, Minimize2, Monitor, RotateCw, ServerOff, Smartphone, Sparkles, Terminal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/sheet";
import { useWorkspace } from "@/features/workspace/context";
import { projectPath } from "@/lib/nav";
import { safeStorage } from "@/lib/storage";
import { cn } from "@/lib/utils";
import { usePreview, type ConsoleEntry, type RuntimeError } from "./use-preview";
import { useLiveServer } from "./use-live-server";

/**
 * Sandbox flags: scripts run, but WITHOUT allow-same-origin the frame gets an opaque origin — it can't
 * read this app's cookies, storage or call our API with the user's session. No top navigation.
 */
import { PREVIEW_SANDBOX } from "./runtime";
export { PREVIEW_SANDBOX };

type Device = "fit" | "phone" | "desktop";

const LEVEL_CLS: Record<ConsoleEntry["level"], string> = {
  log: "",
  debug: "text-muted-foreground",
  info: "text-primary",
  warn: "text-warning",
  error: "text-danger",
};

/** Hand a prompt to the AI tab (read once by the agent composer). */
export function prefillAgent(storageKey: string, text: string, mode: "ask" | "agent") {
  safeStorage.set(`agent-prefill:${storageKey}`, JSON.stringify({ text, mode }), "session");
}

function openInNewTab(html: string, title: string) {
  // The new tab is a script-free wrapper; the app still runs in a sandboxed, opaque-origin frame.
  const esc = html.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const wrapper = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title.replace(/</g, "&lt;")}</title><style>html,body{margin:0;height:100%;background:#fff}iframe{border:0;width:100%;height:100%;display:block}</style></head><body><iframe sandbox="${PREVIEW_SANDBOX}" referrerpolicy="no-referrer" srcdoc="${esc}"></iframe></body></html>`;
  const url = URL.createObjectURL(new Blob([wrapper], { type: "text/html" }));
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function useWidth(ref: React.RefObject<HTMLElement | null>) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setW(e?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

function ErrorCard({ title, message, file, line, frame, onOpen, onAskAi }: { title: string; message: string; file: string | null; line: number | null; frame: string | null; onOpen?: () => void; onAskAi: () => void }) {
  return (
    <div className="space-y-3 rounded-lg border border-danger/40 bg-surface p-4" role="alert" data-testid="preview-error">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-1 whitespace-pre-wrap break-words font-mono text-xs">{message}</p>
          {file ? (
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              {file}
              {line ? `:${line}` : ""}
            </p>
          ) : null}
        </div>
      </div>
      {frame ? <pre className="overflow-x-auto rounded bg-background p-2 font-mono text-[11px] leading-relaxed">{frame}</pre> : null}
      <div className="grid grid-cols-2 gap-2">
        {file && onOpen ? (
          <Button variant="secondary" size="sm" onClick={onOpen} data-testid="button-open-error-file">
            <Code2 /> Open file
          </Button>
        ) : (
          <span />
        )}
        <Button size="sm" onClick={onAskAi} data-testid="button-fix-with-ai">
          <Sparkles /> Fix with AI
        </Button>
      </div>
    </div>
  );
}

export function PreviewPanel({ owner, repo, assetUrl }: { owner: string; repo: string; assetUrl?: (path: string) => string | null }) {
  const ws = useWorkspace();
  const [, navigate] = useLocation();
  const p = usePreview({ assetUrl });
  const live = useLiveServer(owner, repo);
  const [device, setDevice] = useState<Device>("fit");
  const [full, setFull] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const stageWidth = useWidth(stage);

  const state = p.state;
  const result = state.status === "ready" ? state.result : state.status === "building" ? state.previous : null;
  const plan = state.status === "ready" || state.status === "building" ? state.plan : state.status === "error" ? state.plan : null;
  const errorCount = p.logs.filter((l) => l.level === "error").length;
  const notes = [...(plan?.notes ?? []), ...(result?.warnings ?? [])].filter((n, i, a) => a.indexOf(n) === i);

  // Esc leaves full screen.
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  const openFile = (file: string) => {
    if (!ws.exists(file)) return;
    ws.openFile(file);
    navigate(projectPath(owner, repo, "files"));
  };
  const askAi = (e: { message: string; file: string | null; line: number | null; frame?: string | null }, build: boolean) => {
    const where = e.file ? ` in @${e.file}${e.line ? ` (line ${e.line})` : ""}` : "";
    prefillAgent(ws.source.storageKey, `The preview ${build ? "fails to build" : "throws an error"}${where}:\n\n${e.message}\n\nFind the cause and fix it.`, "agent");
    navigate(projectPath(owner, repo, "ai"));
  };

  if (state.status === "unsupported" && live.state.mode !== "server") {
    return (
      <div className="p-4" data-testid="preview-unsupported">
        <div className="rounded-lg border bg-surface p-5">
          <ServerOff className="size-6 text-muted-foreground" aria-hidden />
          <h2 className="mt-3 text-base font-semibold">{state.plan.label} can't be previewed in the browser</h2>
          <p className="mt-2 text-sm text-muted-foreground">{state.plan.reason}</p>
          <p className="mt-2 text-sm text-muted-foreground">{state.plan.hint}</p>
          <p className="mt-4 text-xs text-muted-foreground">Supported today: HTML/CSS/JS, Vite (React, Preact, TypeScript), Create React App.</p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button asChild variant="secondary">
              <Link href={projectPath(owner, repo, "files")}>
                <Code2 /> Back to code
              </Link>
            </Button>
            <Button variant="secondary" onClick={p.rebuild}>
              <RotateCw /> Check again
            </Button>
            <Button variant="secondary" onClick={() => live.setMode("server")} data-testid="button-try-live-server">
              <ServerOff /> Try Live Server Preview
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const desktopScale = device === "desktop" && stageWidth ? Math.min(1, stageWidth / 1280) : 1;
  const runtimeError: RuntimeError | undefined = p.errors[0];

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col bg-background", full && "fixed inset-0 z-50 pt-safe pb-safe")} data-testid="preview-panel">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b px-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 px-1" role="status" data-testid="preview-status">
          {live.state.mode === "server" ? (
            live.state.status === "starting" || live.state.status === "stopping" ? (
              <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
            ) : live.state.status === "failed" ? (
              <AlertTriangle className="size-4 shrink-0 text-danger" aria-hidden />
            ) : (
              <span className={cn("size-2 shrink-0 rounded-full", live.state.status === "running" ? "bg-primary" : "bg-muted-foreground")} aria-hidden />
            )
          ) : state.status === "analyzing" || state.status === "building" ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
          ) : state.status === "error" || runtimeError ? (
            <AlertTriangle className="size-4 shrink-0 text-danger" aria-hidden />
          ) : (
            <span className={cn("size-2 shrink-0 rounded-full", p.booted ? "bg-primary" : "bg-warning")} aria-hidden />
          )}
          <span className="truncate text-xs">
            {live.state.mode === "server"
              ? live.state.status === "running" ? "Live server ready"
                : live.state.status === "starting" ? (live.state.message ?? "Starting live server…")
                : live.state.status === "stopping" ? "Stopping live server…"
                : live.state.status === "failed" ? "Live server failed"
                : live.state.status === "idle" ? "Live server not started" : "Live server stopped"
              : state.status === "analyzing" ? "Detecting project…"
                : state.status === "building" ? "Building…"
                : state.status === "error" ? "Build failed"
                : runtimeError ? "Runtime error" : p.booted ? (plan?.label ?? "Ready") : "Starting…"}
          </span>
          {live.state.mode === "browser" && plan && plan.pages.length > 1 ? (
            <select
              value={p.page ?? plan.html}
              onChange={(e) => p.goToPage(e.target.value)}
              aria-label="Page"
              className="ml-1 h-8 max-w-[40%] truncate rounded border bg-background px-1 font-mono text-[11px]"
              data-testid="select-preview-page"
            >
              {plan.pages.map((pg) => (
                <option key={pg} value={pg}>
                  {pg.slice(plan.root.length)}
                </option>
              ))}
            </select>
          ) : null}
        </div>
        <div role="group" aria-label="Preview mode" className="inline-flex shrink-0 rounded-md border p-0.5">
          <button type="button" aria-pressed={live.state.mode === "browser"} onClick={() => live.setMode("browser")} className={cn("rounded px-2 py-1 text-[11px]", live.state.mode === "browser" ? "bg-surface-2 text-foreground" : "text-muted-foreground")} data-testid="preview-mode-browser">Browser</button>
          <button type="button" aria-pressed={live.state.mode === "server"} onClick={() => live.setMode("server")} className={cn("rounded px-2 py-1 text-[11px]", live.state.mode === "server" ? "bg-surface-2 text-foreground" : "text-muted-foreground")} data-testid="preview-mode-server">Live server</button>
        </div>
        {live.state.mode === "server" ? (
          <>
            {live.state.status === "running" ? (
              <Button size="sm" variant="outline" onClick={live.stop} data-testid="button-stop-live-server">Stop</Button>
            ) : (
              <Button size="sm" onClick={live.start} disabled={live.state.status === "starting" || live.state.status === "stopping"} data-testid="button-start-live-server">
                {live.state.status === "failed" ? "Retry" : "Start"}
              </Button>
            )}
            {live.state.url ? (
              <Button variant="ghost" size="icon" aria-label="Open live preview in new tab" onClick={() => window.open(live.state.url, "_blank", "noopener,noreferrer")} data-testid="button-open-live-preview">
                <ExternalLink />
              </Button>
            ) : null}
          </>
        ) : null}
        {live.state.mode === "browser" ? (
          <>
        <div role="radiogroup" aria-label="Viewport" className="hidden rounded-md border p-0.5 sm:flex">
          {(
            [
              ["fit", "Fit", Maximize2],
              ["phone", "Phone", Smartphone],
              ["desktop", "Desktop", Monitor],
            ] as const
          ).map(([d, label, Icon]) => (
            <button key={d} type="button" role="radio" aria-checked={device === d} aria-label={label} onClick={() => setDevice(d)} data-testid={`device-${d}`} className="grid size-8 place-items-center rounded text-muted-foreground aria-checked:bg-surface-2 aria-checked:text-foreground">
              <Icon className="size-4" />
            </button>
          ))}
        </div>
        <Button variant="ghost" size="icon" className="sm:hidden" aria-label={device === "desktop" ? "Phone width" : "Desktop width"} aria-pressed={device === "desktop"} onClick={() => setDevice(device === "desktop" ? "fit" : "desktop")} data-testid="button-device">
          {device === "desktop" ? <Smartphone /> : <Monitor />}
        </Button>
          </>
        ) : null}
        <Button variant="ghost" size="icon" aria-label={live.state.mode === "server" ? "Reload live preview" : "Rebuild and reload"} onClick={live.state.mode === "server" ? live.reload : p.rebuild} disabled={live.state.mode === "server" && live.state.status !== "running"} data-testid="button-reload-preview">
          <RotateCw />
        </Button>
        {live.state.mode === "browser" ? <Button variant="ghost" size="icon" aria-label="Console" onClick={() => setConsoleOpen(true)} className="relative" data-testid="button-console">
          <Terminal />
          {errorCount ? <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">{errorCount}</span> : null}
        </Button> : null}
        <Button variant="ghost" size="icon" aria-label="Open in new tab" disabled={!result || live.state.mode === "server"} onClick={() => result && openInNewTab(result.html, `${repo} — preview`)} data-testid="button-open-tab">
          <ExternalLink />
        </Button>
        <Button variant="ghost" size="icon" aria-label={full ? "Exit full screen" : "Full screen"} onClick={() => setFull(!full)} data-testid="button-fullscreen">
          {full ? <Minimize2 /> : <Maximize2 />}
        </Button>
        {full ? (
          <Button variant="ghost" size="icon" aria-label="Back to code" onClick={() => navigate(projectPath(owner, repo, "files"))}>
            <Code2 />
          </Button>
        ) : null}
      </div>

      {notes.length && !full ? (
        <button type="button" onClick={() => setNotesOpen(!notesOpen)} aria-expanded={notesOpen} className="flex shrink-0 items-start gap-2 border-b bg-surface px-3 py-2 text-left text-xs text-muted-foreground" data-testid="preview-notes">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {notesOpen ? (
            <ul className="space-y-1">
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : (
            <span className="truncate">
              {notes.length} note{notes.length === 1 ? "" : "s"} · {notes[0]}
            </span>
          )}
        </button>
      ) : null}

      <div ref={stage} className={cn("relative min-h-0 flex-1 overflow-hidden", device !== "fit" && "bg-surface-2")}>
        {live.state.mode === "server" ? (
          live.state.status === "running" && live.state.url ? (
            <iframe
              key={live.frameKey}
              title="Chrono live server preview"
              src={live.state.url}
              sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-modals"
              referrerPolicy="no-referrer"
              className="block size-full border-0 bg-white"
              data-testid="live-server-frame"
            />
          ) : (
            <div className="grid h-full place-items-center overflow-y-auto p-5">
              <div className="w-full max-w-lg space-y-3 text-center">
                {live.state.status === "starting" || live.state.status === "stopping" ? (
                  <Loader2 className="mx-auto size-7 animate-spin text-muted-foreground" />
                ) : live.state.status === "failed" ? (
                  <AlertTriangle className="mx-auto size-7 text-danger" />
                ) : (
                  <ServerOff className="mx-auto size-7 text-muted-foreground" />
                )}
                <p className="text-sm font-medium">
                  {live.state.status === "starting" ? (live.state.message ?? "Starting your project…")
                    : live.state.status === "failed" ? (live.state.error ?? live.state.message ?? "The live server could not start.")
                    : live.state.status === "stopping" ? "Stopping your server…"
                    : live.state.status === "idle" ? "Run this project's dev server in a cloud sandbox."
                    : (live.state.message ?? "Your live server is stopped.")}
                </p>
                {live.state.status === "idle" || live.state.status === "stopped" ? (
                  <Button size="sm" onClick={live.start} data-testid="button-start-live-server-body">
                    {live.state.status === "idle" ? "Start live server" : "Start again"}
                  </Button>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  Chrono copies current editor files, including unsaved edits, into an isolated Vercel Sandbox. The server expires after 10 minutes. Anyone with the preview URL can view the site, so do not put secrets in project files.
                </p>
                {live.state.logs ? (
                  <details className="rounded-md border text-left">
                    <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground">Server logs</summary>
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words border-t p-3 font-mono text-[10px]">{live.state.logs}</pre>
                  </details>
                ) : null}
                {live.state.error ? <p role="alert" className="text-xs text-danger">{live.state.error}</p> : null}
              </div>
            </div>
          )
        ) : state.status === "error" ? (
          <div className="h-full overflow-y-auto p-4">
            <ErrorCard
              title="The preview couldn't be built"
              message={state.error.message}
              file={state.error.file}
              line={state.error.line}
              frame={state.error.frame}
              onOpen={state.error.file ? () => openFile(state.error.file!) : undefined}
              onAskAi={() => askAi(state.error, true)}
            />
            <p className="mt-3 text-center text-xs text-muted-foreground">Fix the file and the preview rebuilds automatically.</p>
          </div>
        ) : result ? (
          <div
            className={cn("h-full", device === "phone" && "mx-auto my-3 h-[calc(100%-1.5rem)] w-[390px] max-w-full overflow-hidden rounded-[1.5rem] border-4 border-foreground/80 shadow-lg")}
            style={device === "desktop" ? { width: 1280, height: `${100 / desktopScale}%`, transform: `scale(${desktopScale})`, transformOrigin: "top left" } : undefined}
          >
            <iframe
              key={p.frameKey}
              ref={p.frameRef}
              title={`Preview of ${repo}`}
              srcDoc={result.html}
              sandbox={PREVIEW_SANDBOX}
              referrerPolicy="no-referrer"
              allow="clipboard-write"
              className="block size-full border-0 bg-white"
              data-testid="preview-frame"
            />
          </div>
        ) : (
          <div className="grid h-full place-items-center text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" /> {state.status === "analyzing" ? "Detecting project…" : "Building preview…"}
            </span>
          </div>
        )}
        {live.state.mode === "browser" && state.status === "building" && result ? <div className="absolute inset-x-0 top-0 h-0.5 animate-pulse bg-primary" aria-hidden /> : null}

        {live.state.mode === "browser" && runtimeError && state.status !== "error" ? (
          <div className="absolute inset-x-2 bottom-2 max-h-[70%] overflow-y-auto">
            <div className="relative">
              <button type="button" onClick={p.dismissErrors} aria-label="Dismiss error" className="absolute right-2 top-2 z-10 grid size-8 place-items-center rounded text-muted-foreground hover:bg-surface-2">
                <X className="size-4" />
              </button>
              <ErrorCard
                title={p.errors.length > 1 ? `Runtime error (${p.errors.length})` : "Runtime error"}
                message={runtimeError.message}
                file={runtimeError.file}
                line={runtimeError.line}
                frame={runtimeError.frame}
                onOpen={runtimeError.file ? () => openFile(runtimeError.file!) : undefined}
                onAskAi={() => askAi(runtimeError, false)}
              />
            </div>
          </div>
        ) : null}
      </div>

      {!full && live.state.mode === "browser" && result ? (
        <p className="shrink-0 border-t px-3 py-1.5 text-center font-mono text-[10px] text-muted-foreground">
          Sandboxed · includes unsaved edits · {result.modules} modules{result.packages.length ? ` · ${result.packages.length} npm packages via esm.sh` : ""} · {result.durationMs} ms
        </p>
      ) : null}

      <BottomSheet open={consoleOpen} onOpenChange={setConsoleOpen} title="Console" description="Output from the preview (sandboxed).">
        {p.logs.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No console output yet.</p>
        ) : (
          <ol className="max-h-[55dvh] divide-y overflow-y-auto rounded-md border font-mono text-[11px]" data-testid="console-log">
            {p.logs.map((l) => (
              <li key={l.id} className={cn("whitespace-pre-wrap break-words px-2 py-1.5", LEVEL_CLS[l.level], l.level === "error" && "bg-danger/5", l.level === "warn" && "bg-warning/5")}>
                {l.text}
              </li>
            ))}
          </ol>
        )}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={p.clearLogs}>
            Clear
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setConsoleOpen(false);
              p.reload();
            }}
          >
            <RotateCw /> Reload
          </Button>
        </div>
      </BottomSheet>
    </div>
  );
}
