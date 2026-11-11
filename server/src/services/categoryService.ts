import type { Caller } from "../lib/access.js";
import { HttpError } from "../lib/errors.js";
import { isObjectId } from "../lib/objectId.js";
import { Category } from "../models/Category.js";
import { Notice } from "../models/Notice.js";
import { audit } from "./auditService.js";

const toDto = (c: { _id: { toString(): string }; name: string }) => ({
  id: c._id.toString(),
  name: c.name,
});
const notFound = () => new HttpError(404, "NOT_FOUND", "Category not found");

// 11000 = duplicate key. The unique index ignores letter case, so "exams" collides with "Exams".
const nameTaken = (err: unknown) =>
  (err as { code?: number }).code === 11000
    ? new HttpError(409, "CONFLICT", "Invalid input", { name: "That category already exists" })
    : err;

export async function createCategory(caller: Caller, name: string, ip?: string) {
  try {
    const category = await Category.create({ name });
    await audit({
      actorId: caller.id,
      action: "category.create",
      targetType: "category",
      targetId: category._id,
      ip,
    });
    return toDto(category);
  } catch (err) {
    throw nameTaken(err);
  }
}

export async function renameCategory(caller: Caller, id: string, name: string, ip?: string) {
  const category = isObjectId(id) ? await Category.findById(id) : null;
  if (!category) throw notFound();
  category.name = name;
  try {
    await category.save();
  } catch (err) {
    throw nameTaken(err);
  }
  await audit({
    actorId: caller.id,
    action: "category.rename",
    targetType: "category",
    targetId: category._id,
    ip,
  });
  return toDto(category);
}

export async function deleteCategory(caller: Caller, id: string, ip?: string) {
  const category = isObjectId(id) ? await Category.findById(id) : null;
  if (!category) throw notFound();
  // Notices keep pointing at their category, so one that is in use must stay.
  if (await Notice.exists({ categoryId: category._id })) {
    throw new HttpError(
      409,
      "CATEGORY_IN_USE",
      "This category is used by notices and cannot be deleted",
    );
  }
  await category.deleteOne();
  await audit({
    actorId: caller.id,
    action: "category.delete",
    targetType: "category",
    targetId: category._id,
    ip,
  });
}
