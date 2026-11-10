import mongoose from "mongoose";
import request from "supertest";
import { randomUUID } from "node:crypto";
import type { Env } from "../src/config/env.js";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/lib/password.js";
import { User, type Role } from "../src/models/User.js";

export const testEnv: Env = {
  NODE_ENV: "test",
  PORT: 4000,
  APP_ORIGIN: "http://localhost:5173",
  MONGODB_URI: "unused-in-tests",
  JWT_ACCESS_SECRET: "test-access-secret-test-access-secret",
  JWT_REFRESH_PEPPER: "test-refresh-pepper-test-refresh-pepper",
  ACCESS_TOKEN_MINUTES: 15,
  REFRESH_TOKEN_DAYS: 7,
  BCRYPT_COST: 4, // minimum cost keeps tests fast; production uses 12
};

export const PASSWORD = "correct-horse-battery";

/** Connects this test file to its own database inside the shared in-memory MongoDB. */
export async function connectTestDb() {
  await mongoose.connect(process.env.TEST_MONGO_URI!, { dbName: `t_${randomUUID().slice(0, 8)}` });
}

export async function clearTestDb() {
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
}

export async function disconnectTestDb() {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}

/** A supertest agent: keeps cookies between calls and always sends the app's own Origin. */
export const makeAgent = () => request.agent(createApp(testEnv)).set("Origin", testEnv.APP_ORIGIN);

export async function createUser(email: string, role: Role = "committee", active = true) {
  return User.create({
    name: email.split("@")[0],
    email,
    passwordHash: await hashPassword(PASSWORD, testEnv.BCRYPT_COST),
    role,
    active,
    mustChangePassword: false,
  });
}

/** Pulls one cookie value out of a response's Set-Cookie headers. */
export function cookieValue(res: { headers: Record<string, unknown> }, name: string) {
  const list = (res.headers["set-cookie"] ?? []) as string[];
  const hit = list.find((c) => c.startsWith(`${name}=`));
  return hit?.split(";")[0]?.slice(name.length + 1);
}
