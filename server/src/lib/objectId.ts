import { z } from "zod";

/** A MongoDB id is exactly 24 hex characters. Anything else is rejected before it reaches a query. */
export const OBJECT_ID = /^[a-f\d]{24}$/i;
export const isObjectId = (value: unknown): value is string =>
  typeof value === "string" && OBJECT_ID.test(value);
export const objectIdSchema = z.string().regex(OBJECT_ID, "Invalid id");

export const pageQuery = {
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
};

export const paged = <T>(items: T[], total: number, page: number, limit: number) => ({
  items,
  page,
  limit,
  total,
});
