import { Router } from "express";
import { z } from "zod";
import { wrap } from "../lib/asyncHandler.js";
import { requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { Category } from "../models/Category.js";
import * as categoryService from "../services/categoryService.js";

const nameSchema = z.object({ name: z.string().trim().min(1).max(40) }).strict();

export function categoryRoutes() {
  const router = Router();
  const admin = requireRole("admin");

  // Public: the board filter and the notice form both need the list.
  router.get(
    "/",
    wrap(async (_req, res) => {
      const categories = await Category.find().sort({ name: 1 });
      res.json({ items: categories.map((c) => ({ id: c.id as string, name: c.name })) });
    }),
  );

  router.post(
    "/",
    admin,
    validate(nameSchema),
    wrap(async (req, res) => {
      const category = await categoryService.createCategory(req.auth!, req.body.name, req.ip);
      res.status(201).json({ category });
    }),
  );

  router.patch(
    "/:id",
    admin,
    validate(nameSchema),
    wrap(async (req, res) => {
      const category = await categoryService.renameCategory(
        req.auth!,
        req.params.id!,
        req.body.name,
        req.ip,
      );
      res.json({ category });
    }),
  );

  router.delete(
    "/:id",
    admin,
    wrap(async (req, res) => {
      await categoryService.deleteCategory(req.auth!, req.params.id!, req.ip);
      res.status(204).end();
    }),
  );

  return router;
}
