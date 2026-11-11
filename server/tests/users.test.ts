import request from "supertest";
import { createApp } from "../src/app.js";
import { AuditLog } from "../src/models/AuditLog.js";
import { RefreshToken } from "../src/models/RefreshToken.js";
import { User } from "../src/models/User.js";
import {
  PASSWORD,
  clearTestDb,
  connectTestDb,
  cookieValue,
  createUser,
  disconnectTestDb,
  makeAgent,
  signedIn,
  testEnv,
} from "./helpers.js";

const NEW_PASSWORD = "a-brand-new-password";
const newUser = (extra: Record<string, unknown> = {}) => ({
  name: "Ben",
  email: "ben@example.com",
  role: "committee",
  password: "temporary-password",
  ...extra,
});
const login = (email: string, password: string) =>
  makeAgent().post("/api/auth/login").send({ email, password });
const actions = async () => (await AuditLog.find()).map((a) => a.action);

describe("user management API", () => {
  beforeAll(connectTestDb);
  afterEach(clearTestDb);
  afterAll(disconnectTestDb);

  describe("access", () => {
    it("is admin-only: anonymous gets 401, committee gets 403", async () => {
      const committee = await signedIn("ann@example.com");
      const anon = makeAgent();
      const id = "507f1f77bcf86cd799439011";
      const attempts = (agent: typeof anon) => [
        agent.get("/api/users"),
        agent.post("/api/users").send(newUser()),
        agent.patch(`/api/users/${id}`).send({ active: false }),
      ];
      for (const res of await Promise.all(attempts(anon))) expect(res.status).toBe(401);
      for (const res of await Promise.all(attempts(committee.agent))) expect(res.status).toBe(403);
      expect(await User.countDocuments()).toBe(1);
    });
  });

  describe("GET /api/users", () => {
    it("lists users newest first, pages them and never returns hashes", async () => {
      const admin = await signedIn("root@example.com", "admin");
      await createUser("a@example.com");
      await createUser("b@example.com");
      const res = await admin.agent.get("/api/users?limit=2");
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ page: 1, limit: 2, total: 3 });
      expect(res.body.items).toHaveLength(2);
      expect(res.body.items[0].email).toBe("b@example.com");
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
      expect(res.body.items[0]).toHaveProperty("mustChangePassword");
      expect((await admin.agent.get("/api/users?limit=500")).status).toBe(400);
    });
  });

  describe("POST /api/users", () => {
    it("creates an account that can sign in but must change its password", async () => {
      const admin = await signedIn("root@example.com", "admin");
      const res = await admin.agent
        .post("/api/users")
        .send(newUser({ email: " Ben@Example.com " }));
      expect(res.status).toBe(201);
      expect(res.body.user).toMatchObject({
        email: "ben@example.com",
        role: "committee",
        active: true,
        mustChangePassword: true,
      });
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|temporary-password/);

      const signIn = await login("ben@example.com", "temporary-password");
      expect(signIn.status).toBe(200);
      expect(signIn.body.user.mustChangePassword).toBe(true);
      expect(await actions()).toContain("user.create");
    });

    it("rejects a duplicate email in any letter case with 409", async () => {
      const admin = await signedIn("root@example.com", "admin");
      expect((await admin.agent.post("/api/users").send(newUser())).status).toBe(201);
      const again = await admin.agent
        .post("/api/users")
        .send(newUser({ email: "BEN@example.com" }));
      expect(again.status).toBe(409);
      expect(again.body.error.fields.email).toBeTruthy();
      expect(await User.countDocuments({ email: "ben@example.com" })).toBe(1);
    });

    it("rejects weak or malformed input and fields it does not know", async () => {
      const admin = await signedIn("root@example.com", "admin");
      const post = (extra: Record<string, unknown>) =>
        admin.agent.post("/api/users").send(newUser(extra));
      expect((await post({ password: "short" })).status).toBe(400);
      expect((await post({ role: "root" })).status).toBe(400);
      expect((await post({ email: "not-an-email" })).status).toBe(400);
      expect((await post({ name: "  " })).status).toBe(400);
      expect((await post({ active: false })).status).toBe(400);
      expect((await post({ email: { $ne: null } })).status).toBe(400);
      expect(await User.countDocuments()).toBe(1);
    });
  });

  describe("PATCH /api/users/:id", () => {
    it("disabling blocks sign-in and ends the user's sessions; enabling restores sign-in", async () => {
      const admin = await signedIn("root@example.com", "admin");
      const target = await createUser("ben@example.com");
      const token = cookieValue(await login("ben@example.com", PASSWORD), "nb_refresh")!;

      const off = await admin.agent.patch(`/api/users/${target.id}`).send({ active: false });
      expect(off.status).toBe(200);
      expect(off.body.user.active).toBe(false);
      expect((await login("ben@example.com", PASSWORD)).status).toBe(401);
      const refresh = await request(createApp(testEnv))
        .post("/api/auth/refresh")
        .set("Origin", testEnv.APP_ORIGIN)
        .set("Cookie", `nb_refresh=${token}`);
      expect(refresh.status).toBe(401);
      expect(await RefreshToken.countDocuments({ userId: target._id, revoked: false })).toBe(0);

      expect(
        (await admin.agent.patch(`/api/users/${target.id}`).send({ active: true })).status,
      ).toBe(200);
      expect((await login("ben@example.com", PASSWORD)).status).toBe(200);
      expect(await actions()).toEqual(expect.arrayContaining(["user.disable", "user.enable"]));
    });

    it("resetting the password replaces it, forces a change and ends the user's sessions", async () => {
      const admin = await signedIn("root@example.com", "admin");
      const target = await createUser("ben@example.com");
      const token = cookieValue(await login("ben@example.com", PASSWORD), "nb_refresh")!;

      const res = await admin.agent
        .patch(`/api/users/${target.id}`)
        .send({ password: NEW_PASSWORD });
      expect(res.status).toBe(200);
      expect(res.body.user.mustChangePassword).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain(NEW_PASSWORD);
      expect((await login("ben@example.com", PASSWORD)).status).toBe(401);
      const signIn = await login("ben@example.com", NEW_PASSWORD);
      expect(signIn.status).toBe(200);
      expect(signIn.body.user.mustChangePassword).toBe(true);
      const old = await request(createApp(testEnv))
        .post("/api/auth/refresh")
        .set("Origin", testEnv.APP_ORIGIN)
        .set("Cookie", `nb_refresh=${token}`);
      expect(old.status).toBe(401);
      expect(await actions()).toContain("user.reset_password");
    });

    it("changes a role, and the new role applies at the next sign-in", async () => {
      const admin = await signedIn("root@example.com", "admin");
      const target = await createUser("ben@example.com");
      expect(
        (await admin.agent.patch(`/api/users/${target.id}`).send({ role: "admin" })).status,
      ).toBe(200);
      const ben = makeAgent();
      await ben.post("/api/auth/login").send({ email: "ben@example.com", password: PASSWORD });
      expect((await ben.get("/api/users")).status).toBe(200);
      expect(await actions()).toContain("user.role");
    });

    it("does not log a change that changed nothing", async () => {
      const admin = await signedIn("root@example.com", "admin");
      const target = await createUser("ben@example.com");
      await admin.agent.patch(`/api/users/${target.id}`).send({ role: "committee", active: true });
      expect((await actions()).filter((a) => a.startsWith("user."))).toEqual([]);
    });

    it("refuses an admin changing their own role, status or password (409)", async () => {
      const admin = await signedIn("root@example.com", "admin");
      for (const body of [{ role: "committee" }, { active: false }, { password: NEW_PASSWORD }]) {
        const res = await admin.agent.patch(`/api/users/${admin.user.id}`).send(body);
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe("CANNOT_CHANGE_SELF");
      }
      const me = await User.findById(admin.user.id);
      expect(me).toMatchObject({ role: "admin", active: true });
      expect((await admin.agent.get("/api/users")).status).toBe(200);
    });

    it("returns 404 for unknown or malformed ids and 400 for empty or invalid bodies", async () => {
      const admin = await signedIn("root@example.com", "admin");
      const target = await createUser("ben@example.com");
      expect(
        (await admin.agent.patch("/api/users/507f1f77bcf86cd799439011").send({ active: false }))
          .status,
      ).toBe(404);
      expect((await admin.agent.patch("/api/users/not-an-id").send({ active: false })).status).toBe(
        404,
      );
      expect((await admin.agent.patch(`/api/users/${target.id}`).send({})).status).toBe(400);
      expect(
        (await admin.agent.patch(`/api/users/${target.id}`).send({ password: "short" })).status,
      ).toBe(400);
      expect(
        (await admin.agent.patch(`/api/users/${target.id}`).send({ email: "x@y.z" })).status,
      ).toBe(400);
      expect(
        (await admin.agent.patch(`/api/users/${target.id}`).send({ active: "no" })).status,
      ).toBe(400);
    });
  });
});
