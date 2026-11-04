import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
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
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/Edit, preview and ship your GitHub repos from your phone\./);
    expect(screen.getByTestId("button-start-building")).toBeInTheDocument();
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
