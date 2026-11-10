import { createHash, randomUUID } from "node:crypto";
import type { Response } from "express";
import { fileTypeFromBuffer } from "file-type";
import mongoose, { Types } from "mongoose";
import { canManage, type Caller } from "../lib/access.js";
import { HttpError } from "../lib/errors.js";
import { isObjectId } from "../lib/objectId.js";
import { isPubliclyVisible } from "../lib/visibility.js";
import { Notice } from "../models/Notice.js";
import { audit } from "./auditService.js";

const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const bucket = () =>
  new mongoose.mongo.GridFSBucket(mongoose.connection.db!, { bucketName: "images" });
const files = () => mongoose.connection.db!.collection("images.files");

type ImageMeta = {
  uploaderId: string;
  contentType: string;
  sha256: string;
  alt: string;
  noticeId: Types.ObjectId | null;
};
type ImageFile = { _id: Types.ObjectId; length: number; metadata: ImageMeta };

const notFound = () => new HttpError(404, "NOT_FOUND", "Image not found");

async function findFile(id: string): Promise<ImageFile | null> {
  if (!isObjectId(id)) return null;
  return (await files().findOne({ _id: new Types.ObjectId(id) })) as ImageFile | null;
}

/**
 * Stores the upload exactly as received. The type comes from the file's own bytes, never from the
 * name or the Content-Type header the client sent. Nothing re-encodes or resizes the image.
 */
export async function uploadImage(file: Buffer, alt: string, caller: Caller, ip?: string) {
  const detected = await fileTypeFromBuffer(file);
  if (!detected || !ALLOWED[detected.mime]) {
    throw new HttpError(400, "VALIDATION", "Invalid input", {
      file: "Only JPEG, PNG or WebP images",
    });
  }
  const sha256 = createHash("sha256").update(file).digest("hex");
  const meta: ImageMeta = {
    uploaderId: caller.id,
    contentType: detected.mime,
    sha256,
    alt,
    noticeId: null,
  };
  const stream = bucket().openUploadStream(`${randomUUID()}.${ALLOWED[detected.mime]}`, {
    metadata: meta,
  });
  await new Promise<void>((resolve, reject) => {
    stream.once("finish", () => resolve()).once("error", reject);
    stream.end(file);
  });
  await audit({
    actorId: caller.id,
    action: "image.upload",
    targetType: "image",
    targetId: stream.id,
    ip,
  });
  return { fileId: stream.id.toString(), alt };
}

/** Streams the stored bytes back unchanged. Who may read depends on the notice the image is on. */
export async function sendImage(
  id: string,
  caller: Caller | undefined,
  ifNoneMatch: string | undefined,
  res: Response,
) {
  const file = await findFile(id);
  if (!file) throw notFound();
  const { noticeId, uploaderId, contentType, sha256 } = file.metadata;

  let isPublic = false;
  if (noticeId) {
    const notice = await Notice.findById(noticeId);
    if (!notice) throw notFound();
    isPublic = isPubliclyVisible(notice);
    if (!isPublic && !canManage(notice, caller)) throw notFound();
  } else if (!caller || (caller.role !== "admin" && caller.id !== uploaderId)) {
    throw notFound(); // not attached to a notice yet: only the uploader and admins
  }

  const etag = `"${sha256}"`;
  res.set({
    "Content-Type": contentType,
    "Content-Length": String(file.length),
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": "inline",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    ETag: etag,
    // The id never maps to different bytes, so public images can be cached for a year.
    "Cache-Control": isPublic ? "public, max-age=31536000, immutable" : "private, no-cache",
  });
  if (ifNoneMatch === etag) {
    res.status(304).end();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const download = bucket().openDownloadStream(file._id);
    download.once("error", reject);
    res.once("close", resolve);
    download.pipe(res);
  });
}

export async function deleteImage(id: string, caller: Caller, ip?: string) {
  const file = await findFile(id);
  if (!file) throw notFound();
  const { noticeId, uploaderId } = file.metadata;
  const notice = noticeId ? await Notice.findById(noticeId) : null;
  const allowed =
    caller.role === "admin" || caller.id === uploaderId || (notice && canManage(notice, caller));
  if (!allowed) throw new HttpError(403, "FORBIDDEN", "Not allowed");
  if (notice)
    await Notice.updateOne({ _id: notice._id }, { $pull: { images: { fileId: file._id } } });
  await bucket().delete(file._id);
  await audit({
    actorId: caller.id,
    action: "image.delete",
    targetType: "image",
    targetId: file._id,
    ip,
  });
}

export type ImageRef = { fileId: string; alt: string };

/** Checks the images a notice wants to carry: they exist, are the caller's, and are free to attach. */
export async function checkAttachable(
  refs: ImageRef[],
  caller: Caller,
  noticeId: Types.ObjectId | null,
  max: number,
) {
  const bad = (message: string) =>
    new HttpError(400, "VALIDATION", "Invalid input", { images: message });
  if (refs.length > max) throw bad(`At most ${max} images per notice`);
  if (new Set(refs.map((r) => r.fileId)).size !== refs.length) throw bad("Duplicate image");
  for (const ref of refs) {
    const file = await findFile(ref.fileId);
    if (!file) throw bad("Unknown image");
    if (caller.role !== "admin" && file.metadata.uploaderId !== caller.id)
      throw bad("Image belongs to another user");
    const owner = file.metadata.noticeId;
    if (owner && !(noticeId && owner.equals(noticeId)))
      throw bad("Image is already used by another notice");
  }
}

export async function attachImages(fileIds: string[], noticeId: Types.ObjectId) {
  if (fileIds.length === 0) return;
  await files().updateMany(
    { _id: { $in: fileIds.map((id) => new Types.ObjectId(id)) } },
    { $set: { "metadata.noticeId": noticeId } },
  );
}

export async function deleteFiles(fileIds: Array<Types.ObjectId | string>) {
  for (const id of fileIds) {
    await bucket()
      .delete(new Types.ObjectId(id.toString()))
      .catch(() => undefined);
  }
}
