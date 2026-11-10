import { Router } from "express";
import { wrap } from "../lib/asyncHandler.js";
import { Category } from "../models/Category.js";

// Read-only and public: the board filter and the notice form both need the list. Editing is M5.
export function categoryRoutes() {
  const router = Router();

  router.get(
    "/",
    wrap(async (_req, res) => {
      const categories = await Category.find().sort({ name: 1 });
      res.json({ items: categories.map((c) => ({ id: c.id as string, name: c.name })) });
    }),
  );

  return router;
}
