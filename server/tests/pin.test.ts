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
} from "./helpers.js";

describe("pinning notices", () => {
  let categoryId: string;
  let author: Awaited<ReturnType<typeof signedIn>>;
  let admin: Awaited<ReturnType<typeof signedIn>>;

  beforeAll(connectTestDb);
  beforeEach(async () => {
    categoryId = (await createCategory()).id;
    author = await signedIn("ann@example.com");
    admin = await signedIn("root@example.com", "admin");
  });
  afterEach(clearTestDb);
  afterAll(disconnectTestDb);

  const make = async (extra: Record<string, unknown> = {}) =>
    (await author.agent.post("/api/notices").send(noticeBody(categoryId, extra))).body.notice
      .id as string;
  const pin = (id: string, pinned = true, agent = admin.agent) =>
    agent.post(`/api/notices/${id}/pin`).send({ pinned });

  it("is admin-only: anonymous 401, committee 403 (even for their own notice)", async () => {
    const id = await make();
    expect((await pin(id, true, makeAgent())).status).toBe(401);
    expect((await pin(id, true, author.agent)).status).toBe(403);
    expect((await Notice.findById(id))?.pinned).toBe(false);
  });

  it("pins and unpins, and a pinned notice moves to the top of the board", async () => {
    const older = await make({ title: "Older" });
    await new Promise((r) => setTimeout(r, 10));
    await make({ title: "Newer" });

    const pinned = await pin(older);
    expect(pinned.status).toBe(200);
    expect(pinned.body.notice.pinned).toBe(true);
    const board = await makeAgent().get("/api/notices");
    expect(board.body.items.map((n: { title: string }) => n.title)).toEqual(["Older", "Newer"]);

    expect((await pin(older, false)).body.notice.pinned).toBe(false);
    const after = await makeAgent().get("/api/notices");
    expect(after.body.items.map((n: { title: string }) => n.title)).toEqual(["Newer", "Older"]);
    expect((await AuditLog.find()).map((a) => a.action)).toEqual(
      expect.arrayContaining(["notice.pin", "notice.unpin"]),
    );
  });

  it("allows three pinned notices and refuses a fourth until one is unpinned", async () => {
    const ids = [await make(), await make(), await make(), await make()];
    for (const id of ids.slice(0, 3)) expect((await pin(id)).status).toBe(200);
    const fourth = await pin(ids[3]!);
    expect(fourth.status).toBe(409);
    expect(fourth.body.error.code).toBe("PIN_LIMIT");
    expect(await Notice.countDocuments({ pinned: true })).toBe(3);

    expect((await pin(ids[0]!, false)).status).toBe(200);
    expect((await pin(ids[3]!)).status).toBe(200);
  });

  it("pinning an already pinned notice is harmless and does not use another slot", async () => {
    const id = await make();
    await pin(id);
    expect((await pin(id)).status).toBe(200);
    expect(await Notice.countDocuments({ pinned: true })).toBe(1);
    expect((await AuditLog.find({ action: "notice.pin" })).length).toBe(1);
  });

  it("refuses to pin a draft, an archived or an expired notice", async () => {
    const draft = await make({ status: "draft" });
    const archived = await make({ status: "archived" });
    const expired = await make();
    await Notice.updateOne({ _id: expired }, { expiresAt: new Date(Date.now() - 1000) });
    for (const id of [draft, archived, expired]) {
      const res = await pin(id);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("NOT_PUBLISHED");
    }
    expect(await Notice.countDocuments({ pinned: true })).toBe(0);
  });

  it("removes the pin when a notice stops being published", async () => {
    const toArchive = await make();
    const toDraft = await make();
    await pin(toArchive);
    await pin(toDraft);

    await author.agent.delete(`/api/notices/${toArchive}?mode=archive`);
    await author.agent.patch(`/api/notices/${toDraft}`).send({ status: "draft" });
    expect(await Notice.countDocuments({ pinned: true })).toBe(0);
  });

  it("keeps the pin when other fields of a published notice are edited", async () => {
    const id = await make();
    await pin(id);
    await author.agent.patch(`/api/notices/${id}`).send({ title: "Edited" });
    expect((await Notice.findById(id))?.pinned).toBe(true);
  });

  it("validates the body and the id", async () => {
    const id = await make();
    expect((await admin.agent.post(`/api/notices/${id}/pin`).send({ pinned: "yes" })).status).toBe(
      400,
    );
    expect((await admin.agent.post(`/api/notices/${id}/pin`).send({})).status).toBe(400);
    expect(
      (await admin.agent.post(`/api/notices/${id}/pin`).send({ pinned: true, x: 1 })).status,
    ).toBe(400);
    expect((await pin("507f1f77bcf86cd799439011")).status).toBe(404);
    expect((await pin("not-an-id")).status).toBe(404);
  });

  it("cannot be set through the create or edit endpoints", async () => {
    const id = await make();
    expect((await author.agent.patch(`/api/notices/${id}`).send({ pinned: true })).status).toBe(
      400,
    );
    expect(
      (await admin.agent.post("/api/notices").send(noticeBody(categoryId, { pinned: true })))
        .status,
    ).toBe(400);
  });
});
