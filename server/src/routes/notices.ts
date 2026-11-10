import { Router } from "express";
import { z } from "zod";
import { wrap } from "../lib/asyncHandler.js";
import { HttpError } from "../lib/errors.js";
import { objectIdSchema } from "../lib/objectId.js";
import { requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { NOTICE_STATUSES } from "../models/Notice.js";
import * as noticeService from "../services/noticeService.js";

const status = z.enum(NOTICE_STATUSES);
const fields = {
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(5000),
  categoryId: objectIdSchema,
  expiresAt: z
    .string()
    .datetime({ offset: true })
    .transform((s) => new Date(s))
    .nullable()
    .optional(),
};
const createSchema = z.object({ ...fields, status: status.default("draft") }).strict();
const updateSchema = z
  .object({ ...fields, status })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
const deleteQuery = z.object({ mode: z.enum(["archive", "delete"]).default("delete") }).strict();

// Unknown or malformed ids are plain "not found", never a 500.
const idParam = (id: string) => {
  if (!objectIdSchema.safeParse(id).success)
    throw new HttpError(404, "NOT_FOUND", "Notice not found");
  return id;
};

export function noticeRoutes() {
  const router = Router();
  const staff = requireRole("committee", "admin");

  router.get(
    "/:id",
    wrap(async (req, res) => {
      res.json({ notice: await noticeService.getNotice(idParam(req.params.id!), req.auth) });
    }),
  );

  router.post(
    "/",
    staff,
    validate(createSchema),
    wrap(async (req, res) => {
      res
        .status(201)
        .json({ notice: await noticeService.createNotice(req.auth!, req.body, req.ip) });
    }),
  );

  router.patch(
    "/:id",
    staff,
    validate(updateSchema),
    wrap(async (req, res) => {
      const id = idParam(req.params.id!);
      res.json({ notice: await noticeService.updateNotice(id, req.auth!, req.body, req.ip) });
    }),
  );

  router.delete(
    "/:id",
    staff,
    validate(deleteQuery, "query"),
    wrap(async (req, res) => {
      const id = idParam(req.params.id!);
      await noticeService.removeNotice(
        id,
        req.auth!,
        req.query.mode as "archive" | "delete",
        req.ip,
      );
      res.status(204).end();
    }),
  );

  return router;
}
