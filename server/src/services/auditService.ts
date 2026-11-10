import type { Types } from "mongoose";
import { logger } from "../lib/logger.js";
import { AuditLog } from "../models/AuditLog.js";

type Entry = {
  actorId?: Types.ObjectId | string | null;
  action: string;
  targetType?: string;
  targetId?: Types.ObjectId | string;
  ip?: string;
};

/** A failed audit write is logged but never blocks the user's request. */
export async function audit(entry: Entry) {
  try {
    await AuditLog.create(entry);
  } catch (err) {
    logger.error({ err, action: entry.action }, "audit write failed");
  }
}
