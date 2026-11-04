import { useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const BUILD_COMMIT: string = typeof __BUILD_COMMIT__ === "string" ? __BUILD_COMMIT__ : "";
const CHECK_EVERY_MS = 10 * 60_000;

/** True when the server is running a different deploy than the one this tab loaded. */
export async function newerDeployAvailable(current = BUILD_COMMIT): Promise<boolean> {
  if (!current) return false;
  try {
    const res = await fetch("/api/health", { cache: "no-store", credentials: "same-origin" });
    if (!res.ok) return false;
    const { commit } = (await res.json()) as { commit?: string | null };
    return typeof commit === "string" && commit.length > 0 && commit !== current;
  } catch {
    return false;
  }
}

/**
 * A tab left open across a deploy keeps running the old bundle, so fixes look "not fixed".
 * Checks when the tab comes back to the foreground and every 10 minutes, then offers a reload.
 */
export function UpdatePrompt({ current = BUILD_COMMIT }: { current?: string }) {
  const [available, setAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!current || available) return;
    let alive = true;
    const check = () => {
      if (document.visibilityState !== "visible") return;
      void newerDeployAvailable(current).then((yes) => alive && yes && setAvailable(true));
    };
    const onVisible = () => check();
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [current, available]);

  if (!available || dismissed) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+0.75rem)] z-[60] flex justify-center px-4">
      <div
        role="status"
        className="pointer-events-auto flex items-center gap-2 rounded-lg border bg-surface py-1.5 pl-3 pr-1.5 text-sm shadow-lg animate-pop"
        data-testid="banner-update-available"
      >
        <span>New version available.</span>
        <Button size="sm" onClick={() => window.location.reload()} data-testid="button-update-reload">
          <RefreshCw /> Reload
        </Button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="grid size-9 place-items-center rounded-md text-muted-foreground hover:bg-surface-2"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
