import request from "supertest";
import { createApp } from "../src/app.js";
import { AuditLog } from "../src/models/AuditLog.js";
import { Notice } from "../src/models/Notice.js";
import {
  clearTestDb,
  connectTestDb,
  createCategory,
  disconnectTestDb,
  makeAgent,
  noticeBody,
  signedIn,
  testEnv,
} from "./helpers.js";

const HOUR = 3_600_000;
const anon = () => makeAgent();

describe("notices API", () => {
  let categoryId: string;

  beforeAll(connectTestDb);
  beforeEach(async () => {
    categoryId = (await createCategory()).id;
  });
  afterEach(clearTestDb);
  afterAll(disconnectTestDb);

  describe("POST /api/notices", () => {
    it("needs a signed-in committee member or admin", async () => {
      expect((await anon().post("/api/notices").send(noticeBody(categoryId))).status).toBe(401);
    });

    it("creates a published notice with timestamps, author and category", async () => {
      const { agent, user } = await signedIn("ann@example.com");
      const res = await agent.post("/api/notices").send(noticeBody(categoryId));
      expect(res.status).toBe(201);
      expect(res.body.notice).toMatchObject({
        title: "Exam timetable",
        status: "published",
        authorId: user.id,
        category: { id: categoryId, name: "General" },
        pinned: false,
        images: [],
      });
      expect(res.body.notice.publishedAt).toBeTruthy();
      expect(res.body.notice.createdAt).toBeTruthy();
    });

    it("defaults to draft with no publish time", async () => {
      const { agent } = await signedIn("ann@example.com");
      const withoutStatus: Record<string, unknown> = noticeBody(categoryId);
      delete withoutStatus.status;
      const res = await agent.post("/api/notices").send(withoutStatus);
      expect(res.body.notice.status).toBe("draft");
      expect(res.body.notice.publishedAt).toBeNull();
    });

    it("rejects bad input with field errors", async () => {
      const { agent } = await signedIn("ann@example.com");
      const post = (extra: Record<string, unknown>) =>
        agent.post("/api/notices").send(noticeBody(categoryId, extra));

      const empty = await post({ title: "  ", body: "" });
      expect(empty.status).toBe(400);
      expect(Object.keys(empty.body.error.fields)).toEqual(
        expect.arrayContaining(["title", "body"]),
      );
      expect((await post({ title: "x".repeat(121) })).status).toBe(400);
      expect((await post({ body: "x".repeat(5001) })).status).toBe(400);
      expect(
        (await post({ categoryId: "507f1f77bcf86cd799439011" })).body.error.fields.categoryId,
      ).toBeTruthy();
      expect((await post({ categoryId: "nope" })).status).toBe(400);
      expect((await post({ status: "deleted" })).status).toBe(400);
      expect((await post({ expiresAt: new Date(Date.now() - HOUR).toISOString() })).status).toBe(
        400,
      );
      expect((await post({ expiresAt: "tomorrow" })).status).toBe(400);
    });

    it("refuses fields the client must not set and operator objects", async () => {
      const { agent } = await signedIn("ann@example.com");
      const post = (extra: Record<string, unknown>) =>
        agent.post("/api/notices").send(noticeBody(categoryId, extra));
      expect((await post({ authorId: "507f1f77bcf86cd799439011" })).status).toBe(400);
      expect((await post({ pinned: true })).status).toBe(400);
      expect((await post({ title: { $ne: null } })).status).toBe(400);
    });

    it("stores injection-looking text as plain text", async () => {
      const { agent } = await signedIn("ann@example.com");
      const title = `'; DROP TABLE notices; -- <script>alert(1)</script>`;
      const res = await agent.post("/api/notices").send(noticeBody(categoryId, { title }));
      expect(res.status).toBe(201);
      expect(res.body.notice.title).toBe(title);
    });
  });

  describe("GET /api/notices/:id", () => {
    const create = async (agent: Awaited<ReturnType<typeof signedIn>>["agent"], extra = {}) =>
      (await agent.post("/api/notices").send(noticeBody(categoryId, extra))).body.notice
        .id as string;

    it("shows a published notice to anyone, without author or status", async () => {
      const { agent } = await signedIn("ann@example.com");
      const id = await create(agent);
      const res = await anon().get(`/api/notices/${id}`);
      expect(res.status).toBe(200);
      expect(res.body.notice.title).toBe("Exam timetable");
      expect(res.body.notice).not.toHaveProperty("authorId");
      expect(res.body.notice).not.toHaveProperty("status");
    });

    it("hides drafts, archived and expired notices from the public and other committee members", async () => {
      const ann = await signedIn("ann@example.com");
      const ben = await signedIn("ben@example.com");
      const draft = await create(ann.agent, { status: "draft" });
      const archived = await create(ann.agent, { status: "archived" });
      const expired = await create(ann.agent);
      await Notice.updateOne({ _id: expired }, { expiresAt: new Date(Date.now() - HOUR) });

      for (const id of [draft, archived, expired]) {
        expect((await anon().get(`/api/notices/${id}`)).status).toBe(404);
        expect((await ben.agent.get(`/api/notices/${id}`)).status).toBe(404);
        const own = await ann.agent.get(`/api/notices/${id}`);
        expect(own.status).toBe(200);
        expect(own.body.notice).toHaveProperty("status");
      }
    });

    it("lets an admin read any notice and returns 404 for unknown or malformed ids", async () => {
      const ann = await signedIn("ann@example.com");
      const admin = await signedIn("root@example.com", "admin");
      const draft = await create(ann.agent, { status: "draft" });
      expect((await admin.agent.get(`/api/notices/${draft}`)).status).toBe(200);
      expect((await anon().get("/api/notices/507f1f77bcf86cd799439011")).status).toBe(404);
      expect((await anon().get("/api/notices/not-an-id")).status).toBe(404);
    });
  });

  describe("PATCH /api/notices/:id", () => {
    it("lets the author edit; createdAt stays, updatedAt moves, publishedAt is set only once", async () => {
      const { agent } = await signedIn("ann@example.com");
      const created = (
        await agent.post("/api/notices").send(noticeBody(categoryId, { status: "draft" }))
      ).body.notice;
      await new Promise((r) => setTimeout(r, 15));

      const edited = await agent.patch(`/api/notices/${created.id}`).send({ title: "New title" });
      expect(edited.status).toBe(200);
      expect(edited.body.notice.title).toBe("New title");
      expect(edited.body.notice.createdAt).toBe(created.createdAt);
      expect(new Date(edited.body.notice.updatedAt).getTime()).toBeGreaterThan(
        new Date(created.updatedAt).getTime(),
      );
      expect(edited.body.notice.publishedAt).toBeNull();

      const published = (
        await agent.patch(`/api/notices/${created.id}`).send({ status: "published" })
      ).body.notice;
      expect(published.publishedAt).toBeTruthy();
      await agent.patch(`/api/notices/${created.id}`).send({ status: "archived" });
      const again = (await agent.patch(`/api/notices/${created.id}`).send({ status: "published" }))
        .body.notice;
      expect(again.publishedAt).toBe(published.publishedAt);
    });

    it("sets and clears the expiry date", async () => {
      const { agent } = await signedIn("ann@example.com");
      const id = (await agent.post("/api/notices").send(noticeBody(categoryId))).body.notice.id;
      const when = new Date(Date.now() + HOUR).toISOString();
      expect(
        (await agent.patch(`/api/notices/${id}`).send({ expiresAt: when })).body.notice.expiresAt,
      ).toBe(when);
      expect(
        (await agent.patch(`/api/notices/${id}`).send({ expiresAt: null })).body.notice.expiresAt,
      ).toBeNull();
    });

    it("forbids other committee members (403), allows admin, needs a sign-in", async () => {
      const ann = await signedIn("ann@example.com");
      const ben = await signedIn("ben@example.com");
      const admin = await signedIn("root@example.com", "admin");
      const id = (await ann.agent.post("/api/notices").send(noticeBody(categoryId))).body.notice.id;

      expect((await ben.agent.patch(`/api/notices/${id}`).send({ title: "Hijack" })).status).toBe(
        403,
      );
      expect((await anon().patch(`/api/notices/${id}`).send({ title: "Hijack" })).status).toBe(401);
      expect(
        (await admin.agent.patch(`/api/notices/${id}`).send({ title: "By admin" })).status,
      ).toBe(200);
      expect((await Notice.findById(id))?.title).toBe("By admin");
    });

    it("rejects empty or unknown updates and a past expiry", async () => {
      const { agent } = await signedIn("ann@example.com");
      const id = (await agent.post("/api/notices").send(noticeBody(categoryId))).body.notice.id;
      expect((await agent.patch(`/api/notices/${id}`).send({})).status).toBe(400);
      expect((await agent.patch(`/api/notices/${id}`).send({ pinned: true })).status).toBe(400);
      const past = new Date(Date.now() - HOUR).toISOString();
      expect((await agent.patch(`/api/notices/${id}`).send({ expiresAt: past })).status).toBe(400);
      expect((await agent.patch("/api/notices/not-an-id").send({ title: "x" })).status).toBe(404);
    });
  });

  describe("DELETE /api/notices/:id", () => {
    it("archives (kept, hidden from the public) or deletes (gone)", async () => {
      const { agent } = await signedIn("ann@example.com");
      const a = (await agent.post("/api/notices").send(noticeBody(categoryId))).body.notice.id;
      const b = (await agent.post("/api/notices").send(noticeBody(categoryId))).body.notice.id;

      expect((await agent.delete(`/api/notices/${a}?mode=archive`)).status).toBe(204);
      expect((await Notice.findById(a))?.status).toBe("archived");
      expect((await anon().get(`/api/notices/${a}`)).status).toBe(404);

      expect((await agent.delete(`/api/notices/${b}`)).status).toBe(204);
      expect(await Notice.findById(b)).toBeNull();
    });

    it("forbids other committee members and anonymous callers, allows admin", async () => {
      const ann = await signedIn("ann@example.com");
      const ben = await signedIn("ben@example.com");
      const admin = await signedIn("root@example.com", "admin");
      const id = (await ann.agent.post("/api/notices").send(noticeBody(categoryId))).body.notice.id;

      expect((await ben.agent.delete(`/api/notices/${id}`)).status).toBe(403);
      expect((await anon().delete(`/api/notices/${id}`)).status).toBe(401);
      expect(await Notice.findById(id)).not.toBeNull();
      expect((await admin.agent.delete(`/api/notices/${id}`)).status).toBe(204);
      expect((await ann.agent.delete(`/api/notices/${id}?mode=bogus`)).status).toBe(400);
    });
  });

  describe("GET /api/me/notices", () => {
    it("shows committee members only their own notices, admin everyone's", async () => {
      const ann = await signedIn("ann@example.com");
      const ben = await signedIn("ben@example.com");
      const admin = await signedIn("root@example.com", "admin");
      await ann.agent.post("/api/notices").send(noticeBody(categoryId, { title: "Ann 1" }));
      await ann.agent
        .post("/api/notices")
        .send(noticeBody(categoryId, { title: "Ann 2", status: "draft" }));
      await ben.agent.post("/api/notices").send(noticeBody(categoryId, { title: "Ben 1" }));

      const mine = await ann.agent.get("/api/me/notices");
      expect(mine.body.items.map((n: { title: string }) => n.title).sort()).toEqual([
        "Ann 1",
        "Ann 2",
      ]);
      expect(mine.body.total).toBe(2);
      expect((await admin.agent.get("/api/me/notices")).body.total).toBe(3);
      const drafts = await ann.agent.get("/api/me/notices?status=draft");
      expect(drafts.body.items).toHaveLength(1);
    });

    it("pages results, caps the page size and needs a sign-in", async () => {
      const { agent } = await signedIn("ann@example.com");
      for (let i = 1; i <= 3; i++)
        await agent.post("/api/notices").send(noticeBody(categoryId, { title: `N${i}` }));
      const page2 = await agent.get("/api/me/notices?limit=2&page=2");
      expect(page2.body).toMatchObject({ page: 2, limit: 2, total: 3 });
      expect(page2.body.items).toHaveLength(1);
      expect((await agent.get("/api/me/notices?limit=500")).status).toBe(400);
      expect((await agent.get("/api/me/notices?status[$ne]=draft")).status).toBe(400);
      expect((await request(createApp(testEnv)).get("/api/me/notices")).status).toBe(401);
    });
  });

  describe("GET /api/categories and audit", () => {
    it("lists categories for anyone, sorted by name", async () => {
      await createCategory("Exams");
      const res = await anon().get("/api/categories");
      expect(res.status).toBe(200);
      expect(res.body.items.map((c: { name: string }) => c.name)).toEqual(["Exams", "General"]);
    });

    it("writes audit entries for create, update, archive and delete", async () => {
      const { agent } = await signedIn("ann@example.com");
      const id = (await agent.post("/api/notices").send(noticeBody(categoryId))).body.notice.id;
      await agent.patch(`/api/notices/${id}`).send({ title: "Edited" });
      await agent.delete(`/api/notices/${id}?mode=archive`);
      await agent.delete(`/api/notices/${id}`);
      const actions = (await AuditLog.find({ action: /^notice\./ })).map((a) => a.action).sort();
      expect(actions).toEqual([
        "notice.archive",
        "notice.create",
        "notice.delete",
        "notice.update",
      ]);
    });
  });
});
