import type { ErrorRequestHandler, RequestHandler } from "express";
import { HttpError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
};

// Express recognises an error handler by its 4 arguments, so `_next` must stay.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res
      .status(err.status)
      .json({ error: { code: err.code, message: err.message, fields: err.fields } });
    return;
  }
  // Malformed JSON bodies surface as a body-parser error.
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: { code: "BAD_REQUEST", message: "Invalid JSON body" } });
    return;
  }
  // Upload problems raised by multer: too large is 413, anything else about the form is 400.
  if (err?.name === "MulterError") {
    const tooLarge = err.code === "LIMIT_FILE_SIZE";
    res.status(tooLarge ? 413 : 400).json({
      error: {
        code: tooLarge ? "FILE_TOO_LARGE" : "BAD_UPLOAD",
        message: tooLarge ? "File is too large" : "Invalid upload",
      },
    });
    return;
  }
  logger.error({ err }, "unhandled error");
  res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong" } });
};
