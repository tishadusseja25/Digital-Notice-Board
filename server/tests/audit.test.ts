import { AuditLog } from "../src/models/AuditLog.js";
import {
  PASSWORD,
  clearTestDb,
  connectTestDb,
  createCategory,
  createUser,
  disconnectTestDb,
  makeAgent,
  noticeBody,
  signedIn,
} from "./helpers.js";

describe("audit log API", () => {
  beforeAll(connectTestDb);
  afterEach(clearTestDb);
  afterAll(disconnectTestDb);

  it("is admin-only", async () => {
    const committee = await signedIn("ann@example.com");
    expect((await makeAgent().get("/api/audit")).status).toBe(401);
    expect((await committee.agent.get("/api/audit")).status).toBe(403);
  });

  it("lists entries newest first with the person's name and email", async () => {
    const admin = await signedIn("root@example.com", "admin"); // writes login.success
    const category = await createCategory("General");
    const author = await signedIn("ann@example.com");
    await author.agent.post("/api/notices").send(noticeBody(category.id));

    const res = await admin.agent.get("/api/audit");
    expect(res.status).toBe(200);
    const actions = res.body.items.map((i: { action: string }) => i.action);
    expect(actions[0]).toBe("notice.create");
    expect(actions).toEqual(expect.arrayContaining(["login.success", "notice.create"]));
    const created = res.body.items[0];
    expect(created.actor).toMatchObject({ name: "ann", email: "ann@example.com" });
    expect(created).toMatchObject({ targetType: "notice" });
    const times = res.body.items.map((i: { at: string }) => new Date(i.at).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("shows failed sign-ins without an actor and never exposes secrets", async () => {
    const admin = await signedIn("root@example.com", "admin");
    await createUser("ann@example.com");
    await makeAgent()
      .post("/api/auth/login")
      .send({ email: "ann@example.com", password: "wrong-password" });
    const res = await admin.agent.get("/api/audit");
    const failure = res.body.items.find((i: { action: string }) => i.action === "login.failure");
    expect(failure.actor).toBeNull();
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[aby]\$|wrong-password/);
    expect(JSON.stringify(res.body)).not.toContain(PASSWORD);
  });

  it("pages the results and caps the page size", async () => {
    const admin = await signedIn("root@example.com", "admin");
    await AuditLog.insertMany(Array.from({ length: 25 }, (_, i) => ({ action: `test.${i}` })));
    const first = await admin.agent.get("/api/audit?limit=20");
    expect(first.body).toMatchObject({ page: 1, limit: 20, total: 26 });
    expect(first.body.items).toHaveLength(20);
    expect((await admin.agent.get("/api/audit?limit=20&page=2")).body.items).toHaveLength(6);
    expect((await admin.agent.get("/api/audit?limit=51")).status).toBe(400);
    expect((await admin.agent.get("/api/audit?action=login")).status).toBe(400);
    expect((await admin.agent.get("/api/audit?page[$ne]=1")).status).toBe(400);
  });

  it("is read-only: there is no way to change entries through the API", async () => {
    const admin = await signedIn("root@example.com", "admin");
    const before = await AuditLog.countDocuments();
    for (const res of [
      await admin.agent.post("/api/audit").send({ action: "forged" }),
      await admin.agent.delete("/api/audit"),
      await admin.agent.patch("/api/audit").send({ action: "forged" }),
    ]) {
      expect([404, 405]).toContain(res.status);
    }
    expect(await AuditLog.countDocuments()).toBe(before);
  });
});
