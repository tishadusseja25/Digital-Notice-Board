import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import type { Env } from "../src/config/env.js";

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
