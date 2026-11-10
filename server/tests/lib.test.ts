import jwt from "jsonwebtoken";
import {
  hashRefreshToken,
  newRefreshToken,
  signAccessToken,
  verifyAccessToken,
} from "../src/lib/jwt.js";
import { hashPassword, verifyPassword } from "../src/lib/password.js";
import { testEnv } from "./helpers.js";

describe("passwords", () => {
  it("hashes without storing the plain text and verifies correctly", async () => {
    const hash = await hashPassword("secret-password", 4);
    expect(hash).not.toContain("secret-password");
    expect(await verifyPassword("secret-password", hash)).toBe(true);
    expect(await verifyPassword("other-password", hash)).toBe(false);
  });
});

describe("access tokens", () => {
  it("round-trips the user id and role", () => {
    const token = signAccessToken("abc123", "admin", testEnv);
    expect(verifyAccessToken(token, testEnv)).toEqual({ id: "abc123", role: "admin" });
  });

  it("rejects tampered, wrongly signed, expired and unsigned tokens", () => {
    const good = signAccessToken("abc123", "admin", testEnv);
    const tampered = good.slice(0, -2) + (good.endsWith("aa") ? "bb" : "aa");
    const wrongKey = jwt.sign({ role: "admin" }, "x".repeat(32), { subject: "abc123" });
    const expired = jwt.sign({ role: "admin" }, testEnv.JWT_ACCESS_SECRET, {
      subject: "abc123",
      expiresIn: -10,
    });
    const unsigned = jwt.sign({ role: "admin", sub: "abc123" }, "", { algorithm: "none" });
    for (const token of [tampered, wrongKey, expired, unsigned, "garbage"]) {
      expect(verifyAccessToken(token, testEnv)).toBeNull();
    }
  });

  it("rejects a token with an unknown role", () => {
    const token = jwt.sign({ role: "root" }, testEnv.JWT_ACCESS_SECRET, { subject: "abc123" });
    expect(verifyAccessToken(token, testEnv)).toBeNull();
  });
});

describe("refresh tokens", () => {
  it("are random and hash consistently, but differently per pepper", () => {
    const a = newRefreshToken();
    expect(a).not.toBe(newRefreshToken());
    expect(hashRefreshToken(a, testEnv)).toBe(hashRefreshToken(a, testEnv));
    const otherPepper = { ...testEnv, JWT_REFRESH_PEPPER: "z".repeat(32) };
    expect(hashRefreshToken(a, otherPepper)).not.toBe(hashRefreshToken(a, testEnv));
  });
});
