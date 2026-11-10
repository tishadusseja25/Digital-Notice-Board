import mongoose from "mongoose";

// strictQuery drops unknown filter fields; sanitizeFilter turns `{ $ne: x }` typed by a user into a
// plain equality match. Both are part of the operator-injection defence (architecture Section 3).
mongoose.set("strictQuery", true);
mongoose.set("sanitizeFilter", true);

export async function connectDb(uri: string) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
}

export async function isDbHealthy(): Promise<boolean> {
  try {
    if (mongoose.connection.readyState !== 1) return false;
    await mongoose.connection.db?.admin().ping();
    return true;
  } catch {
    return false;
  }
}
