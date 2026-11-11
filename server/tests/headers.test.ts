import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { createApp } from "../src/app.js";
import { testEnv } from "./helpers.js";

const dist = mkdtempSync(path.join(tmpdir(), "nb-hdr-"));
writeFileSync(path.join(dist, "index.html"), "<html></html>");

describe("security headers", () => {
  const app = createApp({ ...testEnv, CLIENT_DIST: dist });

  it("sends the safety headers on API answers, errors and pages", async () => {
    for (const url of ["/api/health", "/api/nope", "/committee", "/"]) {
      const h = (await request(app).get(url)).headers;
      expect(h["x-content-type-options"]).toBe("nosniff");
      expect(h["x-frame-options"]).toBe("DENY");
      expect(h["referrer-policy"]).toBeDefined();
      expect(h["content-security-policy"]).toBeDefined();
      expect(h["x-powered-by"]).toBeUndefined();
    }
  });

  it("allows only the app's own files, its own socket, and no framing", async () => {
    const csp = (await request(app).get("/")).headers["content-security-policy"] as string;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self' ws://localhost:5173");
    expect(csp).toContain("img-src 'self' data:");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|script-src[^;]*\*/);
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  it("uses wss for an https origin", async () => {
    const secure = createApp({ ...testEnv, APP_ORIGIN: "https://board.example.com" });
    const csp = (await request(secure).get("/api/health")).headers["content-security-policy"];
    expect(csp).toContain("wss://board.example.com");
  });

  it("turns HSTS on only in production", async () => {
    expect((await request(app).get("/api/health")).headers["strict-transport-security"]).toBe(
      undefined,
    );
    const prod = createApp({ ...testEnv, NODE_ENV: "production" });
    expect((await request(prod).get("/api/health")).headers["strict-transport-security"]).toMatch(
      /max-age=/,
    );
  });
});
