import path from "node:path";
import cookieParser from "cookie-parser";
import express from "express";
import type { Env } from "./config/env.js";
import { authenticate } from "./middleware/auth.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { createRateLimiters } from "./middleware/rateLimit.js";
import { rejectOperatorKeys, requireSameOrigin } from "./middleware/security.js";
import { auditRoutes } from "./routes/audit.js";
import { authRoutes } from "./routes/auth.js";
import { categoryRoutes } from "./routes/categories.js";
import { health } from "./routes/health.js";
import { imageRoutes } from "./routes/images.js";
import { meRoutes } from "./routes/me.js";
import { noticeRoutes } from "./routes/notices.js";
import { userRoutes } from "./routes/users.js";

export function createApp(env: Env) {
  const app = express();
  const limiters = createRateLimiters();

  app.disable("x-powered-by");
  // Behind Render's single proxy, req.ip must be the visitor, not the proxy, or every visitor
  // would share one rate-limit bucket. Never trust forwarded headers when there is no proxy.
  if (env.NODE_ENV === "production") app.set("trust proxy", 1);

  // The website's files come before the read limiter: one page load fetches many small files and
  // must not use up a visitor's 120 reads per minute. Only set in the Docker image.
  const dist = env.CLIENT_DIST && path.resolve(env.CLIENT_DIST);
  if (dist) {
    // File names under /assets contain a content hash, so they can be cached for a year.
    app.use(
      "/assets",
      express.static(path.join(dist, "assets"), { immutable: true, maxAge: "1y" }),
    );
    app.use(express.static(dist, { index: false }));
  }

  app.use(limiters.publicReads);
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());
  app.use(rejectOperatorKeys);
  app.use(authenticate(env));
  app.use(requireSameOrigin(env));
  app.use(limiters.writes);

  app.use("/api/health", health);
  app.use("/api/auth", authRoutes(env, limiters));
  app.use("/api/notices", noticeRoutes(env));
  app.use("/api/images", imageRoutes(env));
  app.use("/api/me", meRoutes());
  app.use("/api/categories", categoryRoutes());
  app.use("/api/users", userRoutes(env));
  app.use("/api/audit", auditRoutes());
  app.use("/api", notFound);
  // Any other page address gets the app's start page, so refreshing /committee works.
  // index.html is never cached, so a new deploy is picked up at once.
  if (dist) {
    app.get(/^\/(?!api(\/|$)|socket\.io\/|assets\/)/, (_req, res) =>
      res.sendFile(path.join(dist, "index.html"), { headers: { "Cache-Control": "no-cache" } }),
    );
  }
  app.use(errorHandler);
  return app;
}
