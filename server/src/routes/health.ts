import { Router } from "express";
import { isDbHealthy } from "../db.js";

export const health = Router();

// Docker and the host use this to decide whether the app is alive, so it must check the database.
health.get("/", async (_req, res) => {
  if (await isDbHealthy()) {
    res.json({ status: "ok" });
  } else {
    res.status(503).json({ status: "unavailable" });
  }
});
