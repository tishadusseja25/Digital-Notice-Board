import { createServer } from "node:http";
import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { connectDb } from "./db.js";
import { logger } from "./lib/logger.js";
import { attachSocket } from "./realtime/socket.js";

const env = loadEnv();
await connectDb(env.MONGODB_URI);
const server = createServer(createApp(env));
attachSocket(server, env);
server.listen(env.PORT, () => logger.info(`server listening on port ${env.PORT}`));
