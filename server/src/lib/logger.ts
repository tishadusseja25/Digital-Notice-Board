import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
  // Never write credentials or tokens to logs.
  redact: ["req.headers.authorization", "req.headers.cookie", "password", "token"],
});
