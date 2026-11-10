import { Router } from "express";
import { z } from "zod";
import type { Env } from "../config/env.js";
import { wrap } from "../lib/asyncHandler.js";
import { REFRESH_COOKIE, clearAuthCookies, setAuthCookies } from "../lib/cookies.js";
import { HttpError } from "../lib/errors.js";
import { requireRole } from "../middleware/auth.js";
import type { Limiters } from "../middleware/rateLimit.js";
import { validate } from "../middleware/validate.js";
import * as authService from "../services/authService.js";

const loginSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(1).max(200),
  })
  .strict();

const passwordSchema = z
  .object({ current: z.string().min(1).max(200), next: z.string().min(10).max(200) })
  .strict();

const refreshCookie = (cookies: Record<string, unknown> | undefined) => {
  const value = cookies?.[REFRESH_COOKIE];
  return typeof value === "string" ? value : undefined;
};

export function authRoutes(env: Env, limiters: Limiters) {
  const router = Router();

  router.post(
    "/login",
    validate(loginSchema),
    wrap(async (req, res) => {
      const { email, password } = req.body;
      // Failed attempts are counted per IP + email, so one attacker cannot lock out the real user.
      const key = `${req.ip}|${email}`;
      await limiters.login.check(key, res);
      let result;
      try {
        result = await authService.login(email, password, req.ip, env);
      } catch (err) {
        if (err instanceof HttpError && err.status === 401) await limiters.login.fail(key);
        throw err;
      }
      await limiters.login.reset(key);
      setAuthCookies(res, env, result.access, result.refresh);
      res.json({ user: result.user });
    }),
  );

  router.post(
    "/refresh",
    wrap(async (req, res) => {
      const token = refreshCookie(req.cookies);
      if (!token) throw new HttpError(401, "UNAUTHENTICATED", "Sign in required");
      try {
        const result = await authService.refresh(token, env);
        setAuthCookies(res, env, result.access, result.refresh);
        res.status(204).end();
      } catch (err) {
        clearAuthCookies(res, env);
        throw err;
      }
    }),
  );

  router.post(
    "/logout",
    wrap(async (req, res) => {
      await authService.logout(refreshCookie(req.cookies), env);
      clearAuthCookies(res, env);
      res.status(204).end();
    }),
  );

  router.get(
    "/me",
    requireRole("committee", "admin"),
    wrap(async (req, res) => {
      res.json({ user: await authService.me(req.auth!.id) });
    }),
  );

  router.post(
    "/password",
    requireRole("committee", "admin"),
    validate(passwordSchema),
    wrap(async (req, res) => {
      await authService.changePassword(
        req.auth!.id,
        req.body.current,
        req.body.next,
        refreshCookie(req.cookies),
        req.ip,
        env,
      );
      res.status(204).end();
    }),
  );

  return router;
}
