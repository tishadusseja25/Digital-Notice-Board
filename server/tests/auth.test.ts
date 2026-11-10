import jwt from "jsonwebtoken";
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
  testEnv,
} from "./helpers.js";

const login = (
  agent: ReturnType<typeof makeAgent>,
  email = "ann@example.com",
  password = PASSWORD,
) => agent.post("/api/auth/login").send({ email, password });

// Plain request with only a refresh cookie, like a browser that kept just that cookie.
const refreshWith = (token?: string) => {
  const req = request(createApp(testEnv))
    .post("/api/auth/refresh")
    .set("Origin", testEnv.APP_ORIGIN);
  return token ? req.set("Cookie", `nb_refresh=${token}`) : req;
};

describe("auth endpoints", () => {
  beforeAll(connectTestDb);
  beforeEach(() => createUser("ann@example.com"));
  afterEach(clearTestDb);
  afterAll(disconnectTestDb);

  describe("POST /api/auth/login", () => {
    it("signs in, sets HttpOnly SameSite=Strict cookies and never returns the hash", async () => {
      const res = await login(makeAgent(), " ANN@example.com ");
      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({ email: "ann@example.com", role: "committee" });
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
      const cookies = (res.headers["set-cookie"] as unknown as string[]).join("\n");
      expect(cookies).toMatch(/nb_access=[^\n]*HttpOnly[^\n]*SameSite=Strict/);
      expect(cookies).toMatch(/nb_refresh=[^\n]*Path=\/api\/auth[^\n]*HttpOnly/);
    });

    it("gives the same generic error for a wrong password and an unknown email", async () => {
      const wrong = await login(makeAgent(), "ann@example.com", "nope");
      const unknown = await login(makeAgent(), "ghost@example.com");
      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(wrong.body).toEqual(unknown.body);
    });

    it("blocks disabled users", async () => {
      await User.updateOne({ email: "ann@example.com" }, { active: false });
      expect((await login(makeAgent())).status).toBe(401);
    });

    it("rejects operator objects and unknown fields instead of querying with them", async () => {
      const agent = makeAgent();
      const operator = await agent
        .post("/api/auth/login")
        .send({ email: { $ne: null }, password: { $ne: null } });
      expect(operator.status).toBe(400);
      const extra = await agent
        .post("/api/auth/login")
        .send({ email: "ann@example.com", password: PASSWORD, role: "admin" });
      expect(extra.status).toBe(400);
    });

    it("writes audit entries for success and failure", async () => {
      await login(makeAgent());
      await login(makeAgent(), "ann@example.com", "nope");
      const actions = (await AuditLog.find()).map((a) => a.action).sort();
      expect(actions).toEqual(["login.failure", "login.success"]);
    });
  });

  describe("GET /api/auth/me", () => {
    it("returns the signed-in user", async () => {
      const agent = makeAgent();
      await login(agent);
      const res = await agent.get("/api/auth/me");
      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe("ann@example.com");
    });

    it("returns 401 with no cookie, a tampered cookie or an expired token", async () => {
      const app = createApp(testEnv);
      const user = await User.findOne();
      const expired = jwt.sign({ role: "committee" }, testEnv.JWT_ACCESS_SECRET, {
        subject: user!.id,
        expiresIn: -10,
      });
      const me = (cookie?: string) => {
        const req = request(app).get("/api/auth/me");
        return cookie ? req.set("Cookie", cookie) : req;
      };
      expect((await me()).status).toBe(401);
      expect((await me("nb_access=junk")).status).toBe(401);
      expect((await me(`nb_access=${expired}`)).status).toBe(401);
    });
  });

  describe("refresh and logout", () => {
    it("rotates the refresh token: a new pair is issued and the new token works", async () => {
      const oldToken = cookieValue(await login(makeAgent()), "nb_refresh")!;
      const refreshed = await refreshWith(oldToken);
      expect(refreshed.status).toBe(204);
      const newToken = cookieValue(refreshed, "nb_refresh")!;
      expect(newToken).not.toBe(oldToken);
      expect(cookieValue(refreshed, "nb_access")).toBeTruthy();
      expect((await refreshWith(newToken)).status).toBe(204);
    });

    it("revokes every session when an already-used refresh token is replayed", async () => {
      const oldToken = cookieValue(await login(makeAgent()), "nb_refresh")!;
      const newToken = cookieValue(await refreshWith(oldToken), "nb_refresh")!;
      expect((await refreshWith(oldToken)).status).toBe(401); // replay
      expect((await refreshWith(newToken)).status).toBe(401); // the rotated token is dead too
      expect(await RefreshToken.countDocuments({ revoked: false })).toBe(0);
    });

    it("rejects refresh without a cookie, with junk, and for a disabled user", async () => {
      expect((await refreshWith()).status).toBe(401);
      expect((await refreshWith("junk")).status).toBe(401);

      const token = cookieValue(await login(makeAgent()), "nb_refresh")!;
      await User.updateOne({ email: "ann@example.com" }, { active: false });
      expect((await refreshWith(token)).status).toBe(401);
    });

    it("logout revokes the refresh token and clears the session", async () => {
      const agent = makeAgent();
      const token = cookieValue(await login(agent), "nb_refresh")!;
      expect((await agent.post("/api/auth/logout")).status).toBe(204);
      expect((await agent.get("/api/auth/me")).status).toBe(401);
      expect((await refreshWith(token)).status).toBe(401);
    });
  });

  describe("POST /api/auth/password", () => {
    const newPassword = "a-brand-new-password";

    it("needs a sign-in, the right current password and a long enough new one", async () => {
      const agent = makeAgent();
      const body = { current: PASSWORD, next: newPassword };
      expect((await agent.post("/api/auth/password").send(body)).status).toBe(401);

      await login(agent);
      const wrong = await agent.post("/api/auth/password").send({ ...body, current: "nope" });
      expect(wrong.status).toBe(400);
      expect(wrong.body.error.fields.current).toBeTruthy();
      const short = await agent.post("/api/auth/password").send({ ...body, next: "short" });
      expect(short.status).toBe(400);
    });

    it("changes the password and ends the user's other sessions but not this one", async () => {
      const hereLogin = await login(makeAgent());
      const hereToken = cookieValue(hereLogin, "nb_refresh")!;
      const otherToken = cookieValue(await login(makeAgent()), "nb_refresh")!;

      // Plain request (no cookie jar) so exactly these two cookies are sent.
      const res = await request(createApp(testEnv))
        .post("/api/auth/password")
        .set("Origin", testEnv.APP_ORIGIN)
        .set("Cookie", `nb_access=${cookieValue(hereLogin, "nb_access")}; nb_refresh=${hereToken}`)
        .send({ current: PASSWORD, next: newPassword });
      expect(res.status).toBe(204);

      // Check this session first: replaying the revoked "other" token triggers reuse detection,
      // which (correctly) ends every session of the user.
      expect((await refreshWith(hereToken)).status).toBe(204);
      expect((await refreshWith(otherToken)).status).toBe(401);
      expect((await login(makeAgent(), "ann@example.com", PASSWORD)).status).toBe(401);
      expect((await login(makeAgent(), "ann@example.com", newPassword)).status).toBe(200);
    });
  });
});
