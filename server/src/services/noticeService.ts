import { Types, trusted } from "mongoose";
import type { Env } from "../config/env.js";
import { canManage, type Caller } from "../lib/access.js";
import { HttpError } from "../lib/errors.js";
import { isObjectId, paged } from "../lib/objectId.js";
import { isPubliclyVisible, publicNoticeFilter } from "../lib/visibility.js";
import { Category } from "../models/Category.js";
import { Notice, type NoticeDoc, type NoticeStatus } from "../models/Notice.js";
import { audit } from "./auditService.js";
import { attachImages, checkAttachable, deleteFiles, type ImageRef } from "./imageService.js";

const notFound = () => new HttpError(404, "NOT_FOUND", "Notice not found");
const forbidden = () => new HttpError(403, "FORBIDDEN", "You can only change your own notices");
const invalid = (fields: Record<string, string>) =>
  new HttpError(400, "VALIDATION", "Invalid input", fields);

/** Loads a notice with its category name filled in, or null for a malformed/unknown id. */
async function load(id: string): Promise<NoticeDoc | null> {
  if (!isObjectId(id)) return null;
  return Notice.findById(id).populate("categoryId", "name");
}

/** Public shape hides author and status; staff (author/admin) also get those. */
export function toDto(notice: NoticeDoc, staff: boolean) {
  const category = notice.categoryId as unknown as { _id: Types.ObjectId; name: string };
  return {
    id: notice.id as string,
    title: notice.title,
    body: notice.body,
    category: { id: category._id.toString(), name: category.name },
    images: notice.images.map((i) => ({ id: i.fileId.toString(), alt: i.alt })),
    pinned: notice.pinned,
    publishedAt: notice.publishedAt ?? null,
    expiresAt: notice.expiresAt ?? null,
    createdAt: notice.createdAt,
    updatedAt: notice.updatedAt,
    ...(staff ? { status: notice.status, authorId: notice.authorId.toString() } : {}),
  };
}

async function assertCategory(categoryId: string) {
  if (!(await Category.exists({ _id: categoryId })))
    throw invalid({ categoryId: "Unknown category" });
}

function assertFuture(expiresAt: Date | null | undefined) {
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    throw invalid({ expiresAt: "Expiry must be in the future" });
  }
}

export type NoticeInput = {
  title: string;
  body: string;
  categoryId: string;
  status: NoticeStatus;
  expiresAt?: Date | null;
  images?: ImageRef[];
};

export async function createNotice(caller: Caller, input: NoticeInput, env: Env, ip?: string) {
  await assertCategory(input.categoryId);
  assertFuture(input.expiresAt);
  const { images = [], ...fields } = input;
  await checkAttachable(images, caller, null, env.MAX_IMAGES_PER_NOTICE);
  const notice = await Notice.create({
    ...fields,
    images,
    authorId: caller.id,
    publishedAt: input.status === "published" ? new Date() : undefined,
  });
  await attachImages(
    images.map((i) => i.fileId),
    notice._id,
  );
  await notice.populate("categoryId", "name");
  await audit({
    actorId: caller.id,
    action: "notice.create",
    targetType: "notice",
    targetId: notice._id,
    ip,
  });
  return toDto(notice, true);
}

/** Public notices are readable by anyone; others only by their author or an admin (404 for the rest). */
export async function getNotice(id: string, caller?: Caller) {
  const notice = await load(id);
  if (!notice) throw notFound();
  const staff = canManage(notice, caller);
  if (!isPubliclyVisible(notice) && !staff) throw notFound();
  return toDto(notice, staff);
}

export type NoticePatch = Partial<Omit<NoticeInput, "expiresAt">> & { expiresAt?: Date | null };

export async function updateNotice(
  id: string,
  caller: Caller,
  patch: NoticePatch,
  env: Env,
  ip?: string,
) {
  const notice = await load(id);
  if (!notice) throw notFound();
  if (!canManage(notice, caller)) throw forbidden();

  // Sending `images` replaces the whole list; images left out are deleted with their files.
  const removedImages: string[] = [];
  if (patch.images !== undefined) {
    await checkAttachable(patch.images, caller, notice._id, env.MAX_IMAGES_PER_NOTICE);
    const keep = new Set(patch.images.map((i) => i.fileId));
    removedImages.push(
      ...notice.images.map((i) => i.fileId.toString()).filter((fileId) => !keep.has(fileId)),
    );
    notice.set("images", patch.images);
  }

  if (patch.categoryId !== undefined) {
    await assertCategory(patch.categoryId);
    notice.categoryId = new Types.ObjectId(patch.categoryId);
  }
  assertFuture(patch.expiresAt);
  if (patch.title !== undefined) notice.title = patch.title;
  if (patch.body !== undefined) notice.body = patch.body;
  if (patch.expiresAt !== undefined) notice.expiresAt = patch.expiresAt;
  if (patch.status !== undefined) {
    if (patch.status === "published" && !notice.publishedAt) notice.publishedAt = new Date();
    notice.status = patch.status;
  }
  // A hidden notice must not keep a pin slot.
  if (notice.status !== "published") notice.pinned = false;
  await notice.save();
  await attachImages(
    (patch.images ?? []).map((i) => i.fileId),
    notice._id,
  );
  await deleteFiles(removedImages);
  await notice.populate("categoryId", "name");
  await audit({
    actorId: caller.id,
    action: "notice.update",
    targetType: "notice",
    targetId: notice._id,
    ip,
  });
  return toDto(notice, true);
}

/** "archive" hides the notice but keeps it; "delete" removes it for good. */
export async function removeNotice(
  id: string,
  caller: Caller,
  mode: "archive" | "delete",
  ip?: string,
) {
  const notice = await load(id);
  if (!notice) throw notFound();
  if (!canManage(notice, caller)) throw forbidden();
  if (mode === "archive") {
    notice.status = "archived";
    notice.pinned = false;
    await notice.save();
  } else {
    await notice.deleteOne();
    await deleteFiles(notice.images.map((i) => i.fileId));
  }
  await audit({
    actorId: caller.id,
    action: mode === "archive" ? "notice.archive" : "notice.delete",
    targetType: "notice",
    targetId: notice._id,
    ip,
  });
}

/** Committee sees their own notices in any status; admin sees everyone's. */
export async function listMine(
  caller: Caller,
  opts: { status?: NoticeStatus; page: number; limit: number },
) {
  const filter: Record<string, unknown> = caller.role === "admin" ? {} : { authorId: caller.id };
  if (opts.status) filter.status = opts.status;
  const [docs, total] = await Promise.all([
    Notice.find(filter)
      .sort({ createdAt: -1 })
      .skip((opts.page - 1) * opts.limit)
      .limit(opts.limit)
      .populate("categoryId", "name"),
    Notice.countDocuments(filter),
  ]);
  return paged(
    docs.map((d) => toDto(d, true)),
    total,
    opts.page,
    opts.limit,
  );
}

export type PublicListOptions = {
  q?: string;
  category?: string;
  from?: Date;
  to?: Date;
  page: number;
  limit: number;
};

/**
 * The public board: only publicly visible notices, pinned first, then newest first.
 * Search text reaches MongoDB only as the string inside $search, never as a query object.
 */
export async function listPublic(opts: PublicListOptions) {
  const filter: Record<string, unknown> = publicNoticeFilter();
  if (opts.category) filter.categoryId = opts.category;
  if (opts.q) filter.$text = trusted({ $search: opts.q });
  if (opts.from || opts.to) {
    filter.publishedAt = trusted({
      ...(opts.from && { $gte: opts.from }),
      ...(opts.to && { $lte: opts.to }),
    });
  }
  const [docs, total] = await Promise.all([
    Notice.find(filter)
      .sort({ pinned: -1, publishedAt: -1 })
      .skip((opts.page - 1) * opts.limit)
      .limit(opts.limit)
      .populate("categoryId", "name"),
    Notice.countDocuments(filter),
  ]);
  return paged(
    docs.map((d) => toDto(d, false)),
    total,
    opts.page,
    opts.limit,
  );
}

export const MAX_PINNED = 3;

/** Admin only (checked by the route). Only publicly visible notices can be pinned, at most MAX_PINNED. */
export async function setPinned(id: string, caller: Caller, pinned: boolean, ip?: string) {
  const notice = await load(id);
  if (!notice) throw notFound();
  if (pinned && !notice.pinned) {
    if (!isPubliclyVisible(notice)) {
      throw new HttpError(409, "NOT_PUBLISHED", "Only published notices can be pinned");
    }
    const count = await Notice.countDocuments({ ...publicNoticeFilter(), pinned: true });
    if (count >= MAX_PINNED) {
      throw new HttpError(
        409,
        "PIN_LIMIT",
        `At most ${MAX_PINNED} notices can be pinned. Unpin one first.`,
      );
    }
  }
  if (notice.pinned !== pinned) {
    notice.pinned = pinned;
    await notice.save();
    await audit({
      actorId: caller.id,
      action: pinned ? "notice.pin" : "notice.unpin",
      targetType: "notice",
      targetId: notice._id,
      ip,
    });
  }
  return toDto(notice, true);
}
