import request from "supertest";
import mongoose from "mongoose";
import { createApp } from "../src/app.js";
import { connectTestDb, testEnv } from "./helpers.js";

describe("GET /api/health", () => {
  beforeAll(connectTestDb);

  it("returns ok while the database is connected", async () => {
    const res = await request(createApp(testEnv)).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("returns the common error format for unknown api paths", async () => {
    const res = await request(createApp(testEnv)).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 503 when the database is down", async () => {
    await mongoose.disconnect();
    const res = await request(createApp(testEnv)).get("/api/health");
    expect(res.status).toBe(503);
  });
});
