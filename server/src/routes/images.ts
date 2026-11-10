import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import type { Env } from "../config/env.js";
import { wrap } from "../lib/asyncHandler.js";
import { HttpError } from "../lib/errors.js";
import { requireRole } from "../middleware/auth.js";
import * as imageService from "../services/imageService.js";

const altSchema = z.string().trim().min(1).max(120);

export function imageRoutes(env: Env) {
  const router = Router();
  const staff = requireRole("committee", "admin");
  // Memory storage is fine for a hard cap of MAX_IMAGE_MB per request; multer aborts past the cap.
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: env.MAX_IMAGE_MB * 1024 * 1024, files: 1, fields: 4, parts: 6 },
  });

  // Role check first so anonymous callers are rejected before any bytes are buffered.
  router.post(
    "/",
    staff,
    upload.single("file"),
    wrap(async (req, res) => {
      const alt = altSchema.safeParse(req.body?.alt);
      const fieldErrors: Record<string, string> = {};
      if (!req.file) fieldErrors.file = "An image file is required";
      if (!alt.success) fieldErrors.alt = "Alt text is required (1 to 120 characters)";
      if (!req.file || !alt.success) {
        throw new HttpError(400, "VALIDATION", "Invalid input", fieldErrors);
      }
      const image = await imageService.uploadImage(req.file.buffer, alt.data, req.auth!, req.ip);
      res.status(201).json(image);
    }),
  );

  router.get(
    "/:id",
    wrap(async (req, res) => {
      await imageService.sendImage(req.params.id!, req.auth, req.get("if-none-match"), res);
    }),
  );

  router.delete(
    "/:id",
    staff,
    wrap(async (req, res) => {
      await imageService.deleteImage(req.params.id!, req.auth!, req.ip);
      res.status(204).end();
    }),
  );

  return router;
}
