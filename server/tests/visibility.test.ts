import { isObjectId } from "../src/lib/objectId.js";
import { isPubliclyVisible, publicNoticeFilter } from "../src/lib/visibility.js";
import { Notice } from "../src/models/Notice.js";
import {
  clearTestDb,
  connectTestDb,
  createCategory,
  createUser,
  disconnectTestDb,
} from "./helpers.js";

const HOUR = 3_600_000;

describe("public visibility rule", () => {
  beforeAll(connectTestDb);
  afterEach(clearTestDb);
  afterAll(disconnectTestDb);

  it("matches published notices without or before expiry, and nothing else", async () => {
    const [category, author] = await Promise.all([createCategory(), createUser("a@example.com")]);
    const make = (title: string, status: string, expiresAt: Date | null = null) =>
      Notice.create({
        title,
        body: "body",
        categoryId: category._id,
        authorId: author._id,
        status,
        expiresAt,
      });

    await make("published, no expiry", "published");
    await make("published, expires later", "published", new Date(Date.now() + HOUR));
    await make("published, expired", "published", new Date(Date.now() - HOUR));
    await make("draft", "draft");
    await make("archived", "archived");

    const titles = (await Notice.find(publicNoticeFilter()).sort({ title: 1 })).map((n) => n.title);
    expect(titles).toEqual(["published, expires later", "published, no expiry"]);
  });

  it("gives the same answer for a notice already in memory", () => {
    const future = new Date(Date.now() + HOUR);
    const past = new Date(Date.now() - HOUR);
    expect(isPubliclyVisible({ status: "published", expiresAt: null })).toBe(true);
    expect(isPubliclyVisible({ status: "published", expiresAt: future })).toBe(true);
    expect(isPubliclyVisible({ status: "published", expiresAt: past })).toBe(false);
    expect(isPubliclyVisible({ status: "draft", expiresAt: null })).toBe(false);
    expect(isPubliclyVisible({ status: "archived", expiresAt: future })).toBe(false);
  });
});

describe("isObjectId", () => {
  it("accepts 24 hex characters only", () => {
    expect(isObjectId("507f1f77bcf86cd799439011")).toBe(true);
    for (const bad of ["", "123", "507f1f77bcf86cd79943901z", { $ne: 1 }, null, undefined]) {
      expect(isObjectId(bad)).toBe(false);
    }
  });
});
