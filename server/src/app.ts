import cookieParser from "cookie-parser";
import express from "express";
import type { Env } from "./config/env.js";
import { authenticate } from "./middleware/auth.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { authRoutes } from "./routes/auth.js";
import { health } from "./routes/health.js";

export function createApp(env: Env) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());
  app.use(authenticate(env));
  app.use("/api/health", health);
  app.use("/api/auth", authRoutes(env));
  app.use("/api", notFound);
  app.use(errorHandler);
  return app;
}
