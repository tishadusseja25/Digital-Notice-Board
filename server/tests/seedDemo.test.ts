import mongoose, { trusted } from "mongoose";
import { DEMO_DOMAIN, DEMO_PASSWORD, poster, seedDemo } from "../../scripts/seed-demo.js";
import { Notice } from "../src/models/Notice.js";
import { User } from "../src/models/User.js";
import { publicNoticeFilter } from "../src/lib/visibility.js";
import { clearTestDb, connectTestDb, disconnectTestDb, makeAgent } from "./helpers.js";

describe("demo seed", () => {
  beforeAll(connectTestDb);
  afterEach(clearTestDb);
  afterAll(disconnectTestDb);

  it("creates committee members, categories and notices in every state, and no admin", async () => {
    const r = await seedDemo({ notices: 60, bcryptCost: 4 });
    expect(r.skipped).toBe(false);
    expect(await User.countDocuments({ role: "admin" })).toBe(0);
    expect(await User.countDocuments({ role: "committee" })).toBe(14);
    expect(await User.countDocuments({ active: false })).toBe(1);
    expect(await Notice.countDocuments()).toBe(60);
    expect(await Notice.countDocuments({ status: "draft" })).toBeGreaterThan(0);
    expect(await Notice.countDocuments({ status: "archived" })).toBeGreaterThan(0);
    expect(await Notice.countDocuments({ pinned: true })).toBe(3);
    expect(await Notice.countDocuments(publicNoticeFilter())).toBeGreaterThan(20);
    expect(
      await Notice.countDocuments({ expiresAt: trusted({ $lt: new Date() }) }),
    ).toBeGreaterThan(0);
  });

  it("stores valid, public-readable images attached to notices", async () => {
    await seedDemo({ notices: 60, bcryptCost: 4 });
    const withImage =
      (await Notice.findOne({
        "images.0": { $exists: true },
        status: "published",
        pinned: true,
      })) ??
      (await Notice.findOne({ "images.0": trusted({ $exists: true }), status: "published" }));
    expect(withImage).not.toBeNull();
    const fileId = withImage!.images[0]!.fileId;
    const meta = await mongoose.connection.db!.collection("images.files").findOne({ _id: fileId });
    expect(meta?.metadata.noticeId.toString()).toBe(withImage!.id);
    expect(poster(10, 1).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  });

  it("lets demo committee members sign in with the shared password", async () => {
    await seedDemo({ notices: 10, bcryptCost: 4 });
    for (const email of [`rohan.deshmukh@${DEMO_DOMAIN}`, `priya.menon@${DEMO_DOMAIN}`]) {
      const res = await makeAgent()
        .post("/api/auth/login")
        .send({ email, password: DEMO_PASSWORD });
      expect(res.status).toBe(200);
      expect(res.body.user.mustChangePassword).toBe(false);
    }
  });

  it("does nothing on a second run, and --reset replaces the demo data only", async () => {
    await seedDemo({ notices: 20, bcryptCost: 4 });
    expect((await seedDemo({ notices: 20, bcryptCost: 4 })).skipped).toBe(true);
    await User.create({
      name: "Real",
      email: "real@example.com",
      passwordHash: "x",
      role: "admin",
    });
    const again = await seedDemo({ notices: 25, reset: true, bcryptCost: 4 });
    expect(again.skipped).toBe(false);
    expect(await Notice.countDocuments()).toBe(25);
    expect(await User.countDocuments({ email: "real@example.com" })).toBe(1);
    expect(await User.countDocuments({ email: new RegExp(DEMO_DOMAIN) })).toBe(14);
  });
});
