import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { AppRoutes } from "./App";
import { SessionProvider } from "./stores/session";
import { ThemeProvider } from "./stores/theme";

function renderAt(path: string) {
  const loc = memoryLocation({ path, record: true });
  render(
    <ThemeProvider>
      <SessionProvider initial={{ mode: "anonymous" }}>
        <Router hook={loc.hook}>
          <AppRoutes />
        </Router>
      </SessionProvider>
    </ThemeProvider>,
  );
  return loc;
}

describe("routing", () => {
  it("renders the landing page", () => {
    renderAt("/");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/Build, preview and ship your GitHub projects from anywhere\./);
    expect(screen.getByTestId("button-start-building")).toBeInTheDocument();
  });

  it("landing section links scroll on the page instead of changing the route", () => {
    const loc = renderAt("/");
    const scroll = vi.fn();
    const target = document.getElementById("workflow")!;
    target.scrollIntoView = scroll;
    fireEvent.click(screen.getByTestId("link-how-it-works"));
    expect(scroll).toHaveBeenCalled();
    expect(document.activeElement).toBe(target);
    expect(loc.history?.at(-1)).toBe("/");
  });

  it("redirects anonymous users away from protected routes", () => {
    const loc = renderAt("/app/settings");
    expect(loc.history?.at(-1)).toBe("/signin");
  });

  it("does not expose a public demo entry point", () => {
    renderAt("/");
    expect(screen.queryByTestId("button-try-demo")).not.toBeInTheDocument();
  });
});
