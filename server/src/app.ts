import cookieParser from "cookie-parser";
import express from "express";
import type { Env } from "./config/env.js";
import { authenticate } from "./middleware/auth.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { createRateLimiters } from "./middleware/rateLimit.js";
import { rejectOperatorKeys, requireSameOrigin } from "./middleware/security.js";
import { authRoutes } from "./routes/auth.js";
import { categoryRoutes } from "./routes/categories.js";
import { health } from "./routes/health.js";
import { meRoutes } from "./routes/me.js";
import { noticeRoutes } from "./routes/notices.js";

export function createApp(env: Env) {
  const app = express();
  const limiters = createRateLimiters();

  app.disable("x-powered-by");
  // Behind Render's single proxy, req.ip must be the visitor, not the proxy, or every visitor
  // would share one rate-limit bucket. Never trust forwarded headers when there is no proxy.
  if (env.NODE_ENV === "production") app.set("trust proxy", 1);

  app.use(limiters.publicReads);
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());
  app.use(rejectOperatorKeys);
  app.use(authenticate(env));
  app.use(requireSameOrigin(env));
  app.use(limiters.writes);

  app.use("/api/health", health);
  app.use("/api/auth", authRoutes(env, limiters));
  app.use("/api/notices", noticeRoutes());
  app.use("/api/me", meRoutes());
  app.use("/api/categories", categoryRoutes());
  app.use("/api", notFound);
  app.use(errorHandler);
  return app;
}
