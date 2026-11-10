import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { connectDb } from "./db.js";
import { logger } from "./lib/logger.js";

const env = loadEnv();
await connectDb(env.MONGODB_URI);
createApp().listen(env.PORT, () => logger.info(`server listening on port ${env.PORT}`));
