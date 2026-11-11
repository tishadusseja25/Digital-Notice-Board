import { Router } from "express";
import { z } from "zod";
import { wrap } from "../lib/asyncHandler.js";
import { pageQuery } from "../lib/objectId.js";
import { requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { listAudit } from "../services/auditService.js";

const listQuery = z.object(pageQuery).strict();

// Read-only on purpose: there is no way to add, change or remove log entries through the API.
export function auditRoutes() {
  const router = Router();

  router.get(
    "/",
    requireRole("admin"),
    validate(listQuery, "query"),
    wrap(async (req, res) => {
      res.json(await listAudit(req.query as unknown as { page: number; limit: number }));
    }),
  );

  return router;
}
