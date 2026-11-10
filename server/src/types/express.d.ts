import type { Role } from "../models/User.js";

declare global {
  // Express's extension point for request properties is a namespace.
  namespace Express {
    interface Request {
      auth?: { id: string; role: Role };
    }
  }
}
