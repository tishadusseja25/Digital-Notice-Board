import type { Env } from "../config/env.js";
import type { Caller } from "../lib/access.js";
import { HttpError } from "../lib/errors.js";
import { isObjectId, paged } from "../lib/objectId.js";
import { hashPassword } from "../lib/password.js";
import { RefreshToken } from "../models/RefreshToken.js";
import { User, type Role } from "../models/User.js";
import { audit } from "./auditService.js";

type UserLike = {
  _id: { toString(): string };
  name: string;
  email: string;
  role: Role;
  active: boolean;
  mustChangePassword?: boolean | null;
  createdAt?: Date;
};

/** The only shape in which users leave the server: never password or token hashes. */
export const adminUserDto = (u: UserLike) => ({
  id: u._id.toString(),
  name: u.name,
  email: u.email,
  role: u.role,
  active: u.active,
  mustChangePassword: Boolean(u.mustChangePassword),
  createdAt: u.createdAt ?? null,
});

export async function listUsers(opts: { page: number; limit: number }) {
  const [docs, total] = await Promise.all([
    User.find()
      .sort({ createdAt: -1 })
      .skip((opts.page - 1) * opts.limit)
      .limit(opts.limit),
    User.countDocuments(),
  ]);
  return paged(docs.map(adminUserDto), total, opts.page, opts.limit);
}

export type NewUser = { name: string; email: string; role: Role; password: string };

export async function createUser(caller: Caller, input: NewUser, env: Env, ip?: string) {
  const passwordHash = await hashPassword(input.password, env.BCRYPT_COST);
  try {
    const user = await User.create({
      name: input.name,
      email: input.email,
      role: input.role,
      passwordHash,
      mustChangePassword: true, // the person must replace the temporary password at first sign-in
    });
    await audit({
      actorId: caller.id,
      action: "user.create",
      targetType: "user",
      targetId: user._id,
      ip,
    });
    return adminUserDto(user);
  } catch (err) {
    // 11000 = duplicate key: the unique index on email.
    if ((err as { code?: number }).code === 11000) {
      throw new HttpError(409, "CONFLICT", "Invalid input", {
        email: "That email is already in use",
      });
    }
    throw err;
  }
}

export type UserPatch = { role?: Role; active?: boolean; password?: string };

export async function updateUser(
  caller: Caller,
  id: string,
  patch: UserPatch,
  env: Env,
  ip?: string,
) {
  const user = isObjectId(id) ? await User.findById(id) : null;
  if (!user) throw new HttpError(404, "NOT_FOUND", "User not found");
  // An admin cannot demote, disable or reset themselves, so the system always keeps an admin who can act.
  if (user.id === caller.id) {
    throw new HttpError(
      409,
      "CANNOT_CHANGE_SELF",
      "You cannot change your own role, status or password here",
    );
  }

  const log = (action: string) =>
    audit({ actorId: caller.id, action, targetType: "user", targetId: user._id, ip });
  const actions: string[] = [];
  let endSessions = false;

  if (patch.role !== undefined && patch.role !== user.role) {
    user.role = patch.role;
    actions.push("user.role");
  }
  if (patch.active !== undefined && patch.active !== user.active) {
    user.active = patch.active;
    actions.push(patch.active ? "user.enable" : "user.disable");
    if (!patch.active) endSessions = true;
  }
  if (patch.password !== undefined) {
    user.passwordHash = await hashPassword(patch.password, env.BCRYPT_COST);
    user.mustChangePassword = true;
    actions.push("user.reset_password");
    endSessions = true;
  }

  await user.save();
  // Refresh tokens are the long-lived part of a login; revoking them ends every session of this user.
  if (endSessions) await RefreshToken.updateMany({ userId: user._id }, { revoked: true });
  for (const action of actions) await log(action);
  return adminUserDto(user);
}
