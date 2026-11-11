import { createServer } from "node:http";
import path from "node:path";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "../server/src/app.js";
import type { Env } from "../server/src/config/env.js";
import { hashPassword } from "../server/src/lib/password.js";
import { Category } from "../server/src/models/Category.js";
import { User } from "../server/src/models/User.js";
import { attachSocket } from "../server/src/realtime/socket.js";
import { ORIGIN, PASSWORD, PORT, USERS } from "./helpers.js";

// The same pieces as production (website files, API, live updates, security headers) on a
// throwaway database. Start it with `npm run e2e`; it needs `npm run build` first.
const env: Env = {
  NODE_ENV: "production",
  PORT,
  APP_ORIGIN: ORIGIN,
  MONGODB_URI: "unused",
  JWT_ACCESS_SECRET: "e2e-access-secret-e2e-access-secret",
  JWT_REFRESH_PEPPER: "e2e-refresh-pepper-e2e-refresh-pepper",
  ACCESS_TOKEN_MINUTES: 15,
  REFRESH_TOKEN_DAYS: 7,
  BCRYPT_COST: 4,
  MAX_IMAGE_MB: 10,
  MAX_IMAGES_PER_NOTICE: 5,
  CLIENT_DIST: path.resolve("client/dist"),
};

const mongod = await MongoMemoryServer.create();
await mongoose.connect(mongod.getUri(), { dbName: "e2e" });
await Promise.all(Object.values(mongoose.models).map((m) => m.init()));

const passwordHash = await hashPassword(PASSWORD, env.BCRYPT_COST);
await User.create({
  ...USERS.committee,
  passwordHash,
  role: "committee",
  mustChangePassword: false,
});
await User.create({ ...USERS.admin, passwordHash, role: "admin", mustChangePassword: false });
await Category.create([{ name: "Exams" }, { name: "Events" }]);

const server = createServer(createApp(env));
attachSocket(server, env);
server.listen(PORT, () => console.log(`e2e server on ${ORIGIN}`));

const stop = async () => {
  server.close();
  await mongoose.disconnect();
  await mongod.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
