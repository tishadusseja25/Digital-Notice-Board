import { pathToFileURL } from "node:url";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { Category } from "../server/src/models/Category.js";
import { User } from "../server/src/models/User.js";

const DEFAULT_CATEGORIES = ["General", "Exams", "Events", "Placements"];

type SeedInput = { name: string; email: string; password: string; bcryptCost: number };

/** Idempotent: creates the first admin only if no admin exists, and missing default categories. */
export async function seed({ name, email, password, bcryptCost }: SeedInput) {
  let adminCreated = false;
  if (!(await User.exists({ role: "admin" }))) {
    await User.create({
      name,
      email,
      passwordHash: await bcrypt.hash(password, bcryptCost),
      role: "admin",
      mustChangePassword: true,
    });
    adminCreated = true;
  }
  for (const categoryName of DEFAULT_CATEGORIES) {
    const exists = await Category.exists({ name: categoryName }).collation({
      locale: "en",
      strength: 2,
    });
    if (!exists) await Category.create({ name: categoryName });
  }
  return { adminCreated };
}

async function main() {
  const { MONGODB_URI, SEED_ADMIN_NAME, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, BCRYPT_COST } =
    process.env;
  if (!MONGODB_URI || !SEED_ADMIN_NAME || !SEED_ADMIN_EMAIL || !SEED_ADMIN_PASSWORD) {
    throw new Error("Set MONGODB_URI, SEED_ADMIN_NAME, SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD");
  }
  if (SEED_ADMIN_PASSWORD.length < 10)
    throw new Error("SEED_ADMIN_PASSWORD must be at least 10 characters");
  await mongoose.connect(MONGODB_URI);
  const { adminCreated } = await seed({
    name: SEED_ADMIN_NAME,
    email: SEED_ADMIN_EMAIL,
    password: SEED_ADMIN_PASSWORD,
    bcryptCost: Number(BCRYPT_COST ?? 12),
  });
  console.log(adminCreated ? "Admin created." : "An admin already exists; nothing changed.");
  await mongoose.disconnect();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
