import { describe, expect, it } from "vitest";
import { detectLiveRuntime, liveOmitFolders, type LiveRuntimeResult } from "../../src/lib/live-runtime.js";
import { HttpError } from "../lib/http.js";
import { PREVIEW_STATIC_SOURCE, PREVIEW_PROXY_SOURCE, previewRunner, previewStartScript, previewTimeoutMs } from "../lib/sandbox-preview.js";
import { startingMessage } from "../functions/preview-server.js";

const detect = (files: Record<string, string>): Promise<LiveRuntimeResult> =>
  detectLiveRuntime(Object.keys(files), (p) => files[p] ?? null);

const WRAPPER = { gradlew: "#!/bin/sh", "gradle/wrapper/gradle-wrapper.properties": "distributionUrl=https\\://services.gradle.org/distributions/gradle-8.10-bin.zip" };

describe("live runtime detection", () => {
  it("builds Flutter apps for the web and adds web support when missing", async () => {
    const r = await detect({
      "pubspec.yaml": "name: shop_app\nenvironment:\n  sdk: ^3.5.0\ndependencies:\n  flutter:\n    sdk: flutter\n",
      "lib/main.dart": "void main() {}",
    });
    expect(r).toEqual({ kind: "flutter-web", label: "Flutter (web build)", projectName: "shop_app" });
    if (r.kind !== "flutter-web") throw new Error();
    const script = previewStartScript(r);
    expect(script).toContain("git clone --depth 1 --branch stable https://github.com/flutter/flutter.git");
    expect(script).toContain("[ -f web/index.html ] || flutter create --platforms web --project-name 'shop_app' --no-pub .");
    expect(script).toContain("flutter build web --release");
    expect(script).toContain("exec node .chrono-preview/static.mjs build/web");
    expect(liveOmitFolders(r)).toContain("android");
    expect(previewTimeoutMs(r)).toBe(20 * 60 * 1000);
  });

  it("runs Dart servers from bin/ behind the forwarder", async () => {
    const r = await detect({ "pubspec.yaml": "name: api\ndependencies:\n  shelf: ^1.4.0\n", "bin/server.dart": "", "bin/tool.dart": "" });
    expect(r).toMatchObject({ kind: "dart", entry: "bin/server.dart" });
    if (r.kind !== "dart") throw new Error();
    const script = previewStartScript(r);
    expect(script).toContain("dartsdk-linux-$arch-release.zip");
    expect(script).toContain("CHRONO_PROXY_ANY=1 node .chrono-preview/proxy.mjs");
    expect(script.trim().endsWith("dart run 'bin/server.dart'")).toBe(true);
  });

  it("detects Ktor, Spring Boot and Kotlin/Wasm Gradle projects with the right task and JDK", async () => {
    expect(await detect({ ...WRAPPER, "settings.gradle.kts": "", "build.gradle.kts": 'plugins { id("io.ktor.plugin") version "3.0.0"\n application }\nkotlin { jvmToolchain(17) }' }))
      .toMatchObject({ kind: "gradle", label: "Ktor", task: "run", jdk: 17 });
    expect(await detect({ ...WRAPPER, "settings.gradle.kts": "", "build.gradle.kts": 'plugins { id("org.springframework.boot") version "3.4.0" }' }))
      .toMatchObject({ kind: "gradle", task: "bootRun", jdk: 21 });
    expect(await detect({
      ...WRAPPER,
      "settings.gradle.kts": 'include(":composeApp")',
      "build.gradle.kts": "plugins { alias(libs.plugins.kotlinMultiplatform) apply false }",
      "composeApp/build.gradle.kts": "kotlin {\n  wasmJs {\n    browser {\n    }\n  }\n}",
    })).toMatchObject({ kind: "gradle", task: ":composeApp:wasmJsBrowserDevelopmentRun" });
  });

  it("explains Android-only apps instead of trying to run them", async () => {
    const r = await detect({ ...WRAPPER, "settings.gradle.kts": "", "build.gradle.kts": "", "app/build.gradle.kts": 'plugins { id("com.android.application") }\nandroid { }' });
    expect(r).toMatchObject({ kind: "unsupported", android: true, label: "Android app" });
    await expect(previewRunner([{ path: "app/build.gradle.kts", content: "android { }" }, { path: "build.gradle.kts", content: "" }, { path: "gradlew", content: "" }, { path: "gradle/wrapper/gradle-wrapper.properties", content: "" }])).rejects.toThrow(HttpError);
  });

  it("requires the Gradle wrapper and picks JDK 17 for Gradle older than 8.5", async () => {
    expect(await detect({ "build.gradle": "apply plugin: 'application'" })).toMatchObject({ kind: "unsupported" });
    expect(await detect({ gradlew: "", "gradle/wrapper/gradle-wrapper.properties": "gradle-7.6-bin.zip", "build.gradle": "plugins { id 'application' }" }))
      .toMatchObject({ kind: "gradle", jdk: 17 });
  });

  it("runs Spring Boot Maven projects with the wrapper when present", async () => {
    const r = await detect({ "pom.xml": "<project><properties><java.version>17</java.version></properties><artifactId>spring-boot-starter-web</artifactId></project>", mvnw: "", ".mvn/wrapper/maven-wrapper.properties": "" });
    expect(r).toEqual({ kind: "maven", label: "Spring Boot (Maven)", goal: "spring-boot:run", jdk: 17, wrapper: true });
    if (r.kind !== "maven") throw new Error();
    expect(previewStartScript(r)).toContain("pkg java-17-amazon-corretto-devel");
    expect(previewStartScript({ ...r, wrapper: false })).toContain("apache-maven-3.9.9-bin.tar.gz");
  });

  it("prefers package.json at the root so Node projects keep their behaviour", async () => {
    expect(await detect({ "package.json": JSON.stringify({ scripts: { start: "node server.js" } }), "pubspec.yaml": "" })).toMatchObject({ kind: "node", script: "start" });
  });

  it("shows SDK-specific status messages", () => {
    expect(startingMessage("installing-sdk", "flutter-web")).toMatch(/Flutter SDK/);
    expect(startingMessage("installing-sdk", "gradle")).toMatch(/JDK/);
    expect(startingMessage("building", "flutter-web")).toMatch(/Building the Flutter/);
    expect(startingMessage("installing", "node")).toBe("Installing project dependencies…");
  });

  it("ships helper servers that are valid JavaScript", () => {
    for (const src of [PREVIEW_STATIC_SOURCE, PREVIEW_PROXY_SOURCE]) {
      expect(() => new Function(src.replace(/^import .*$/gm, ""))).not.toThrow();
    }
    expect(PREVIEW_PROXY_SOURCE).toContain('process.env.CHRONO_PROXY_ANY === "1"');
  });
});
