import { expect, test, type Page } from "@playwright/test";
import { E2E_PORTS } from "../playwright.config";
import { expectNoHorizontalOverflow, gotoTab, openRepo, signInWithGitHub } from "./helpers";

// QA_THEME=light renders the screenshots in the light theme.
test.beforeEach(async ({ page }) => {
  if (process.env.QA_THEME === "light") await page.addInitScript(() => localStorage.setItem("mdai:theme", "light"));
});

/** Optional screenshots for visual review: QA_SHOTS=dir npm run e2e -- knowledge */
async function shot(page: Page, name: string) {
  const dir = process.env.QA_SHOTS;
  await page.waitForTimeout(dir ? 400 : 0); // let sheets finish animating
  if (dir) await page.screenshot({ path: `${dir}/${test.info().project.name}-${name}.png`, fullPage: false });
}

test("write, search and delete knowledge notes; secrets are refused", async ({ page }) => {
  await signInWithGitHub(page);
  await page.goto("/#/app/settings");
  await page.getByTestId("link-settings-knowledge").click();
  await expect(page.getByTestId("empty-knowledge")).toBeVisible();
  await shot(page, "knowledge-empty");

  await page.getByTestId("button-add-first-note").click();
  await page.getByTestId("input-note-title").fill("Package manager");
  await page.getByTestId("input-note-body").fill("Use pnpm, not npm. Lockfile is pnpm-lock.yaml.");
  await shot(page, "note-editor");
  await page.getByTestId("button-save-note").click();
  await expect(page.getByTestId("list-knowledge-global")).toContainText("Package manager");

  await page.getByTestId("button-add-note").click();
  await page.getByTestId("radio-note-repo").click();
  await page.getByTestId("input-note-repo").fill("octo-dev/hello-mobile");
  await page.getByTestId("input-note-title").fill("Database");
  await page.getByTestId("input-note-body").fill("postgres://app:hunter22@db.example.com/app");
  await page.getByTestId("button-save-note").click();
  await expect(page.getByTestId("text-note-error")).toBeVisible();
  await shot(page, "note-secret");
  await page.getByTestId("input-note-body").fill("Errors return { error: { code, message } }.");
  await page.getByTestId("button-save-note").click();
  await expect(page.getByTestId("list-knowledge-project:octo-dev/hello-mobile")).toContainText("Database");
  await expectNoHorizontalOverflow(page);
  await shot(page, "knowledge-list");

  // Saved locally: survives a reload.
  await page.reload();
  await expect(page.getByTestId("list-knowledge-global")).toContainText("Package manager");
  await page.getByTestId("input-knowledge-search").fill("errors");
  await expect(page.getByTestId("list-knowledge-global")).toHaveCount(0);
  await expect(page.locator("body")).toContainText("Database");
  await page.getByTestId("input-knowledge-search").fill("");

  await page.getByRole("button", { name: "Delete Database" }).click();
  await page.getByRole("button", { name: "Delete note" }).click();
  await expect(page.locator("body")).not.toContainText("Errors return");
});

test("the agent saves to knowledge automatically and the save can be undone", async ({ page }) => {
  await signInWithGitHub(page);
  await page.goto("/#/app/settings/ai");
  const list = page.getByTestId("list-providers");
  if (!(await list.isVisible().catch(() => false)) || !(await list.textContent())?.includes("Mock coder")) {
    await page.getByTestId("button-add-first-provider").or(page.getByTestId("button-add-provider")).first().click();
    await page.getByTestId("radio-kind-openai-compatible").click();
    await page.getByTestId("input-base-url").fill(`http://127.0.0.1:${E2E_PORTS.ai}/v1`);
    await page.getByTestId("input-api-key").fill("sk-mock-e2e-key-123456");
    await page.getByTestId("input-model").fill("mock-coder-1");
    await page.getByTestId("input-label").fill("Mock coder");
    await page.getByTestId("button-save-provider").click();
    await expect(list).toContainText("Mock coder");
  }

  await page.goto("/#/app/projects");
  await openRepo(page);
  await gotoTab(page, "AI");
  await page.getByTestId("input-agent-message").fill("Remember that this repo uses pnpm");
  await page.getByTestId("button-send-agent").click();
  const row = page.getByTestId("tool-save_knowledge");
  await expect(row).toContainText("Package manager", { timeout: 30_000 });
  await expect(page.locator("body")).toContainText("Saved that to your knowledge base", { timeout: 30_000 });
  await shot(page, "agent-saved");

  await page.goto("/#/app/knowledge");
  await expect(page.getByTestId("list-knowledge-project:octo-dev/hello-mobile")).toContainText("Package manager");
  await expect(page.getByTestId("list-knowledge-project:octo-dev/hello-mobile")).toContainText("agent");
  await shot(page, "knowledge-agent");

  await page.goBack();
  await page.getByTestId("undo-save-knowledge").click();
  await expect(row).toContainText("Undone");
  await page.goto("/#/app/knowledge");
  await expect(page.getByTestId("list-knowledge-project:octo-dev/hello-mobile")).toHaveCount(0);
});
