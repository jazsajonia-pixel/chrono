import { describe, expect, it } from "vitest";
import { analyzeProject } from "./detect";
import { previewEnvNameProblem } from "./use-preview-env";

const reader = (files: Record<string, string>) => (p: string) => Promise.resolve(files[p] ?? null);

describe("analyzeProject for non-Node projects", () => {
  it("routes a Flutter app to the live server", async () => {
    const files = { "pubspec.yaml": "name: demo\ndependencies:\n  flutter:\n    sdk: flutter\n", "lib/main.dart": "void main() {}" };
    const plan = await analyzeProject(Object.keys(files), reader(files));
    expect(plan.supported).toBe(false);
    if (plan.supported) return;
    expect(plan.liveServer).toBe(true);
    expect(plan.live?.kind).toBe("flutter-web");
  });

  it("marks an Android-only Gradle project as not runnable but installable", async () => {
    const files = {
      "settings.gradle.kts": 'include(":app")',
      "gradlew": "#!/bin/sh",
      "gradle/wrapper/gradle-wrapper.properties": "distributionUrl=https\\://services.gradle.org/distributions/gradle-8.9-bin.zip",
      "app/build.gradle.kts": 'plugins { id("com.android.application") }',
    };
    const plan = await analyzeProject(Object.keys(files), reader(files));
    if (plan.supported) throw new Error("expected unsupported");
    expect(plan.liveServer).toBe(false);
    expect(plan.live?.kind === "unsupported" && plan.live.android).toBe(true);
  });

  it("keeps package.json projects on the browser path", async () => {
    const files = { "package.json": '{"dependencies":{}}', "index.html": "<p>hi</p>", "pubspec.yaml": "name: x" };
    const plan = await analyzeProject(Object.keys(files), reader(files));
    expect(plan.supported).toBe(true);
  });
});

describe("previewEnvNameProblem", () => {
  it("accepts normal names and rejects reserved or malformed ones", () => {
    expect(previewEnvNameProblem("DATABASE_URL")).toBeNull();
    expect(previewEnvNameProblem("PORT")).toMatch(/set by the preview/);
    expect(previewEnvNameProblem("VERCEL_TOKEN")).toMatch(/set by the preview/);
    expect(previewEnvNameProblem("1BAD")).toMatch(/digit/);
  });
});
