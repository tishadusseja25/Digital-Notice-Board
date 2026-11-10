import { Router } from "express";
import { z } from "zod";
import { wrap } from "../lib/asyncHandler.js";
import { pageQuery } from "../lib/objectId.js";
import { requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { NOTICE_STATUSES } from "../models/Notice.js";
import * as noticeService from "../services/noticeService.js";

const mineQuery = z.object({ status: z.enum(NOTICE_STATUSES).optional(), ...pageQuery }).strict();

export function meRoutes() {
  const router = Router();

  router.get(
    "/notices",
    requireRole("committee", "admin"),
    validate(mineQuery, "query"),
    wrap(async (req, res) => {
      const q = req.query as unknown as z.infer<typeof mineQuery>;
      res.json(await noticeService.listMine(req.auth!, q));
    }),
  );

  return router;
}
