import type { RequestHandler, Response } from "express";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { HttpError } from "../lib/errors.js";

// Limits from PRD FR-01 and FR-21. Counters live in memory: they reset on restart and are not
// shared between server copies (fine for one instance; move to Redis if the app is scaled out).
export const LIMITS = {
  publicReadsPerMinute: 120,
  writesPerMinute: 30,
  loginFailures: 5,
  loginWindowSeconds: 15 * 60,
};

const tooMany = (msBeforeNext: number) => {
  const err = new HttpError(429, "RATE_LIMITED", "Too many requests, try again later");
  return Object.assign(err, { retryAfterSeconds: Math.max(1, Math.ceil(msBeforeNext / 1000)) });
};

const reject = (res: Response, err: ReturnType<typeof tooMany>) => {
  res.set("Retry-After", String(err.retryAfterSeconds));
  return err;
};

/** Creates fresh counters; call once per app so tests do not share state. */
export function createRateLimiters() {
  const reads = new RateLimiterMemory({ points: LIMITS.publicReadsPerMinute, duration: 60 });
  const writes = new RateLimiterMemory({ points: LIMITS.writesPerMinute, duration: 60 });
  const logins = new RateLimiterMemory({
    points: LIMITS.loginFailures,
    duration: LIMITS.loginWindowSeconds,
  });

  const perRequest =
    (limiter: RateLimiterMemory, safe: boolean): RequestHandler =>
    async (req, res, next) => {
      const isRead = req.method === "GET" || req.method === "HEAD";
      if (isRead !== safe) return next();
      // Writes are counted per signed-in user, otherwise per IP.
      const key = !safe && req.auth ? `user:${req.auth.id}` : `ip:${req.ip}`;
      try {
        await limiter.consume(key);
        next();
      } catch (rejected) {
        next(reject(res, tooMany((rejected as { msBeforeNext: number }).msBeforeNext)));
      }
    };

  return {
    /** GET/HEAD requests, per IP. */
    publicReads: perRequest(reads, true),
    /** All other requests, per user (or IP when anonymous). Run after authenticate(). */
    writes: perRequest(writes, false),
    login: {
      /** Throws 429 when this IP+email already used up its failed attempts. */
      async check(key: string, res: Response) {
        const state = await logins.get(key);
        if (state && state.remainingPoints <= 0) throw reject(res, tooMany(state.msBeforeNext));
      },
      /** Counts one failed attempt. */
      async fail(key: string) {
        await logins.consume(key).catch(() => undefined);
      },
      /** A successful login clears the counter. */
      async reset(key: string) {
        await logins.delete(key);
      },
    },
  };
}

export type Limiters = ReturnType<typeof createRateLimiters>;
