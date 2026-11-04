import { describe, expect, it } from "vitest";
import { SAMPLE_FILES as DEMO_FILES } from "@/test/sample-project";
import { analyzeProject, type PreviewPlanOk } from "./detect";
import { BuildError, buildPreview, codeFrame } from "./bundler";

function fsOf(files: Record<string, string>) {
  const paths = Object.keys(files);
  const read = async (p: string) => {
    if (!(p in files)) throw new Error("missing");
    return files[p]!;
  };
  return { paths, read, readOrNull: async (p: string) => files[p] ?? null };
}

async function plan(files: Record<string, string>) {
  const fs = fsOf(files);
  return { fs, plan: await analyzeProject(fs.paths, fs.readOrNull) };
}

function bootConfig(html: string) {
  const m = /window\.__mdai_boot\((.*)\);<\/script>/s.exec(html);
  return JSON.parse(m![1]!) as { modules: Record<string, { code: string; deps: Record<string, { path?: string; ext?: string }> }>; entries: string[]; externals: Record<string, string> };
}

const demo = Object.fromEntries(DEMO_FILES.map((f) => [f.path, f.content]));

describe("analyzeProject", () => {
  it("detects the sample app as Vite + React", async () => {
    const { plan: p } = await plan(demo);
    expect(p).toMatchObject({ supported: true, runtime: "vite", framework: "react", html: "index.html", root: "" });
  });
  it("detects static sites, CRA and sub-folder apps", async () => {
    expect((await plan({ "index.html": "<h1>x</h1>", "style.css": "" })).plan).toMatchObject({ supported: true, runtime: "static" });
    const cra = await plan({ "package.json": '{"dependencies":{"react":"18","react-dom":"18","react-scripts":"5"}}', "public/index.html": '<div id="root"></div>', "src/index.js": "" });
    expect(cra.plan).toMatchObject({ supported: true, runtime: "cra", entry: "src/index.js" });
    const sub = await plan({ "README.md": "", "web/package.json": '{"devDependencies":{"vite":"6"}}', "web/index.html": "" });
    expect(sub.plan).toMatchObject({ supported: true, root: "web/", html: "web/index.html" });
  });
  it("explains unsupported runtimes", async () => {
    const next = (await plan({ "package.json": '{"dependencies":{"next":"15","react":"19"},"scripts":{"dev":"next dev"}}', "app/page.tsx": "" })).plan;
    expect(next).toMatchObject({ supported: false, label: "Next.js", liveServer: true });
    if (!next.supported) expect(next.reason).toMatch(/server/i);
    const noNodeScript = (await plan({ "package.json": '{"dependencies":{"next":"15","react":"19"}}', "app/page.tsx": "" })).plan;
    expect(noNodeScript).toMatchObject({ supported: false, label: "Next.js", liveServer: false });
    expect((await plan({ "requirements.txt": "flask", "app.py": "" })).plan).toMatchObject({ supported: false, label: "Python" });
    expect((await plan({ "package.json": '{"dependencies":{"express":"4"}}', "server.js": "" })).plan).toMatchObject({ supported: false, label: "Node.js server" });
    expect((await plan({ "package.json": '{"dependencies":{"vue":"3","vite":"6"}}', "index.html": "" })).plan).toMatchObject({ supported: false, label: "Vue" });
  });
});

describe("buildPreview", () => {
  it("bundles the sample app: entries, local modules, CSS, one shared React from esm.sh", async () => {
    const { fs, plan: p } = await plan(demo);
    const r = await buildPreview({ plan: p as PreviewPlanOk, paths: fs.paths, read: fs.read });
    const cfg = bootConfig(r.html);
    expect(cfg.entries).toEqual(["src/main.jsx"]);
    expect(Object.keys(cfg.modules)).toEqual(expect.arrayContaining(["src/main.jsx", "src/App.jsx", "src/components/TaskItem.jsx", "src/styles.css"]));
    const urls = Object.keys(cfg.externals);
    expect(urls.some((u) => u.startsWith("https://esm.sh/react@18"))).toBe(true);
    expect(urls.find((u) => u.includes("react-dom"))).toMatch(/external=react/);
    // the import map gives libraries the same React URL our code uses
    const map = JSON.parse(/<script type="importmap">(.*?)<\/script>/s.exec(r.html)![1]!.replace(/\\u003c/g, "<")) as { imports: Record<string, string> };
    expect(urls).toContain(map.imports.react);
    expect(cfg.modules["src/styles.css"]!.code).toContain("__mdai_css");
    expect(r.html).not.toContain('src="/src/main.jsx"');
    expect(r.packages).toEqual(expect.arrayContaining(["react", "react-dom"]));
  });

  it("keeps file content from breaking out of the script tag", async () => {
    const files = { "index.html": '<script type="module" src="./a.js"></script>', "a.js": 'console.log("</script><script>alert(1)</script>");' };
    const { fs, plan: p } = await plan(files);
    const r = await buildPreview({ plan: p as PreviewPlanOk, paths: fs.paths, read: fs.read });
    const tail = r.html.slice(r.html.indexOf("__mdai_boot("));
    expect(tail).not.toContain("<script>alert");
    expect(tail).toContain("\\u003c/script>");
  });

  it("inlines static CSS/JS, resolves aliases, TS, JSON, CSS modules and ?raw", async () => {
    const files = {
      "package.json": '{"devDependencies":{"vite":"6","typescript":"5"}}',
      "tsconfig.json": '{ // comment\n "compilerOptions": { "baseUrl": ".", "paths": { "~/*": ["src/*"] }, }, }',
      "index.html": '<link rel="stylesheet" href="/base.css"><script src="legacy.js"></script><script type="module" src="/src/main.ts"></script><img src="/logo.svg">',
      "base.css": "body{margin:0}",
      "legacy.js": "window.legacy = 1;",
      "public/logo.svg": "<svg xmlns='http://www.w3.org/2000/svg'/>",
      "src/main.ts": 'import { n } from "~/util";\nimport data from "./data.json";\nimport s from "./a.module.css";\nimport txt from "./note.txt?raw";\nconst x: number = n + data.v;\nconsole.log(x, s.card, txt, import.meta.env.DEV);',
      "src/util.ts": "export const n: number = 1;",
      "src/data.json": '{"v":2}',
      "src/a.module.css": ".card{color:red} .card:hover .title{color:blue} @media (min-width: 1.5em) { .card{color:green} }",
      "src/note.txt": "hello",
    };
    const { fs, plan: p } = await plan(files);
    const r = await buildPreview({ plan: p as PreviewPlanOk, paths: fs.paths, read: fs.read });
    const cfg = bootConfig(r.html);
    expect(r.html).toContain("body{margin:0}");
    expect(r.html).toContain("window.legacy = 1;");
    expect(r.html).toContain("data:image/svg+xml");
    expect(cfg.modules["src/main.ts"]!.deps["~/util"]).toEqual({ path: "src/util.ts" });
    expect(cfg.modules["src/main.ts"]!.code).not.toContain(": number");
    expect(cfg.modules["src/main.ts"]!.code).toContain("__mdai_env.DEV");
    expect(cfg.modules["src/note.txt?raw"]!.code).toContain('"hello"');
    const css = cfg.modules["src/a.module.css"]!.code;
    expect(css).toContain("card_");
    expect(css).toContain("title_");
    expect(css).toContain("1.5em");
  });

  it("reports syntax errors with file, line and a code frame", async () => {
    const files = { "index.html": '<script type="module" src="./a.jsx"></script>', "a.jsx": "const ok = 1;\nconst bad = <div>;\n" };
    const { fs, plan: p } = await plan(files);
    const err = await buildPreview({ plan: p as PreviewPlanOk, paths: fs.paths, read: fs.read }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BuildError);
    expect(err).toMatchObject({ file: "a.jsx", line: 2 });
    expect((err as BuildError).frame).toContain("> 2 |");
  });

  it("reports unresolved imports and Node built-ins", async () => {
    const base = { "index.html": '<script type="module" src="./a.js"></script>' };
    const miss = await plan({ ...base, "a.js": 'import x from "./nope";' });
    await expect(buildPreview({ plan: miss.plan as PreviewPlanOk, paths: miss.fs.paths, read: miss.fs.read })).rejects.toThrow(/Cannot resolve "\.\/nope"/);
    const fsMod = await plan({ ...base, "a.js": 'import fs from "fs";' });
    await expect(buildPreview({ plan: fsMod.plan as PreviewPlanOk, paths: fsMod.fs.paths, read: fsMod.fs.read })).rejects.toThrow(/Node\.js built-in/);
  });

  it("code frames point at the line", () => {
    expect(codeFrame("a\nb\nc", 2, 0)).toBe("  1 | a\n> 2 | b\n    | ^\n  3 | c");
  });
});
