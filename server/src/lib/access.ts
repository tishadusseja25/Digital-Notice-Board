import type { Types } from "mongoose";
import type { Role } from "../models/User.js";

export type Caller = { id: string; role: Role };

/** Author or admin. This is the object-level check behind PRD Section 5 "Own only". */
export const canManage = (notice: { authorId: Types.ObjectId }, caller?: Caller) =>
  !!caller && (caller.role === "admin" || notice.authorId.toString() === caller.id);
