import request from "supertest";
import { createApp } from "../src/app.js";
import { hasOperatorKeys } from "../src/lib/sanitize.js";
import { LIMITS } from "../src/middleware/rateLimit.js";
import {
  PASSWORD,
  clearTestDb,
  connectTestDb,
  createUser,
  disconnectTestDb,
  makeAgent,
  testEnv,
} from "./helpers.js";

describe("hasOperatorKeys", () => {
  it("accepts ordinary data", () => {
    expect(hasOperatorKeys({ title: "Exam $5 fee", list: [{ a: 1 }, "x"] })).toBe(false);
    expect(hasOperatorKeys("plain string")).toBe(false);
    expect(hasOperatorKeys(null)).toBe(false);
  });

  it("rejects $ keys and dotted keys at any depth, including inside arrays", () => {
    expect(hasOperatorKeys({ $ne: null })).toBe(true);
    expect(hasOperatorKeys({ a: { b: { $where: "1" } } })).toBe(true);
    expect(hasOperatorKeys({ "a.b": 1 })).toBe(true);
    expect(hasOperatorKeys([{ ok: 1 }, { $gt: "" }])).toBe(true);
  });

  it("treats absurdly deep input as hostile", () => {
    let deep: unknown = "x";
    for (let i = 0; i < 20; i++) deep = { a: deep };
    expect(hasOperatorKeys(deep)).toBe(true);
  });
});

describe("request guards", () => {
  beforeAll(connectTestDb);
  beforeEach(() => createUser("ann@example.com"));
  afterEach(clearTestDb);
  afterAll(disconnectTestDb);

  it("rejects operator keys in the query string and in nested bodies", async () => {
    const app = createApp(testEnv);
    expect((await request(app).get("/api/health?q[$ne]=1")).status).toBe(400);
    const res = await request(app)
      .post("/api/auth/login")
      .set("Origin", testEnv.APP_ORIGIN)
      .send({ email: "ann@example.com", password: PASSWORD, extra: { "a.b": 1 } });
    expect(res.status).toBe(400);
  });

  it("rejects state-changing requests with a missing or foreign Origin, allows GET without one", async () => {
    const app = createApp(testEnv);
    const body = { email: "ann@example.com", password: PASSWORD };
    expect((await request(app).post("/api/auth/login").send(body)).status).toBe(403);
    const foreign = await request(app)
      .post("/api/auth/login")
      .set("Origin", "https://evil.example")
      .send(body);
    expect(foreign.status).toBe(403);
    expect(foreign.body.error.code).toBe("BAD_ORIGIN");
    expect((await request(app).get("/api/health")).status).toBe(200);
    expect(
      (await request(app).post("/api/auth/login").set("Origin", testEnv.APP_ORIGIN).send(body))
        .status,
    ).toBe(200);
  });
});

describe("rate limiting", () => {
  beforeAll(connectTestDb);
  beforeEach(() => createUser("ann@example.com"));
  afterEach(clearTestDb);
  afterAll(disconnectTestDb);

  const attempt = (agent: ReturnType<typeof makeAgent>, email: string, password: string) =>
    agent.post("/api/auth/login").send({ email, password });

  it("blocks the 6th login attempt after 5 failures, even with the right password", async () => {
    const agent = makeAgent();
    for (let i = 0; i < LIMITS.loginFailures; i++) {
      expect((await attempt(agent, "ann@example.com", "wrong")).status).toBe(401);
    }
    const blocked = await attempt(agent, "ann@example.com", PASSWORD);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("counts per email, and a successful login clears the counter", async () => {
    const agent = makeAgent();
    for (let i = 0; i < LIMITS.loginFailures - 1; i++)
      await attempt(agent, "ann@example.com", "wrong");
    expect((await attempt(agent, "other@example.com", "wrong")).status).toBe(401); // other email unaffected
    expect((await attempt(agent, "ann@example.com", PASSWORD)).status).toBe(200);
    for (let i = 0; i < LIMITS.loginFailures - 1; i++)
      await attempt(agent, "ann@example.com", "wrong");
    expect((await attempt(agent, "ann@example.com", PASSWORD)).status).toBe(200);
  });

  it("limits public reads per IP", async () => {
    const app = createApp(testEnv);
    for (let i = 0; i < LIMITS.publicReadsPerMinute; i++) await request(app).get("/api/nope");
    expect((await request(app).get("/api/nope")).status).toBe(429);
  });

  it("limits writes", async () => {
    const agent = makeAgent();
    for (let i = 0; i < LIMITS.writesPerMinute; i++) await agent.post("/api/auth/logout");
    expect((await agent.post("/api/auth/logout")).status).toBe(429);
  });
});
