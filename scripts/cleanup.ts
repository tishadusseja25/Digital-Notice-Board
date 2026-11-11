import { pathToFileURL } from "node:url";
import mongoose, { trusted } from "mongoose";
import { Notice } from "../server/src/models/Notice.js";
import { deleteFiles } from "../server/src/services/imageService.js";

const DAY = 86_400_000;
export const EXPIRED_KEEP_DAYS = 365; // PRD: expired notices are kept (hidden) for one year
export const UNATTACHED_KEEP_HOURS = 24; // grace time for someone still filling in the form

/**
 * Removes (1) notices that expired more than a year ago, with their images, and
 * (2) uploaded images that never got attached to a notice and are older than a day.
 * Safe to run twice. With dryRun nothing is deleted; the counts say what would be.
 */
export async function cleanup({ now = new Date(), dryRun = false } = {}) {
  let notices = 0;
  let noticeImages = 0;
  const expiredBefore = new Date(now.getTime() - EXPIRED_KEEP_DAYS * DAY);
  // One notice at a time keeps memory flat however many there are.
  const old = Notice.find({ expiresAt: trusted({ $lt: expiredBefore }) }).cursor();
  for await (const notice of old) {
    notices++;
    noticeImages += notice.images.length;
    if (!dryRun) {
      await deleteFiles(notice.images.map((i) => i.fileId));
      await notice.deleteOne();
    }
  }

  const files = mongoose.connection.db!.collection("images.files");
  const unusedBefore = new Date(now.getTime() - UNATTACHED_KEEP_HOURS * 3_600_000);
  // `null` also matches files whose noticeId field is missing.
  const unused = await files
    .find(
      { "metadata.noticeId": null, uploadDate: { $lt: unusedBefore } },
      { projection: { _id: 1 } },
    )
    .toArray();
  if (!dryRun) await deleteFiles(unused.map((f) => f._id));

  return { notices, noticeImages, unattachedImages: unused.length, dryRun };
}

async function main() {
  const { MONGODB_URI } = process.env;
  if (!MONGODB_URI) throw new Error("Set MONGODB_URI");
  const dryRun = process.argv.includes("--dry-run");
  await mongoose.connect(MONGODB_URI);
  const r = await cleanup({ dryRun });
  console.log(
    `${dryRun ? "Would remove" : "Removed"}: ${r.notices} old notices (${r.noticeImages} images), ` +
      `${r.unattachedImages} unattached images.`,
  );
  await mongoose.disconnect();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
