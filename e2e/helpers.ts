import { expect, type Page } from "@playwright/test";

export const PORT = 4100;
export const ORIGIN = `http://localhost:${PORT}`;
export const PASSWORD = "e2e-password-123";
export const USERS = {
  committee: { email: "ann@example.com", name: "Ann" },
  admin: { email: "root@example.com", name: "Root" },
};

// A valid 1x1 PNG, enough for the upload and display checks.
export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

export async function signIn(page: Page, who: keyof typeof USERS, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(USERS[who].email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Creates a published notice through the API as the signed-in user. */
export async function createNoticeViaApi(page: Page, title: string) {
  const { items } = await (await page.request.get("/api/categories")).json();
  const res = await page.request.post("/api/notices", {
    headers: { Origin: ORIGIN },
    data: { title, body: "Body of the notice.", categoryId: items[0].id, status: "published" },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).notice.id as string;
}

/** Collects anything the browser reports as a blocked resource or a page error. */
export function watchProblems(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (/content security policy|refused to|blocked/i.test(m.text())) problems.push(m.text());
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  return problems;
}
