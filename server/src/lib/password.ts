import bcrypt from "bcryptjs";

export const hashPassword = (plain: string, cost: number) => bcrypt.hash(plain, cost);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);
