import { Schema, model, type HydratedDocument, type InferSchemaType } from "mongoose";

export const NOTICE_STATUSES = ["draft", "published", "archived"] as const;
export type NoticeStatus = (typeof NOTICE_STATUSES)[number];

const noticeSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
    body: { type: String, required: true, trim: true, minlength: 1, maxlength: 5000 },
    categoryId: { type: Schema.Types.ObjectId, ref: "Category", required: true },
    // Ownership checks compare this with the caller's id.
    authorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: NOTICE_STATUSES, required: true },
    pinned: { type: Boolean, default: false },
    // The image bytes live in GridFS; only the file id and the alt text are kept here.
    images: {
      type: [
        new Schema(
          {
            fileId: { type: Schema.Types.ObjectId, required: true },
            alt: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    publishedAt: { type: Date }, // set the first time the notice is published, never changed
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true },
);

noticeSchema.index({ status: 1, pinned: -1, publishedAt: -1 }); // public board
noticeSchema.index({ categoryId: 1, publishedAt: -1 }); // category filter
noticeSchema.index({ authorId: 1, createdAt: -1 }); // "my notices"
noticeSchema.index({ title: "text", body: "text" }, { weights: { title: 3, body: 1 } }); // search

export type NoticeDoc = HydratedDocument<InferSchemaType<typeof noticeSchema>>;
export const Notice = model("Notice", noticeSchema);
