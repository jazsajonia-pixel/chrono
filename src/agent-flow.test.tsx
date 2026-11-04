import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { rememberRepo } from "./features/github/recent";
import { SAMPLE_PATH, mockGitHub, renderApp } from "./test/github-fixture";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Live preview", () => {
  it("builds the real app — including workspace changes — into a sandboxed, opaque-origin frame", async () => {
    mockGitHub();
    renderApp(`${SAMPLE_PATH}/preview`);
    const frame = (await screen.findByTestId("preview-frame", {}, { timeout: 8000 })) as HTMLIFrameElement;
    // Never same-origin: project code can't reach this app's cookies, storage or API.
    expect(frame.getAttribute("sandbox")).toContain("allow-scripts");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
    const html = frame.getAttribute("srcdoc") ?? "";
    expect(html).toContain('"src/App.jsx"');
    expect(html).toContain("useState");
    expect(html).toContain("esm.sh/react@");
    expect(await screen.findByText(/4 modules · 2 npm packages via esm\.sh/)).toBeInTheDocument();
    expect(screen.queryByTestId("button-header-preview")).toBeNull();
  }, 15_000);

  it("lists recently opened projects to preview and what isn't supported yet", async () => {
    mockGitHub();
    rememberRepo("octo", "pocket-tasks", "main");
    renderApp("/app/preview");
    expect(await screen.findByTestId("link-preview-octo-pocket-tasks")).toHaveAttribute("href", expect.stringContaining(`${SAMPLE_PATH}/preview`));
    expect(screen.getByText(/Not supported yet/)).toBeInTheDocument();
  });

  it("explains how to get a project into the list when none were opened", async () => {
    mockGitHub();
    renderApp("/app/preview");
    expect(await screen.findByTestId("text-preview-empty")).toBeInTheDocument();
  });
});
