import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { createApp } from "../src/app.js";
import { testEnv } from "./helpers.js";

const dist = mkdtempSync(path.join(tmpdir(), "nb-dist-"));
mkdirSync(path.join(dist, "assets"));
writeFileSync(path.join(dist, "index.html"), "<html>START PAGE</html>");
writeFileSync(path.join(dist, "favicon.svg"), "<svg/>");
writeFileSync(path.join(dist, "assets", "app-1a2b3c.js"), "console.log(1)");

const app = createApp({ ...testEnv, CLIENT_DIST: dist });

describe("serving the built website", () => {
  it("serves hashed assets with a one-year cache", async () => {
    const res = await request(app).get("/assets/app-1a2b3c.js");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toContain("max-age=31536000");
    expect(res.headers["cache-control"]).toContain("immutable");
  });

  it("serves the start page uncached at / and for any page address", async () => {
    for (const url of ["/", "/committee", "/notices/507f1f77bcf86cd799439011", "/admin/users"]) {
      const res = await request(app).get(url);
      expect(res.status).toBe(200);
      expect(res.text).toContain("START PAGE");
      expect(res.headers["cache-control"]).toBe("no-cache");
    }
  });

  it("serves other files from the folder, such as the icon", async () => {
    expect((await request(app).get("/favicon.svg")).body.toString()).toBe("<svg/>");
  });

  it("keeps API and missing-asset answers out of the fallback", async () => {
    const api = await request(app).get("/api/nope");
    expect(api.status).toBe(404);
    expect(api.body.error.code).toBe("NOT_FOUND");
    expect((await request(app).get("/api")).text).not.toContain("START PAGE");
    expect((await request(app).get("/assets/missing.js")).text).not.toContain("START PAGE");
    expect((await request(app).get("/socket.io/")).text).not.toContain("START PAGE");
  });

  it("does not count page files against the read limit", async () => {
    const limited = createApp({ ...testEnv, CLIENT_DIST: dist });
    for (let i = 0; i < 130; i++) await request(limited).get("/assets/app-1a2b3c.js").expect(200);
  });

  it("serves nothing when CLIENT_DIST is unset", async () => {
    const res = await request(createApp(testEnv)).get("/committee");
    expect(res.status).toBe(404);
  });
});
