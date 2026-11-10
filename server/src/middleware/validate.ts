import type { RequestHandler } from "express";
import type { ZodTypeAny } from "zod";
import { HttpError } from "../lib/errors.js";

/** Replaces req[source] with the parsed (and stripped) data, or fails with field errors. */
export const validate =
  (schema: ZodTypeAny, source: "body" | "query" | "params" = "body"): RequestHandler =>
  (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const fields: Record<string, string> = {};
      for (const issue of result.error.issues) fields[issue.path.join(".") || "_"] = issue.message;
      return next(new HttpError(400, "VALIDATION", "Invalid input", fields));
    }
    req[source] = result.data;
    next();
  };
