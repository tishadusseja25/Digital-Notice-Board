import { loadEnv } from "../src/config/env.js";

const valid = {
  APP_ORIGIN: "http://localhost:5173",
  MONGODB_URI: "mongodb://localhost:27017/noticeboard",
  JWT_ACCESS_SECRET: "a".repeat(32),
  JWT_REFRESH_PEPPER: "b".repeat(32),
};

describe("loadEnv", () => {
  it("accepts a valid environment and applies defaults", () => {
    const env = loadEnv(valid);
    expect(env.PORT).toBe(4000);
    expect(env.ACCESS_TOKEN_MINUTES).toBe(15);
    expect(env.BCRYPT_COST).toBe(12);
  });

  it("stops with a clear message when a variable is missing", () => {
    expect(() => loadEnv({})).toThrow(/APP_ORIGIN/);
  });

  it("rejects secrets shorter than 32 characters", () => {
    expect(() => loadEnv({ ...valid, JWT_ACCESS_SECRET: "short" })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => loadEnv({ ...valid, JWT_REFRESH_PEPPER: "short" })).toThrow(/JWT_REFRESH_PEPPER/);
  });
});
