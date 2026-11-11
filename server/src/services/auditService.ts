import type { Types } from "mongoose";
import { logger } from "../lib/logger.js";
import { paged } from "../lib/objectId.js";
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

/** Newest first. The actor is filled in with one extra lookup per page, not per row. */
export async function listAudit(opts: { page: number; limit: number }) {
  const [docs, total] = await Promise.all([
    AuditLog.find()
      .sort({ at: -1 })
      .skip((opts.page - 1) * opts.limit)
      .limit(opts.limit)
      .populate("actorId", "name email"),
    AuditLog.countDocuments(),
  ]);
  const items = docs.map((d) => {
    const actor = d.actorId as unknown as {
      _id: Types.ObjectId;
      name: string;
      email: string;
    } | null;
    return {
      id: d.id as string,
      action: d.action,
      targetType: d.targetType ?? null,
      targetId: d.targetId?.toString() ?? null,
      ip: d.ip ?? null,
      at: d.at,
      actor: actor?.name
        ? { id: actor._id.toString(), name: actor.name, email: actor.email }
        : null,
    };
  });
  return paged(items, total, opts.page, opts.limit);
}
