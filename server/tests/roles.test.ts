import cookieParser from "cookie-parser";
import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { signAccessToken } from "../src/lib/jwt.js";
import { authenticate, requireRole } from "../src/middleware/auth.js";
import { errorHandler } from "../src/middleware/errorHandler.js";
import { testEnv } from "./helpers.js";

// A tiny app with one route per access level, to test the guards in isolation.
const app = express();
app.use(cookieParser(), authenticate(testEnv));
app.get(
  "/any-staff",
  requireRole("committee", "admin"),
  (_req, res) => void res.json({ ok: true }),
);
app.get("/admin-only", requireRole("admin"), (_req, res) => void res.json({ ok: true }));
app.get("/public", (_req, res) => void res.json({ ok: true }));
app.use(errorHandler);

const cookieFor = (role: "committee" | "admin") =>
  `nb_access=${signAccessToken("507f1f77bcf86cd799439011", role, testEnv)}`;
const get = (path: string, cookie?: string) => {
  const req = request(app).get(path);
  return cookie ? req.set("Cookie", cookie) : req;
};

describe("role guards (each role against each access level)", () => {
  const cases: [string, string | undefined, number, number, number][] = [
    // [who,            cookie,                     /public, /any-staff, /admin-only]
    ["anonymous", undefined, 200, 401, 401],
    ["committee", cookieFor("committee"), 200, 200, 403],
    ["admin", cookieFor("admin"), 200, 200, 200],
  ];

  it.each(cases)("%s", async (_who, cookie, pub, staff, adminOnly) => {
    expect((await get("/public", cookie)).status).toBe(pub);
    expect((await get("/any-staff", cookie)).status).toBe(staff);
    expect((await get("/admin-only", cookie)).status).toBe(adminOnly);
  });

  it("treats a forged admin token (wrong signing key) as anonymous", async () => {
    const forged = jwt.sign({ role: "admin" }, "k".repeat(32), {
      subject: "507f1f77bcf86cd799439011",
    });
    expect((await get("/admin-only", `nb_access=${forged}`)).status).toBe(401);
  });

  it("ignores a role claimed anywhere other than the signed token", async () => {
    const res = await request(app)
      .get("/admin-only")
      .set("Cookie", cookieFor("committee"))
      .set("X-Role", "admin");
    expect(res.status).toBe(403);
  });
});
