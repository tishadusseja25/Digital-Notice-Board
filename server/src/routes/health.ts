import { Router } from "express";

export const health = Router();

// M2 adds a database ping here; until a connection exists this only proves the process is up.
health.get("/", (_req, res) => {
  res.json({ status: "ok" });
});
