/**
 * Browser-preview compatibility detection. Reads package.json / file names as DATA only — nothing from
 * the repository is executed here.
 */

import { detectLiveRuntime, type LiveRuntimeResult } from "@/lib/live-runtime";

export type PreviewRuntime = "static" | "vite" | "cra" | "html-modules";

export interface PreviewPlanOk {
  supported: true;
  runtime: PreviewRuntime;
  /** Directory holding the app ("" = repo root, otherwise "web/" style with trailing slash). */
  root: string;
  /** HTML entry (repo path). */
  html: string;
  /** All HTML pages under the root (for multi-page static sites). */
  pages: string[];
  /** Entry module for CRA-style projects whose HTML has no script tag. */
  entry: string | null;
  /** package.json dependency → version range. */
  deps: Record<string, string>;
  framework: "react" | "preact" | "none";
  tailwind: 3 | 4 | null;
  label: string;
  notes: string[];
}

export interface PreviewPlanUnsupported {
  supported: false;
  label: string;
  reason: string;
  hint: string;
  /** True when the live sandbox can run the project (Node script, Flutter, Dart or JVM server). */
  liveServer: boolean;
  /** Set for Flutter, Dart and Gradle/Maven projects (decided by src/lib/live-runtime.ts). */
  live?: LiveRuntimeResult;
}

export type PreviewPlan = PreviewPlanOk | PreviewPlanUnsupported;

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

function parsePkg(text: string | null): PackageJson | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" ? (v as PackageJson) : null;
  } catch {
    return null;
  }
}

const UNSUPPORTED_DEPS: [dep: string | RegExp, label: string, reason: string][] = [
  ["next", "Next.js", "Next.js renders on a Node.js server (SSR, API routes, server components)."],
  ["nuxt", "Nuxt", "Nuxt needs its Node.js server and the Vue compiler."],
  ["@sveltejs/kit", "SvelteKit", "SvelteKit needs its server runtime and the Svelte compiler."],
  ["@remix-run/react", "Remix", "Remix renders on a server runtime."],
  ["@react-router/dev", "React Router framework", "React Router's framework mode builds with its own server runtime."],
  ["astro", "Astro", "Astro pages are compiled by the Astro build."],
  ["gatsby", "Gatsby", "Gatsby builds pages with a Node.js toolchain (GraphQL data layer)."],
  ["@angular/core", "Angular", "Angular needs the Angular compiler."],
  ["react-native", "React Native", "React Native targets a native mobile runtime, not the browser."],
  ["expo", "Expo", "Expo apps run on a native runtime."],
  ["electron", "Electron", "Electron apps need a desktop runtime."],
  ["svelte", "Svelte", "`.svelte` components need the Svelte compiler, which the browser preview doesn't include yet."],
  ["vue", "Vue", "`.vue` single-file components need the Vue compiler, which the browser preview doesn't include yet."],
  ["solid-js", "Solid", "Solid's JSX needs the Solid compiler, which the browser preview doesn't include yet."],
];

const SERVER_DEPS = ["express", "fastify", "koa", "hono", "@nestjs/core", "@hapi/hapi"];

const HINT_SERVER = "Deploy it (e.g. a Netlify deploy preview) to try it — or preview a static/Vite frontend folder instead.";

function semverMajor(range: string | undefined): number | null {
  const m = range ? /(\d+)/.exec(range) : null;
  return m ? Number(m[1]) : null;
}

/**
 * Decide whether (and how) a workspace can be previewed in the browser sandbox.
 * `read` returns current workspace content (drafts included) or null.
 */
export async function analyzeProject(paths: readonly string[], read: (path: string) => Promise<string | null>): Promise<PreviewPlan> {
  const set = new Set(paths);

  // Flutter, Dart and Kotlin/JVM projects never run in the browser bundler; the live sandbox decides.
  const nativeRoot = !set.has("package.json") &&
    ["pubspec.yaml", "settings.gradle", "settings.gradle.kts", "build.gradle", "build.gradle.kts", "pom.xml"].some((p) => set.has(p));
  if (nativeRoot) {
    const live = await detectLiveRuntime(paths, read);
    if (live.kind === "unsupported") return { supported: false, label: live.label, reason: live.reason, hint: live.hint, liveServer: false, live };
    return { supported: false, label: live.label, reason: live.label + " runs on a live server, not in the browser preview.", hint: "", liveServer: true, live };
  }
  const htmlFiles = paths.filter((p) => /\.html?$/i.test(p) && !/(^|\/)(node_modules|dist|build|\.git)\//.test(p));

  // Pick the app root: repo root if it has package.json/index.html, else the shallowest folder that does.
  const candidates = ["", ...new Set(paths.filter((p) => /(^|\/)(package\.json|index\.html)$/.test(p) && p.split("/").length <= 3).map((p) => p.replace(/[^/]+$/, "")))]
    .filter((dir) => set.has(`${dir}package.json`) || set.has(`${dir}index.html`) || set.has(`${dir}public/index.html`))
    .sort((a, b) => a.split("/").length - b.split("/").length);
  const root = candidates[0] ?? "";
  const pkg = parsePkg(set.has(`${root}package.json`) ? await read(`${root}package.json`) : null);
  const deps = { ...pkg?.devDependencies, ...pkg?.dependencies };
  const has = (d: string) => d in deps;
  const liveServer = Boolean(pkg?.scripts?.dev || pkg?.scripts?.start);

  if (!pkg && !htmlFiles.length) {
    const lang = paths.some((p) => /(^|\/)(requirements\.txt|pyproject\.toml|manage\.py)$/.test(p))
      ? "Python"
      : paths.some((p) => /(^|\/)go\.mod$/.test(p))
        ? "Go"
        : paths.some((p) => /(^|\/)Gemfile$/.test(p))
          ? "Ruby"
          : paths.some((p) => /(^|\/)pubspec\.yaml$/.test(p))
            ? "Flutter / Dart"
            : paths.some((p) => /\.php$/.test(p))
              ? "PHP"
              : paths.some((p) => /(^|\/)(Cargo\.toml)$/.test(p))
                ? "Rust"
                : null;
    return {
      supported: false,
      label: lang ?? "No web entry point",
      reason: lang ? `${lang} code runs on a server or native runtime — the browser preview only runs frontend code.` : "There's no index.html or package.json, so there's nothing the browser can render.",
      hint: lang ? HINT_SERVER : "Add an index.html (or a Vite app) to preview it here.",
      liveServer: false,
    };
  }

  for (const [dep, label, reason] of UNSUPPORTED_DEPS) {
    if (typeof dep === "string" ? has(dep) : Object.keys(deps).some((d) => dep.test(d))) {
      // A Vite + React app may list e.g. "vue" by accident — only bail on frameworks that own the entry.
      return { supported: false, label, reason, hint: label === "Svelte" || label === "Vue" || label === "Solid" ? "React, Preact, TypeScript and plain HTML/CSS/JS projects preview in the browser today." : HINT_SERVER, liveServer };
    }
  }

  const pages = htmlFiles.filter((p) => p.startsWith(root)).sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
  const framework = has("react") ? "react" : has("preact") ? "preact" : "none";
  const twMajor = semverMajor(deps.tailwindcss ?? deps["@tailwindcss/vite"]);
  const tailwind = twMajor === null ? null : twMajor >= 4 ? 4 : 3;
  const notes: string[] = [];
  if (tailwind) notes.push(`Tailwind CSS v${tailwind} is generated in the browser — close to, but not exactly, the production build.`);
  if (paths.some((p) => /\.(scss|sass|less|styl)$/.test(p))) notes.push("Sass / Less files aren't compiled in the preview; those styles will be missing.");
  if (paths.some((p) => /(^|\/)(netlify\/functions|api|server)\//.test(p))) notes.push("Server code (API routes / functions) doesn't run in the preview — requests to it will fail.");

  if (has("react-scripts")) {
    const html = `${root}public/index.html`;
    const entry = ["src/index.tsx", "src/index.jsx", "src/index.js", "src/index.ts"].map((e) => `${root}${e}`).find((e) => set.has(e)) ?? null;
    if (!set.has(html) || !entry) return { supported: false, label: "Create React App", reason: "Couldn't find public/index.html and src/index.* for this Create React App project.", hint: "Check the project layout.", liveServer };
    return { supported: true, runtime: "cra", root, html, pages: [html], entry, deps, framework, tailwind, label: "Create React App", notes };
  }

  const indexHtml = set.has(`${root}index.html`) ? `${root}index.html` : (pages.find((p) => /(^|\/)index\.html?$/i.test(p)) ?? pages[0]);
  if (!indexHtml) {
    const server = SERVER_DEPS.find(has);
    return {
      supported: false,
      label: server ? "Node.js server" : "No index.html",
      reason: server ? `This looks like a ${server} server — server code doesn't run in the browser preview.` : "This package has no index.html entry page for the browser.",
      hint: server ? HINT_SERVER : "Vite and static sites need an index.html at the project root.",
      liveServer,
    };
  }

  if (has("vite")) {
    const label = framework === "react" ? "Vite + React" : framework === "preact" ? "Vite + Preact" : has("typescript") ? "Vite + TypeScript" : "Vite";
    return { supported: true, runtime: "vite", root, html: indexHtml, pages, entry: null, deps, framework, tailwind, label, notes };
  }
  if (pkg) return { supported: true, runtime: "html-modules", root, html: indexHtml, pages, entry: null, deps, framework, tailwind, label: "HTML + JavaScript modules", notes };
  return { supported: true, runtime: "static", root, html: indexHtml, pages, entry: null, deps, framework, tailwind, label: "HTML / CSS / JS", notes };
}
