import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { SAMPLE_PATH, mockGitHub, renderApp } from "./test/github-fixture";

function renderDemo(path = SAMPLE_PATH) {
  return renderApp(path).loc;
}

beforeEach(() => {
  mockGitHub();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

async function editorView(): Promise<EditorView> {
  const el = await waitFor(() => {
    const e = document.querySelector(".cm-editor");
    if (!e) throw new Error("no editor yet");
    return e as HTMLElement;
  });
  return EditorView.findFromDOM(el)!;
}

function type(view: EditorView, text: string, at = 0) {
  act(() => view.dispatch({ changes: { from: at, insert: text }, userEvent: "input.type" }));
}

describe("mobile editor", () => {
  it("edits, marks unsaved, saves, shows the diff, and discards", async () => {
    const loc = renderDemo();
    fireEvent.click(await screen.findByText("README.md", {}, { timeout: 5000 }));
    const view = await editorView();
    expect(view.state.doc.toString()).toContain("Pocket Tasks");

    type(view, "Hello phone\n");
    await waitFor(() => expect(screen.getByTestId("tab-file-README.md").querySelector('[aria-label="unsaved"]')).not.toBeNull());
    expect(screen.getByTestId("button-undo")).toBeEnabled();

    fireEvent.click(screen.getByTestId("button-save"));
    expect(await screen.findByTestId("toast")).toHaveTextContent("Saved to workspace");
    await waitFor(() => expect(screen.getByTestId("tab-file-README.md").querySelector('[aria-label="unsaved"]')).toBeNull());
    expect(screen.getByTestId("badge-changes")).toHaveTextContent("1");

    fireEvent.click(screen.getByTestId("tab-git"));
    expect(loc.history?.at(-1)).toBe(`${SAMPLE_PATH}/git`);
    const row = await screen.findByTestId("change-README.md");
    expect(row).toHaveTextContent("+1");
    fireEvent.click(within(row).getByRole("button", { expanded: false }));
    expect(screen.getByTestId("diff-README.md")).toHaveTextContent("Hello phone");

    fireEvent.click(screen.getByTestId("button-discard-README.md"));
    fireEvent.click(await screen.findByTestId("button-confirm"));
    expect(await screen.findByText("Working tree clean")).toBeInTheDocument();
  });

  it("keeps the preview mounted when switching to AI chat in the same project", async () => {
    const loc = renderDemo(`${SAMPLE_PATH}/preview`);
    const frame = await screen.findByTestId("preview-frame", {}, { timeout: 10000 });
    fireEvent.click(await screen.findByTestId("tab-ai"));
    await waitFor(() => expect(loc.history?.at(-1)).toBe(`${SAMPLE_PATH}/ai`));
    expect(screen.getByTestId("preview-frame")).toBe(frame);
    expect(screen.getByTestId("preview-panel").parentElement).toHaveClass("hidden");
  });
  it("undo / redo through the action bar", async () => {
    renderDemo();
    fireEvent.click(await screen.findByText("README.md", {}, { timeout: 5000 }));
    const view = await editorView();
    const original = view.state.doc.toString();
    type(view, "zzz");
    fireEvent.click(screen.getByTestId("button-undo"));
    expect(view.state.doc.toString()).toBe(original);
    fireEvent.click(screen.getByTestId("button-redo"));
    expect(view.state.doc.toString().startsWith("zzz")).toBe(true);
  });

  it("find and replace all", async () => {
    renderDemo();
    fireEvent.click(await screen.findByText("README.md", {}, { timeout: 5000 }));
    const view = await editorView();
    act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "cat dog cat\ncat" } }));
    fireEvent.click(screen.getByTestId("button-find"));
    fireEvent.change(screen.getByTestId("input-find"), { target: { value: "cat" } });
    await waitFor(() => expect(screen.getByTestId("text-find-count")).toHaveTextContent("3"));
    fireEvent.click(screen.getByLabelText("Show replace"));
    fireEvent.change(screen.getByTestId("input-replace"), { target: { value: "fox" } });
    fireEvent.click(screen.getByTestId("button-replace-all"));
    expect(view.state.doc.toString()).toBe("fox dog fox\nfox");
    expect(screen.getByTestId("text-find-count")).toHaveTextContent("No results");
  });

  it("creates, renames and deletes files with validation", async () => {
    renderDemo();
    fireEvent.click(await screen.findByTestId("button-new-file"));
    fireEvent.change(await screen.findByTestId("input-sheet"), { target: { value: "../evil.js" } });
    fireEvent.click(screen.getByTestId("button-sheet-submit"));
    expect(await screen.findByTestId("text-sheet-error")).toHaveTextContent("can't contain . or ..");

    fireEvent.change(screen.getByTestId("input-sheet"), { target: { value: "src/new.js" } });
    fireEvent.click(screen.getByTestId("button-sheet-submit"));
    await waitFor(() => expect(screen.getByTestId("text-open-path")).toHaveTextContent("src/new.js"));

    fireEvent.click(screen.getByTestId("button-more"));
    fireEvent.click(await screen.findByTestId("menu-rename"));
    fireEvent.change(await screen.findByTestId("input-sheet"), { target: { value: "src/renamed.js" } });
    fireEvent.click(screen.getByTestId("button-sheet-submit"));
    await waitFor(() => expect(screen.getByTestId("text-open-path")).toHaveTextContent("src/renamed.js"));

    fireEvent.click(screen.getByTestId("button-more"));
    fireEvent.click(await screen.findByTestId("menu-delete"));
    fireEvent.click(await screen.findByTestId("button-confirm"));
    // Back to the tree; the added file is gone entirely (nothing to commit).
    expect(await screen.findByTestId("button-new-file")).toBeInTheDocument();
    expect(screen.queryByTestId("badge-changes")).toBeNull();
  });

  it("keeps unsaved drafts across a reload", async () => {
    renderDemo();
    fireEvent.click(await screen.findByText("README.md", {}, { timeout: 5000 }));
    const view = await editorView();
    type(view, "draft!");
    await waitFor(() => expect(screen.getByTestId("tab-file-README.md").querySelector('[aria-label="unsaved"]')).not.toBeNull());
    cleanup(); // unmount flushes the workspace to storage

    renderDemo();
    const view2 = await editorView();
    expect(view2.state.doc.toString().startsWith("draft!")).toBe(true);
    expect(screen.getByTestId("tab-file-README.md").querySelector('[aria-label="unsaved"]')).not.toBeNull();
  });

  it("searches across files and jumps to the match", async () => {
    renderDemo();
    fireEvent.click(await screen.findByTestId("button-search-files"));
    fireEvent.change(screen.getByTestId("input-project-search"), { target: { value: "TaskItem" } });
    // Files are only loaded on demand — load them, then search.
    fireEvent.click(await screen.findByTestId("button-load-all"));
    const results = await screen.findByTestId("list-search-results");
    expect(results).toHaveTextContent("src/App.jsx");
    fireEvent.click(within(results).getAllByRole("button")[0]!);
    const view = await editorView();
    await waitFor(() => expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toContain("TaskItem"));
  });
});
