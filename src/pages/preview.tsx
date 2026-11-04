import { Link } from "wouter";
import { CheckCircle2, ChevronRight, MonitorPlay, XCircle } from "lucide-react";
import { AppShell, PageIntro } from "@/components/layout/app-shell";
import { recentRepos } from "@/features/github/recent";
import { projectPath } from "@/lib/nav";

const MODES = [
  {
    title: "Browser",
    body: "Instant, on this device. Runs frontend code in a sandboxed frame.",
    items: ["Static HTML / CSS / JavaScript (multi-page)", "Vite + React / Preact (JS & TypeScript), Create React App", "Tailwind CSS v3 / v4, CSS modules, JSON & asset imports", "npm packages (loaded from esm.sh at your package.json versions)"],
  },
  {
    title: "Live server",
    body: "A temporary cloud sandbox (up to 10 minutes) that installs dependencies and runs your dev script.",
    items: ["Node projects with a dev or start script (tested with Next.js and Vite)", "API routes and server code run for real", "Images, fonts and other binary files are copied from GitHub"],
  },
] as const;
const NOT_YET = ["Native apps: React Native / Expo, Flutter, Electron", "Non-Node backends (PHP, Python, Go, Ruby…) and databases"];

export default function PreviewPage() {
  const items = recentRepos().slice(0, 8);
  return (
    <AppShell title="Preview">
      <PageIntro>Run a project — including unsaved edits — in the browser or on a live server. Pick one to open its Preview tab.</PageIntro>
      {items.length ? (
      <ul className="stagger mb-6 divide-y overflow-hidden rounded-lg border bg-surface" data-testid="list-preview-projects">
        {items.map((r) => (
          <li key={`${r.owner}/${r.name}`}>
            <Link href={projectPath(r.owner, r.name, "preview")} className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-surface-2" data-testid={`link-preview-${r.owner}-${r.name}`}>
              <MonitorPlay className="size-5 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                <span className="text-muted-foreground">{r.owner}/</span>
                {r.name}
              </span>
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      ) : (
        <p className="mb-6 rounded-lg border border-dashed p-4 text-sm text-muted-foreground" data-testid="text-preview-empty">
          Open a repository from <Link href="/app/projects" className="text-primary underline-offset-2 hover:underline">Projects</Link> and it will appear here.
        </p>
      )}
      <section className="grid gap-4 sm:grid-cols-2" aria-label="Preview modes">
        {MODES.map((m) => (
          <div key={m.title} className="rounded-lg border bg-surface p-4">
            <h2 className="text-sm font-semibold">{m.title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{m.body}</p>
            <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
              {m.items.map((s) => (
                <li key={s} className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />{s}</li>
              ))}
            </ul>
          </div>
        ))}
      </section>
      <section className="mt-4 rounded-lg border p-4">
        <h2 className="text-sm font-semibold">Not supported yet</h2>
        <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
          {NOT_YET.map((s) => (
            <li key={s} className="flex gap-2"><XCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />{s}</li>
          ))}
        </ul>
      </section>
    </AppShell>
  );
}
