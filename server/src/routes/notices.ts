import { Router } from "express";
import { z } from "zod";
import type { Env } from "../config/env.js";
import { wrap } from "../lib/asyncHandler.js";
import { HttpError } from "../lib/errors.js";
import { objectIdSchema, pageQuery } from "../lib/objectId.js";
import { requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { NOTICE_STATUSES } from "../models/Notice.js";
import * as noticeService from "../services/noticeService.js";

const status = z.enum(NOTICE_STATUSES);
const imageRef = z
  .object({ fileId: objectIdSchema, alt: z.string().trim().min(1).max(120) })
  .strict();
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
  // Hard ceiling; the configured MAX_IMAGES_PER_NOTICE is enforced in the service.
  images: z.array(imageRef).max(10).optional(),
};
const createSchema = z.object({ ...fields, status: status.default("draft") }).strict();
const updateSchema = z
  .object({ ...fields, status })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
// Dates may be a day (2026-11-10, from = start of that day, to = end of it, UTC) or a full timestamp.
const day = /^\d{4}-\d{2}-\d{2}$/;
const dateParam = (end: boolean) =>
  z
    .string()
    .refine(
      (v) => day.test(v) || z.string().datetime({ offset: true }).safeParse(v).success,
      "Invalid date",
    )
    .transform((v) => new Date(day.test(v) ? `${v}T${end ? "23:59:59.999" : "00:00:00.000"}Z` : v))
    .refine((d) => !Number.isNaN(d.getTime()), "Invalid date");
const listQuery = z
  .object({
    q: z.string().trim().min(1).max(100).optional(),
    category: objectIdSchema.optional(),
    from: dateParam(false).optional(),
    to: dateParam(true).optional(),
    ...pageQuery,
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: "from must not be after to",
    path: ["from"],
  });
const deleteQuery = z.object({ mode: z.enum(["archive", "delete"]).default("delete") }).strict();

// Unknown or malformed ids are plain "not found", never a 500.
const idParam = (id: string) => {
  if (!objectIdSchema.safeParse(id).success)
    throw new HttpError(404, "NOT_FOUND", "Notice not found");
  return id;
};

export function noticeRoutes(env: Env) {
  const router = Router();
  const staff = requireRole("committee", "admin");

  // Public: anyone may read the board.
  router.get(
    "/",
    validate(listQuery, "query"),
    wrap(async (req, res) => {
      res.json(
        await noticeService.listPublic(req.query as unknown as noticeService.PublicListOptions),
      );
    }),
  );

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
      const notice = await noticeService.createNotice(req.auth!, req.body, env, req.ip);
      res.status(201).json({ notice });
    }),
  );

  router.patch(
    "/:id",
    staff,
    validate(updateSchema),
    wrap(async (req, res) => {
      const id = idParam(req.params.id!);
      res.json({ notice: await noticeService.updateNotice(id, req.auth!, req.body, env, req.ip) });
    }),
  );

  router.delete(
    "/:id",
    staff,
    validate(deleteQuery, "query"),
    wrap(async (req, res) => {
      const id = idParam(req.params.id!);
      const mode = req.query.mode as "archive" | "delete";
      await noticeService.removeNotice(id, req.auth!, mode, req.ip);
      res.status(204).end();
    }),
  );

  return router;
}
