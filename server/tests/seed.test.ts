import { seed } from "../../scripts/seed-admin.js";
import { Category } from "../src/models/Category.js";
import { User } from "../src/models/User.js";
import { clearTestDb, connectTestDb, disconnectTestDb } from "./helpers.js";

const input = {
  name: "First Admin",
  email: "Admin@Example.com",
  password: "a-long-password",
  bcryptCost: 4,
};

describe("seed script", () => {
  beforeAll(connectTestDb);
  afterEach(clearTestDb);
  afterAll(disconnectTestDb);

  it("creates exactly one admin and the default categories, and is safe to repeat", async () => {
    expect((await seed(input)).adminCreated).toBe(true);
    expect((await seed(input)).adminCreated).toBe(false);

    const admins = await User.find({ role: "admin" });
    expect(admins).toHaveLength(1);
    expect(admins[0]?.email).toBe("admin@example.com"); // stored lowercase
    expect(admins[0]?.passwordHash).not.toContain("a-long-password");
    expect(admins[0]?.mustChangePassword).toBe(true);
    expect(await Category.countDocuments()).toBe(4);
  });

  it("does not create a second admin when a different email is given", async () => {
    await seed(input);
    await seed({ ...input, email: "other@example.com" });
    expect(await User.countDocuments({ role: "admin" })).toBe(1);
  });
});
