import type { RequestHandler } from "express";
import type { Env } from "../config/env.js";
import { HttpError } from "../lib/errors.js";
import { hasOperatorKeys } from "../lib/sanitize.js";

/** Operator injection guard: runs before any route sees body, query or params. */
export const rejectOperatorKeys: RequestHandler = (req, _res, next) => {
  if (hasOperatorKeys(req.body) || hasOperatorKeys(req.query) || hasOperatorKeys(req.params)) {
    return next(new HttpError(400, "VALIDATION", "Invalid input"));
  }
  next();
};

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF defence on top of SameSite=Strict cookies: every state-changing request must come from
 * the app's own origin. Browsers always send Origin on such requests; a missing one is refused.
 */
export const requireSameOrigin =
  (env: Env): RequestHandler =>
  (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    if (req.get("origin") !== env.APP_ORIGIN) {
      return next(new HttpError(403, "BAD_ORIGIN", "Request origin not allowed"));
    }
    next();
  };
