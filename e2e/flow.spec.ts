import { expect, test } from "@playwright/test";
import { PASSWORD, PNG, createNoticeViaApi, signIn, watchProblems } from "./helpers";

// One shared server and database; the tests build on each other in order.
test.describe.configure({ mode: "serial" });

test("a committee member posts and edits a notice, and an open viewer window follows live", async ({
  browser,
}) => {
  // The viewer opens the board first and never reloads it.
  const viewerPage = await (await browser.newContext()).newPage();
  const problems = watchProblems(viewerPage);
  await viewerPage.goto("/");
  await expect(viewerPage.getByRole("heading", { name: "Latest notices" })).toBeVisible();
  await expect(viewerPage.getByText("Live", { exact: true })).toBeVisible();

  const page = await (await browser.newContext()).newPage();
  watchProblems(page);
  await signIn(page, "committee");
  await expect(page).toHaveURL(/\/committee$/);

  await page.getByRole("link", { name: "New notice" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Exam timetable");
  await page.getByLabel("Text", { exact: true }).fill("The mid-semester exams start on Monday.");
  await page.getByLabel("Category", { exact: true }).selectOption({ label: "Exams" });
  await page.getByLabel("Status", { exact: true }).selectOption("published");
  await page.getByLabel("Image description (alt text)").fill("Timetable picture");
  await page
    .getByLabel("Choose image")
    .setInputFiles({ name: "timetable.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByRole("button", { name: "Create notice" })).toBeEnabled();
  await page.getByRole("button", { name: "Create notice" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  // Live: appears in the viewer's window without a reload, and the image really loads.
  await expect(viewerPage.getByRole("heading", { name: "Exam timetable" })).toBeVisible();
  const image = viewerPage.getByRole("img", { name: "Timetable picture" });
  await expect(image).toBeVisible();
  expect(await image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);

  // Search works on the live board.
  await viewerPage.getByLabel("Search").fill("zzz-no-such-text");
  await viewerPage.getByRole("button", { name: "Search", exact: true }).click();
  await expect(viewerPage.getByText("No notices match.")).toBeVisible();
  await viewerPage.getByLabel("Search").fill("timetable");
  await viewerPage.getByRole("button", { name: "Search", exact: true }).click();
  await expect(viewerPage.getByRole("heading", { name: "Exam timetable" })).toBeVisible();

  // Edit: the new title reaches the viewer.
  // The shared database may hold other notices from earlier tests, so work inside this notice's row.
  const row = page.getByRole("listitem").filter({ hasText: "Exam timetable" });
  await row.getByRole("link", { name: "Edit" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Exam timetable (updated)");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await expect(viewerPage.getByRole("heading", { name: "Exam timetable (updated)" })).toBeVisible();

  // The viewer opens the notice, then it is archived while being read.
  await viewerPage.getByRole("link", { name: "Exam timetable (updated)" }).click();
  await expect(viewerPage.getByRole("heading", { name: "Exam timetable (updated)" })).toBeVisible();
  const updatedRow = page.getByRole("listitem").filter({ hasText: "Exam timetable (updated)" });
  await updatedRow.getByRole("button", { name: "Archive" }).click();
  await updatedRow.getByRole("button", { name: "Confirm archive" }).click();
  await expect(
    viewerPage.getByRole("heading", { name: "This notice is no longer available" }),
  ).toBeVisible();

  expect(problems).toEqual([]);
});

test("pages for staff are protected, on the screen and in the API", async ({
  browser,
  request,
}) => {
  const anonymous = await (await browser.newContext()).newPage();
  for (const path of ["/admin", "/admin/users", "/committee", "/committee/new"]) {
    await anonymous.goto(path);
    await expect(anonymous).toHaveURL(/\/login$/);
  }

  // Direct API calls without a login are refused.
  expect((await request.get("/api/users")).status()).toBe(401);
  expect((await request.get("/api/audit")).status()).toBe(401);
  expect((await request.get("/api/me/notices")).status()).toBe(401);

  const staff = await (await browser.newContext()).newPage();
  await signIn(staff, "committee");
  await expect(staff).toHaveURL(/\/committee$/);
  await staff.goto("/admin");
  await expect(staff.getByRole("heading", { name: /403/ })).toBeVisible();
  expect((await staff.request.get("/api/users")).status()).toBe(403);
});

test("a wrong password shows a message and does not sign in", async ({ page }) => {
  await signIn(page, "committee", PASSWORD + "-wrong");
  await expect(page.getByRole("alert")).toHaveText("Invalid email or password.");
  await expect(page).toHaveURL(/\/login$/);
});

test("an admin pins a notice and finds the actions in the audit log", async ({ page }) => {
  await signIn(page, "admin");
  await expect(page).toHaveURL(/\/admin$/);
  const title = "Library hours";
  await createNoticeViaApi(page, title);

  await page.goto("/committee");
  const row = page.getByRole("listitem").filter({ hasText: title });
  await row.getByRole("button", { name: "Pin" }).click();
  await expect(row.getByText("Pinned")).toBeVisible();

  await page.goto("/admin/audit");
  const table = page.getByRole("table", { name: "Audit log entries" });
  await expect(table.getByText("notice.pin")).toBeVisible();
  await expect(table.getByText("notice.create").first()).toBeVisible();
  await expect(table.getByText("login.success").first()).toBeVisible();
});
