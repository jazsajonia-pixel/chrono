import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { UpdatePrompt, newerDeployAvailable } from "./components/update-prompt";

const health = (commit: string | null) =>
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, commit }), { status: 200 })));

afterEach(() => vi.unstubAllGlobals());

describe("update prompt", () => {
  it("detects a different deployed commit, and ignores unknown builds", async () => {
    health("bbbbbbb");
    expect(await newerDeployAvailable("aaaaaaa")).toBe(true);
    expect(await newerDeployAvailable("bbbbbbb")).toBe(false);
    expect(await newerDeployAvailable("")).toBe(false);
    health(null);
    expect(await newerDeployAvailable("aaaaaaa")).toBe(false);
  });

  it("offers a reload when the tab returns after a deploy", async () => {
    health("bbbbbbb");
    render(<UpdatePrompt current="aaaaaaa" />);
    expect(screen.queryByTestId("banner-update-available")).toBeNull();
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(await screen.findByTestId("button-update-reload")).toBeInTheDocument();
  });
});
