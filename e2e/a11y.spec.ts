import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createNoticeViaApi, signIn, watchProblems } from "./helpers";

// WCAG 2.1 A and AA rules (PRD Section 7). Automatic checks find only part of the problems;
// keyboard and screen-reader testing by hand is still needed (see the README).
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function scan(page: Page, path: string, heading: RegExp | string) {
  const problems = watchProblems(page);
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = violations.map(
    (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target).join(" | ")}`,
  );
  expect(summary, `accessibility problems on ${path}`).toEqual([]);
  expect(problems, `browser problems on ${path}`).toEqual([]);
}

test.describe.configure({ mode: "serial" });

test("public pages", async ({ page }) => {
  await signIn(page, "committee");
  const id = await createNoticeViaApi(page, "Accessibility check notice");
  await page.context().clearCookies();

  await scan(page, "/", "Latest notices");
  await scan(page, `/notices/${id}`, "Accessibility check notice");
  await scan(page, "/login", "Sign in");
  await scan(page, "/definitely-not-a-page", /not found/i);
});

test("committee pages", async ({ page }) => {
  await signIn(page, "committee");
  await expect(page).toHaveURL(/\/committee$/);
  await scan(page, "/committee", "My notices");
  await scan(page, "/committee/new", "New notice");
  await scan(page, "/account/password", /password/i);
});

test("admin pages", async ({ page }) => {
  await signIn(page, "admin");
  await expect(page).toHaveURL(/\/admin$/);
  await scan(page, "/admin", "Admin area");
  await scan(page, "/admin/users", /users/i);
  await scan(page, "/admin/categories", /categories/i);
  await scan(page, "/admin/audit", /audit/i);
});
