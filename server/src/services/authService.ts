import { randomUUID } from "node:crypto";
import { trusted } from "mongoose";
import type { Env } from "../config/env.js";
import { HttpError } from "../lib/errors.js";
import { hashRefreshToken, newRefreshToken, signAccessToken } from "../lib/jwt.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { RefreshToken } from "../models/RefreshToken.js";
import { User } from "../models/User.js";
import { audit } from "./auditService.js";

type UserLike = {
  _id: { toString(): string };
  name: string;
  email: string;
  role: "committee" | "admin";
  mustChangePassword?: boolean | null;
};

export const publicUser = (u: UserLike) => ({
  id: u._id.toString(),
  name: u.name,
  email: u.email,
  role: u.role,
  mustChangePassword: Boolean(u.mustChangePassword),
});

const INVALID = () => new HttpError(401, "INVALID_CREDENTIALS", "Invalid email or password");
const SESSION_EXPIRED = () => new HttpError(401, "SESSION_EXPIRED", "Please sign in again");

async function issueTokens(
  user: UserLike & { _id: unknown },
  env: Env,
  family: string = randomUUID(),
) {
  const refresh = newRefreshToken();
  await RefreshToken.create({
    userId: user._id,
    tokenHash: hashRefreshToken(refresh, env),
    family,
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 86_400_000),
  });
  return { access: signAccessToken(user._id.toString(), user.role, env), refresh };
}

// A real bcrypt hash compared against when the email is unknown, so "no such user" costs the
// same time as "wrong password" and response timing does not reveal which emails exist.
let dummyHash: Promise<string> | undefined;

export async function login(email: string, password: string, ip: string | undefined, env: Env) {
  const user = await User.findOne({ email });
  dummyHash ??= hashPassword("not-a-real-password", env.BCRYPT_COST);
  const ok = await verifyPassword(password, user?.passwordHash ?? (await dummyHash));
  if (!user || !user.active || !ok) {
    await audit({ action: "login.failure", ip });
    throw INVALID();
  }
  await audit({ actorId: user._id, action: "login.success", ip });
  return { user: publicUser(user), ...(await issueTokens(user, env)) };
}

export async function refresh(rawToken: string, env: Env) {
  const tokenHash = hashRefreshToken(rawToken, env);
  // Atomic: of two simultaneous refreshes with the same token, only one wins.
  const used = await RefreshToken.findOneAndUpdate(
    { tokenHash, revoked: false, expiresAt: trusted({ $gt: new Date() }) },
    { revoked: true },
  );
  if (!used) {
    // A token that exists but was already used was replayed or leaked: end every session of that user.
    const seen = await RefreshToken.findOne({ tokenHash });
    if (seen?.revoked) await RefreshToken.updateMany({ userId: seen.userId }, { revoked: true });
    throw SESSION_EXPIRED();
  }
  const user = await User.findById(used.userId);
  if (!user || !user.active) {
    await RefreshToken.updateMany({ userId: used.userId }, { revoked: true });
    throw SESSION_EXPIRED();
  }
  return { user: publicUser(user), ...(await issueTokens(user, env, used.family)) };
}

export async function logout(rawToken: string | undefined, env: Env) {
  if (rawToken) {
    await RefreshToken.updateOne({ tokenHash: hashRefreshToken(rawToken, env) }, { revoked: true });
  }
}

export async function me(userId: string) {
  const user = await User.findById(userId);
  if (!user || !user.active) throw new HttpError(401, "UNAUTHENTICATED", "Sign in required");
  return publicUser(user);
}

export async function changePassword(
  userId: string,
  current: string,
  next: string,
  currentRefreshToken: string | undefined,
  ip: string | undefined,
  env: Env,
) {
  const user = await User.findById(userId);
  if (!user || !user.active) throw new HttpError(401, "UNAUTHENTICATED", "Sign in required");
  if (!(await verifyPassword(current, user.passwordHash))) {
    throw new HttpError(400, "VALIDATION", "Invalid input", {
      current: "Current password is wrong",
    });
  }
  user.passwordHash = await hashPassword(next, env.BCRYPT_COST);
  user.mustChangePassword = false;
  await user.save();
  // Every other session ends; the one making this request keeps working.
  const keep = currentRefreshToken ? hashRefreshToken(currentRefreshToken, env) : "";
  await RefreshToken.updateMany(
    { userId: user._id, tokenHash: trusted({ $ne: keep }) },
    { revoked: true },
  );
  await audit({ actorId: user._id, action: "password.change", ip });
}
