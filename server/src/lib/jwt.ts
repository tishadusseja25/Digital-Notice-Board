import { createHmac, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import type { Env } from "../config/env.js";
import type { Role } from "../models/User.js";

export function signAccessToken(userId: string, role: Role, env: Env) {
  return jwt.sign({ role }, env.JWT_ACCESS_SECRET, {
    subject: userId,
    expiresIn: `${env.ACCESS_TOKEN_MINUTES}m`,
    algorithm: "HS256",
  });
}

/** Returns the caller, or null for any bad, expired or tampered token. */
export function verifyAccessToken(token: string, env: Env): { id: string; role: Role } | null {
  try {
    // Pinning the algorithm blocks "alg: none" and key-confusion tricks.
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ["HS256"] });
    if (typeof payload === "string" || !payload.sub) return null;
    if (payload.role !== "committee" && payload.role !== "admin") return null;
    return { id: payload.sub, role: payload.role };
  } catch {
    return null;
  }
}

export const newRefreshToken = () => randomBytes(32).toString("base64url");

/** Only this hash is stored, so a database leak does not leak usable tokens. */
export const hashRefreshToken = (token: string, env: Env) =>
  createHmac("sha256", env.JWT_REFRESH_PEPPER).update(token).digest("hex");
