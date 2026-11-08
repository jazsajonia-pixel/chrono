/**
 * Which runtime a Live server preview uses for a repository, decided from manifest files only
 * (package.json, pubspec.yaml, Gradle and Maven build files). Nothing from the repository is
 * executed here. Shared by the preview-server function, the website and the mobile app (copied
 * byte-for-byte into chronoapp2), so all three agree on what can run.
 */

export const LIVE_PREVIEW_PORT = 3000;

export type LiveRuntime =
  | {
      kind: "node";
      label: string;
      script: "dev" | "start";
      args: string[];
      /** The script wraps several processes, so flags can't reach the dev server: forward the port instead. */
      proxy?: boolean;
    }
  | { kind: "flutter-web"; label: string; projectName: string }
  | { kind: "dart"; label: string; entry: string }
  | { kind: "gradle"; label: string; task: string; jdk: number }
  | { kind: "maven"; label: string; goal: string; jdk: number; wrapper: boolean };

export interface LiveRuntimeUnsupported {
  kind: "unsupported";
  label: string;
  reason: string;
  hint: string;
  /** Android apps can still be installed from a release APK. */
  android?: boolean;
}

export type LiveRuntimeResult = LiveRuntime | LiveRuntimeUnsupported;

/** Runtimes that install an SDK and compile before serving: they get a longer sandbox lifetime. */
export function isHeavyRuntime(runtime: LiveRuntime): boolean {
  return runtime.kind !== "node";
}

export type ReadFile = (path: string) => Promise<string | null> | string | null;

interface PackageJson {
  scripts?: Record<string, unknown>;
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
}

/** `vite …` / `next dev …` run directly (optionally behind env assignments or npx), with nothing chained. */
function runsDirectly(command: string, binary: "vite" | "next"): boolean {
  if (/&&|\|\||[;|&]/.test(command)) return false;
  const words = command.trim().split(/\s+/).filter((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word));
  if (words[0] === "npx" || words[0] === "cross-env") words.shift();
  return words[0] === binary;
}

function nodeRuntime(text: string): LiveRuntimeResult {
  let manifest: PackageJson;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object") throw new Error("not an object");
    manifest = parsed as PackageJson;
  } catch {
    return { kind: "unsupported", label: "Node.js", reason: "package.json is not valid JSON.", hint: "Fix package.json and try again." };
  }
  const scripts = manifest.scripts ?? {};
  const script = typeof scripts.dev === "string" ? "dev" : typeof scripts.start === "string" ? "start" : undefined;
  if (!script) {
    return { kind: "unsupported", label: "Node.js", reason: "package.json has no dev or start script.", hint: "Add a dev or start script to package.json to use Live server." };
  }
  const deps = { ...manifest.dependencies, ...manifest.devDependencies };
  const command = String(scripts[script]);
  const port = String(LIVE_PREVIEW_PORT);
  if (deps.next) {
    if (script === "dev" && !runsDirectly(command, "next")) return { kind: "node", label: "Next.js", script, args: [], proxy: true };
    return { kind: "node", label: "Next.js", script, args: script === "dev" ? ["--hostname", "0.0.0.0", "--port", port] : [] };
  }
  if (deps.vite) {
    if (script === "dev" && !runsDirectly(command, "vite")) return { kind: "node", label: "Vite", script, args: [], proxy: true };
    return { kind: "node", label: "Vite", script, args: script === "dev" ? ["--host", "0.0.0.0", "--port", port, "--strictPort"] : [] };
  }
  return { kind: "node", label: "Node.js", script, args: [] };
}

/** Top-level `key: value` from a pubspec (enough for `name:`; full YAML parsing isn't needed). */
function pubspecName(text: string): string | null {
  const m = /^name:\s*["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*$/m.exec(text);
  return m ? m[1]! : null;
}

/** pubspec declares the Flutter SDK as a dependency (`flutter:\n    sdk: flutter`). */
function pubspecUsesFlutter(text: string): boolean {
  return /^\s+sdk:\s*["']?flutter["']?\s*$/m.test(text);
}

const ANDROID_HINT = "Android apps run on a phone, not on a web server. Install a build from the repository's releases, or add a web or server target.";

async function dartRuntime(paths: ReadonlySet<string>, read: ReadFile): Promise<LiveRuntimeResult> {
  const pubspec = (await read("pubspec.yaml")) ?? "";
  if (pubspecUsesFlutter(pubspec)) {
    const name = pubspecName(pubspec) ?? "app";
    if (!paths.has("lib/main.dart")) {
      return { kind: "unsupported", label: "Flutter", reason: "There's no lib/main.dart to build.", hint: "Live server builds the Flutter app in lib/main.dart for the web." };
    }
    return { kind: "flutter-web", label: "Flutter (web build)", projectName: name };
  }
  const entries = [...paths].filter((p) => /^bin\/[^/]+\.dart$/.test(p)).sort();
  const entry = entries.find((p) => /^bin\/(server|main)\.dart$/.test(p)) ?? entries[0];
  if (!entry) {
    return { kind: "unsupported", label: "Dart", reason: "This Dart package has no bin/ entry point to run.", hint: "Live server runs Dart servers from bin/server.dart (or another file in bin/)." };
  }
  return { kind: "dart", label: "Dart server", entry };
}

/** Java version a JVM build asks for: jvmToolchain(N), JavaLanguageVersion.of(N), VERSION_N, <java.version>. */
function requestedJdk(texts: string[]): number | null {
  const found: number[] = [];
  for (const t of texts) {
    for (const m of t.matchAll(/jvmToolchain\(\s*(\d{1,2})\s*\)|JavaLanguageVersion\.of\(\s*(\d{1,2})\s*\)|JavaVersion\.VERSION_(?:1_)?(\d{1,2})|<(?:java\.version|maven\.compiler\.release|maven\.compiler\.target)>\s*(?:1\.)?(\d{1,2})\s*</g)) {
      const n = Number(m[1] ?? m[2] ?? m[3] ?? m[4]);
      if (n >= 8 && n <= 30) found.push(n);
    }
  }
  return found.length ? Math.max(...found) : null;
}

/** JDKs the preview installs (Amazon Corretto packages). Old versions round up to 11/17. */
function supportedJdk(n: number): number {
  if (n <= 11) return 11;
  if (n <= 17) return 17;
  if (n <= 21) return 21;
  return 25;
}

function gradleVersion(properties: string | null): [number, number] | null {
  const m = properties ? /gradle-(\d+)\.(\d+)/.exec(properties) : null;
  return m ? [Number(m[1]), Number(m[2])] : null;
}

async function gradleRuntime(paths: ReadonlySet<string>, read: ReadFile): Promise<LiveRuntimeResult> {
  const buildFiles = [...paths].filter((p) => /(^|\/)build\.gradle(\.kts)?$/.test(p) && p.split("/").length <= 3);
  const texts = new Map<string, string>();
  for (const p of buildFiles) texts.set(p, (await read(p)) ?? "");
  const moduleOf = (file: string) => file.replace(/\/?build\.gradle(\.kts)?$/, "");
  const task = (module: string, name: string) => (module ? ":" + module.replace(/\//g, ":") + ":" + name : name);
  const all = [...texts.values()];
  const gradle = gradleVersion(await read("gradle/wrapper/gradle-wrapper.properties"));
  const requested = requestedJdk(all);
  const modern = !gradle || gradle[0] > 8 || (gradle[0] === 8 && gradle[1] >= 5);
  const jdk = supportedJdk(requested ?? (modern ? 21 : 17));
  if (!paths.has("gradlew") || !paths.has("gradle/wrapper/gradle-wrapper.properties")) {
    return { kind: "unsupported", label: "Gradle", reason: "This Gradle project has no Gradle wrapper (gradlew).", hint: "Commit gradlew and the gradle/wrapper folder so Live server can build it." };
  }
  const find = (re: RegExp) => [...texts.entries()].find(([, t]) => re.test(t));
  const wasm = find(/\bwasmJs\s*(\(|\{)/);
  if (wasm && /\bbrowser\s*(\(|\{)/.test(wasm[1])) {
    return { kind: "gradle", label: "Kotlin/Wasm (Compose for Web)", task: task(moduleOf(wasm[0]), "wasmJsBrowserDevelopmentRun"), jdk };
  }
  const js = find(/\bjs\s*\(\s*(IR)?\s*\)\s*\{[\s\S]*?\bbrowser\b/);
  if (js) return { kind: "gradle", label: "Kotlin/JS", task: task(moduleOf(js[0]), "jsBrowserDevelopmentRun"), jdk };
  const spring = find(/org\.springframework\.boot/);
  if (spring && !/^\s*apply\s*false/m.test(spring[1])) {
    // The root build may only declare the plugin (`apply false`); run the module that applies it.
    const applied = [...texts.entries()].find(([, t]) => /id\s*\(?\s*["']org\.springframework\.boot["']\s*\)?(?!\s*(version\s*["'][^"']+["']\s*)?apply\s*false)/.test(t)) ?? spring;
    return { kind: "gradle", label: "Spring Boot (Gradle)", task: task(moduleOf(applied[0]), "bootRun"), jdk };
  }
  const ktor = find(/io\.ktor\.plugin|ktor-server/);
  const app = find(/\bapplication\b\s*(\{|$)|id\s*\(?\s*["']application["']|`application`/m);
  if (ktor || app) {
    const [file] = app ?? ktor!;
    return { kind: "gradle", label: ktor ? "Ktor" : "Kotlin/JVM application", task: task(moduleOf(file), "run"), jdk };
  }
  if (find(/com\.android\.application|androidApplication|android\s*\{/)) {
    return { kind: "unsupported", label: "Android app", reason: "This is an Android app (Kotlin/Gradle).", hint: ANDROID_HINT, android: true };
  }
  return { kind: "unsupported", label: "Gradle", reason: "Couldn't find a web or server target (Ktor, Spring Boot, the application plugin, or a Kotlin/Wasm or Kotlin/JS browser target).", hint: "Live server runs JVM servers and Kotlin browser targets." };
}

async function mavenRuntime(paths: ReadonlySet<string>, read: ReadFile): Promise<LiveRuntimeResult> {
  const pom = (await read("pom.xml")) ?? "";
  if (!/spring-boot/.test(pom)) {
    return { kind: "unsupported", label: "Maven", reason: "Only Spring Boot Maven projects can run on a live server.", hint: "Add the spring-boot-maven-plugin, or use Gradle with Ktor or Spring Boot." };
  }
  const wrapper = paths.has("mvnw") && paths.has(".mvn/wrapper/maven-wrapper.properties");
  return { kind: "maven", label: "Spring Boot (Maven)", goal: "spring-boot:run", jdk: supportedJdk(requestedJdk([pom]) ?? 21), wrapper };
}

/**
 * Decide the live runtime from repo-root manifests. `paths` lists every file in the workspace;
 * `read` returns a file's current text (drafts included) or null.
 */
export async function detectLiveRuntime(pathList: readonly string[], read: ReadFile): Promise<LiveRuntimeResult> {
  const paths = new Set(pathList);
  if (paths.has("package.json")) return nodeRuntime((await read("package.json")) ?? "");
  if (paths.has("pubspec.yaml")) return dartRuntime(paths, read);
  if (["settings.gradle", "settings.gradle.kts", "build.gradle", "build.gradle.kts"].some((p) => paths.has(p))) return gradleRuntime(paths, read);
  if (paths.has("pom.xml")) return mavenRuntime(paths, read);
  return {
    kind: "unsupported",
    label: "No runnable project",
    reason: "There's no package.json, pubspec.yaml, Gradle or Maven build at the repository root.",
    hint: "Live server runs Node.js, Flutter (web build), Dart servers and Kotlin/JVM projects from the repository root.",
  };
}

/**
 * Top-level folders a runtime never needs on the server, so large native projects stay inside the
 * upload limits (a Flutter web build doesn't use android/ or ios/, for example).
 */
export function liveOmitFolders(runtime: LiveRuntime): string[] {
  if (runtime.kind === "flutter-web") return ["android", "ios", "macos", "windows", "linux", "test", "integration_test"];
  if (runtime.kind === "dart") return ["test"];
  if (runtime.kind === "gradle" && /wasmJs|jsBrowser/.test(runtime.task)) return ["iosApp", "androidApp"];
  return [];
}

/** Rough first-start time, shown before starting. */
export function liveStartEstimate(runtime: LiveRuntime): string {
  switch (runtime.kind) {
    case "node": return "usually under a minute";
    case "flutter-web": return "about 4–8 minutes the first time (installs Flutter and builds), faster after";
    case "dart": return "about 1–2 minutes the first time";
    case "gradle":
    case "maven": return "about 3–6 minutes the first time (installs a JDK and dependencies), faster after";
  }
}
