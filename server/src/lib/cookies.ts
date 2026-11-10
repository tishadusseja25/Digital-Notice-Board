import type { Response } from "express";
import type { Env } from "../config/env.js";

export const ACCESS_COOKIE = "nb_access";
export const REFRESH_COOKIE = "nb_refresh";
// The refresh cookie is only sent to the auth endpoints, never with ordinary API calls.
const REFRESH_PATH = "/api/auth";

const base = (env: Env) => ({
  httpOnly: true,
  sameSite: "strict" as const,
  secure: env.NODE_ENV === "production",
});

export function setAuthCookies(res: Response, env: Env, access: string, refresh: string) {
  res.cookie(ACCESS_COOKIE, access, {
    ...base(env),
    path: "/",
    maxAge: env.ACCESS_TOKEN_MINUTES * 60_000,
  });
  res.cookie(REFRESH_COOKIE, refresh, {
    ...base(env),
    path: REFRESH_PATH,
    maxAge: env.REFRESH_TOKEN_DAYS * 86_400_000,
  });
}

export function clearAuthCookies(res: Response, env: Env) {
  res.clearCookie(ACCESS_COOKIE, { ...base(env), path: "/" });
  res.clearCookie(REFRESH_COOKIE, { ...base(env), path: REFRESH_PATH });
}
