import { AuditLog } from "../src/models/AuditLog.js";
import { Category } from "../src/models/Category.js";
import {
  clearTestDb,
  connectTestDb,
  createCategory,
  disconnectTestDb,
  makeAgent,
  noticeBody,
  signedIn,
} from "./helpers.js";

describe("category management API", () => {
  beforeAll(connectTestDb);
  afterEach(clearTestDb);
  afterAll(disconnectTestDb);

  it("keeps listing public but makes every change admin-only", async () => {
    const committee = await signedIn("ann@example.com");
    const anon = makeAgent();
    const cat = await createCategory("Exams");
    expect((await anon.get("/api/categories")).status).toBe(200);

    const attempts = (agent: typeof anon) => [
      agent.post("/api/categories").send({ name: "New" }),
      agent.patch(`/api/categories/${cat.id}`).send({ name: "Renamed" }),
      agent.delete(`/api/categories/${cat.id}`),
    ];
    for (const res of await Promise.all(attempts(anon))) expect(res.status).toBe(401);
    for (const res of await Promise.all(attempts(committee.agent))) expect(res.status).toBe(403);
    expect(await Category.find()).toHaveLength(1);
    expect((await Category.findById(cat.id))?.name).toBe("Exams");
  });

  it("creates a category with a trimmed name and logs it", async () => {
    const admin = await signedIn("root@example.com", "admin");
    const res = await admin.agent.post("/api/categories").send({ name: "  Sports  " });
    expect(res.status).toBe(201);
    expect(res.body.category.name).toBe("Sports");
    const list = await makeAgent().get("/api/categories");
    expect(list.body.items.map((c: { name: string }) => c.name)).toEqual(["Sports"]);
    expect((await AuditLog.find()).map((a) => a.action)).toContain("category.create");
  });

  it("rejects duplicates in any letter case, blank or long names and unknown fields", async () => {
    const admin = await signedIn("root@example.com", "admin");
    await createCategory("Exams");
    const dup = await admin.agent.post("/api/categories").send({ name: "EXAMS" });
    expect(dup.status).toBe(409);
    expect(dup.body.error.fields.name).toBeTruthy();
    expect((await admin.agent.post("/api/categories").send({ name: "   " })).status).toBe(400);
    expect((await admin.agent.post("/api/categories").send({ name: "x".repeat(41) })).status).toBe(
      400,
    );
    expect((await admin.agent.post("/api/categories").send({ name: "A", extra: 1 })).status).toBe(
      400,
    );
    expect((await admin.agent.post("/api/categories").send({ name: { $ne: "" } })).status).toBe(
      400,
    );
    expect(await Category.countDocuments()).toBe(1);
  });

  it("renames a category, allows a change of letter case, and refuses a clash", async () => {
    const admin = await signedIn("root@example.com", "admin");
    const exams = await createCategory("Exams");
    await createCategory("Events");

    const renamed = await admin.agent.patch(`/api/categories/${exams.id}`).send({ name: "Tests" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.category.name).toBe("Tests");
    expect(
      (await admin.agent.patch(`/api/categories/${exams.id}`).send({ name: "tests" })).status,
    ).toBe(200);
    const clash = await admin.agent.patch(`/api/categories/${exams.id}`).send({ name: "EVENTS" });
    expect(clash.status).toBe(409);
    expect((await Category.findById(exams.id))?.name).toBe("tests");
    expect((await AuditLog.find()).map((a) => a.action)).toContain("category.rename");
  });

  it("deletes an unused category but never one that notices use", async () => {
    const admin = await signedIn("root@example.com", "admin");
    const author = await signedIn("ann@example.com");
    const used = await createCategory("Used");
    const unused = await createCategory("Unused");
    await author.agent.post("/api/notices").send(noticeBody(used.id));

    const blocked = await admin.agent.delete(`/api/categories/${used.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("CATEGORY_IN_USE");
    expect(await Category.findById(used.id)).not.toBeNull();

    expect((await admin.agent.delete(`/api/categories/${unused.id}`)).status).toBe(204);
    expect(await Category.findById(unused.id)).toBeNull();
    expect((await AuditLog.find()).map((a) => a.action)).toContain("category.delete");
  });

  it("returns 404 for unknown or malformed ids", async () => {
    const admin = await signedIn("root@example.com", "admin");
    const missing = "507f1f77bcf86cd799439011";
    expect((await admin.agent.patch(`/api/categories/${missing}`).send({ name: "X" })).status).toBe(
      404,
    );
    expect((await admin.agent.patch("/api/categories/nope").send({ name: "X" })).status).toBe(404);
    expect((await admin.agent.delete(`/api/categories/${missing}`)).status).toBe(404);
    expect((await admin.agent.delete("/api/categories/nope")).status).toBe(404);
  });
});
