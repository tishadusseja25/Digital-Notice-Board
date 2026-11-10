import { Schema, model } from "mongoose";

const refreshTokenSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  family: { type: String, required: true },
  revoked: { type: Boolean, default: false },
  // TTL index: MongoDB deletes the document itself once this date has passed (checked about every 60 s).
  expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
});

export const RefreshToken = model("RefreshToken", refreshTokenSchema);
