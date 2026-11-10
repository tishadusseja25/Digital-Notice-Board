import { Schema, model } from "mongoose";

const categorySchema = new Schema({
  name: { type: String, required: true, trim: true, minlength: 1, maxlength: 40 },
});
// strength 2 = ignore upper/lower case, so "Exams" and "exams" collide.
categorySchema.index({ name: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });

export const Category = model("Category", categorySchema);
