import path from "node:path";
import cookieParser from "cookie-parser";
import express from "express";
import helmet from "helmet";
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

  // Safe-by-default headers on every answer. The client has no inline scripts or styles, so the
  // policy allows only the app's own files. WebSocket addresses are spelled out because some
  // browsers do not count 'self' as covering ws/wss.
  const origin = new URL(env.APP_ORIGIN);
  const socketOrigin = `${origin.protocol === "https:" ? "wss" : "ws"}://${origin.host}`;
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "default-src": ["'self'"],
          "script-src": ["'self'"],
          // Helmet's default would also allow inline styles; the built page uses none.
          "style-src": ["'self'"],
          "font-src": ["'self'"],
          "img-src": ["'self'", "data:"],
          "connect-src": ["'self'", socketOrigin],
          "object-src": ["'none'"],
          "frame-ancestors": ["'none'"],
          "base-uri": ["'self'"],
          "form-action": ["'self'"],
          // Off on purpose: on plain http://localhost (the Docker demo) it would make the browser
          // fetch scripts over https and break the page. Render's HSTS covers the real site.
          "upgrade-insecure-requests": null,
        },
      },
      hsts: env.NODE_ENV === "production",
      frameguard: { action: "deny" },
    }),
  );
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
