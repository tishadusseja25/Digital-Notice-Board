import { Schema, model } from "mongoose";

const auditLogSchema = new Schema({
  actorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  action: { type: String, required: true },
  targetType: { type: String },
  targetId: { type: Schema.Types.ObjectId },
  ip: { type: String },
  at: { type: Date, default: Date.now, index: { expireAfterSeconds: 365 * 24 * 60 * 60 } },
});

export const AuditLog = model("AuditLog", auditLogSchema);
