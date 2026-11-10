import type { RequestHandler } from "express";
import type { Env } from "../config/env.js";
import { ACCESS_COOKIE } from "../lib/cookies.js";
import { HttpError } from "../lib/errors.js";
import { verifyAccessToken } from "../lib/jwt.js";
import type { Role } from "../models/User.js";

/** Sets req.auth when the access cookie is valid. Never rejects: public routes use this too. */
export const authenticate =
  (env: Env): RequestHandler =>
  (req, _res, next) => {
    const token = req.cookies?.[ACCESS_COOKIE];
    if (typeof token === "string") {
      const caller = verifyAccessToken(token, env);
      if (caller) req.auth = caller;
    }
    next();
  };

/** 401 when nobody is signed in, 403 when the role is not allowed. Deny by default. */
export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.auth) return next(new HttpError(401, "UNAUTHENTICATED", "Sign in required"));
    if (!roles.includes(req.auth.role)) return next(new HttpError(403, "FORBIDDEN", "Not allowed"));
    next();
  };
