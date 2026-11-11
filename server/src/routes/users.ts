import { Router } from "express";
import { z } from "zod";
import type { Env } from "../config/env.js";
import { wrap } from "../lib/asyncHandler.js";
import { pageQuery } from "../lib/objectId.js";
import { requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { ROLES } from "../models/User.js";
import * as userService from "../services/userService.js";

const password = z.string().min(10).max(200);
const createSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    email: z.string().trim().toLowerCase().email().max(254),
    role: z.enum(ROLES),
    password,
  })
  .strict();
const patchSchema = z
  .object({ role: z.enum(ROLES), active: z.boolean(), password })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
const listQuery = z.object(pageQuery).strict();

export function userRoutes(env: Env) {
  const router = Router();
  router.use(requireRole("admin")); // every route in this file is admin-only

  router.get(
    "/",
    validate(listQuery, "query"),
    wrap(async (req, res) => {
      res.json(
        await userService.listUsers(req.query as unknown as { page: number; limit: number }),
      );
    }),
  );

  router.post(
    "/",
    validate(createSchema),
    wrap(async (req, res) => {
      res
        .status(201)
        .json({ user: await userService.createUser(req.auth!, req.body, env, req.ip) });
    }),
  );

  router.patch(
    "/:id",
    validate(patchSchema),
    wrap(async (req, res) => {
      res.json({
        user: await userService.updateUser(req.auth!, req.params.id!, req.body, env, req.ip),
      });
    }),
  );

  return router;
}
