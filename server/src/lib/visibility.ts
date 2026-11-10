import { trusted } from "mongoose";

/**
 * The one rule for what the public may see: published and not past its expiry date.
 * Every public query must start from this filter (PRD FR-14, FR-15, FR-17).
 */
export function publicNoticeFilter(now = new Date()) {
  return {
    status: "published",
    // `trusted` marks operators written by the server; user-supplied ones are neutralised.
    $or: [{ expiresAt: null }, { expiresAt: trusted({ $gt: now }) }],
  };
}

/** Same rule for a notice already loaded in memory. */
export function isPubliclyVisible(
  notice: { status: string; expiresAt?: Date | null },
  now = new Date(),
) {
  return notice.status === "published" && (!notice.expiresAt || notice.expiresAt > now);
}
