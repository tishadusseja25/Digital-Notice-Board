import { Notice } from "../src/models/Notice.js";
import {
  clearTestDb,
  connectTestDb,
  createCategory,
  createUser,
  disconnectTestDb,
  makeAgent,
} from "./helpers.js";

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

describe("public board: GET /api/notices", () => {
  let categoryId: string;
  let otherCategoryId: string;
  let authorId: string;

  const make = (title: string, extra: Record<string, unknown> = {}) =>
    Notice.create({
      title,
      body: `Body of ${title}`,
      categoryId,
      authorId,
      status: "published",
      publishedAt: new Date(),
      ...extra,
    });
  const titles = (res: { body: { items: Array<{ title: string }> } }) =>
    res.body.items.map((n) => n.title);
  const list = (query = "") => makeAgent().get(`/api/notices${query}`);

  beforeAll(connectTestDb);
  beforeEach(async () => {
    categoryId = (await createCategory("General")).id;
    otherCategoryId = (await createCategory("Exams")).id;
    authorId = (await createUser("ann@example.com")).id;
  });
  afterEach(clearTestDb);
  afterAll(disconnectTestDb);

  it("needs no sign-in and shows newest first, without author or status", async () => {
    await make("old", { publishedAt: daysAgo(3) });
    await make("new", { publishedAt: daysAgo(1) });
    await make("middle", { publishedAt: daysAgo(2) });
    const res = await list();
    expect(res.status).toBe(200);
    expect(titles(res)).toEqual(["new", "middle", "old"]);
    expect(res.body).toMatchObject({ page: 1, limit: 20, total: 3 });
    expect(res.body.items[0]).not.toHaveProperty("authorId");
    expect(res.body.items[0]).not.toHaveProperty("status");
    expect(res.body.items[0].category).toMatchObject({ name: "General" });
  });

  it("puts pinned notices first", async () => {
    await make("newest", { publishedAt: daysAgo(0) });
    await make("pinned but old", { publishedAt: daysAgo(30), pinned: true });
    expect(titles(await list())).toEqual(["pinned but old", "newest"]);
  });

  it("hides drafts, archived and expired notices, keeps ones that expire later", async () => {
    await make("visible");
    await make("expires later", { expiresAt: new Date(Date.now() + DAY) });
    await make("draft", { status: "draft" });
    await make("archived", { status: "archived" });
    await make("expired", { expiresAt: new Date(Date.now() - 1000) });
    const res = await list();
    expect(titles(res).sort()).toEqual(["expires later", "visible"]);
    expect(res.body.total).toBe(2);
  });

  it("filters by category", async () => {
    await make("a");
    await make("b", { categoryId: otherCategoryId });
    expect(titles(await list(`?category=${otherCategoryId}`))).toEqual(["b"]);
    expect((await list("?category=nope")).status).toBe(400);
  });

  it("filters by date range, inclusive of the whole 'to' day", async () => {
    await make("early", { publishedAt: new Date("2026-01-05T08:00:00Z") });
    await make("late on the last day", { publishedAt: new Date("2026-01-10T23:30:00Z") });
    await make("after", { publishedAt: new Date("2026-01-11T00:30:00Z") });
    expect(titles(await list("?from=2026-01-06&to=2026-01-10"))).toEqual(["late on the last day"]);
    expect(titles(await list("?from=2026-01-06"))).toEqual(["after", "late on the last day"]);
    expect(titles(await list("?to=2026-01-05"))).toEqual(["early"]);
    expect((await list("?from=2026-01-10&to=2026-01-01")).status).toBe(400);
    expect((await list("?from=yesterday")).status).toBe(400);
    expect((await list("?from=2026-13-45")).status).toBe(400);
  });

  it("pages results and caps the page size", async () => {
    for (let i = 0; i < 25; i++) await make(`n${i}`, { publishedAt: daysAgo(i) });
    const first = await list();
    expect(first.body.items).toHaveLength(20);
    expect(first.body.total).toBe(25);
    expect((await list("?page=2")).body.items).toHaveLength(5);
    expect((await list("?limit=50")).body.items).toHaveLength(25);
    expect((await list("?limit=51")).status).toBe(400);
    expect((await list("?page=0")).status).toBe(400);
    expect((await list("?page=abc")).status).toBe(400);
  });

  it("rejects unknown query parameters", async () => {
    expect((await list("?status=draft")).status).toBe(400);
  });

  describe("search", () => {
    beforeEach(async () => {
      await make("Exam timetable", { body: "Mid semester exams begin on Monday" });
      await make("Placement drive", { body: "Companies visit the campus next week" });
      await make("Hidden exam draft", { status: "draft", body: "exam secrets" });
    });

    it("finds words in the title and the body", async () => {
      expect(titles(await list("?q=timetable"))).toEqual(["Exam timetable"]);
      expect(titles(await list("?q=campus"))).toEqual(["Placement drive"]);
      expect((await list("?q=nothingmatchesthis")).body.total).toBe(0);
    });

    it("never returns notices the public may not see", async () => {
      expect(titles(await list("?q=exam"))).toEqual(["Exam timetable"]);
    });

    it("combines search with filters", async () => {
      expect(titles(await list(`?q=exam&category=${categoryId}`))).toEqual(["Exam timetable"]);
      expect((await list(`?q=exam&category=${otherCategoryId}`)).body.total).toBe(0);
    });

    it("treats injection-looking text as plain words, never as a query", async () => {
      const attacks = [
        '{"$ne":null}',
        "'; DROP TABLE notices; --",
        "$where: sleep(5000)",
        "<script>alert(1)</script>",
        '" OR "1"="1',
        "-exam",
        "\\",
        "x".repeat(100),
      ];
      for (const attack of attacks) {
        const res = await list(`?q=${encodeURIComponent(attack)}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.items)).toBe(true);
      }
      // Nothing was damaged by any of them.
      expect(await Notice.countDocuments()).toBe(3);
      // An operator object in the query string is refused outright.
      expect((await list("?q[$ne]=1")).status).toBe(400);
      expect((await list("?q[$regex]=.*")).status).toBe(400);
      expect((await list("?category[$ne]=x")).status).toBe(400);
      // Too long or empty search text is a validation error.
      expect((await list(`?q=${"x".repeat(101)}`)).status).toBe(400);
      expect((await list("?q=")).status).toBe(400);
    });
  });
});
