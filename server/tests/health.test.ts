import request from "supertest";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";

describe("GET /api/health", () => {
  it("returns ok", async () => {
    const res = await request(createApp()).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("returns the common error format for unknown api paths", async () => {
    const res = await request(createApp()).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});

describe("loadEnv", () => {
  it("accepts a valid environment and applies defaults", () => {
    const env = loadEnv({ APP_ORIGIN: "http://localhost:5173" });
    expect(env.PORT).toBe(4000);
  });

  it("stops with a clear message when a variable is missing", () => {
    expect(() => loadEnv({})).toThrow(/APP_ORIGIN/);
  });
});
