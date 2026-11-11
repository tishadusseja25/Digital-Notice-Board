import type { Server } from "socket.io";
import { logger } from "../lib/logger.js";

// The socket server, set once at start-up. While it is null (unit tests, scripts) every
// announcement is a no-op, so services never need to know whether sockets exist.
let io: Server | null = null;
export const setIo = (server: Server | null) => {
  io = server;
};

export type NoticeChange = {
  id: string;
  authorId: string;
  wasPublic: boolean;
  nowPublic: boolean;
  /** Same shape the REST API returns to the public. */
  publicDto: unknown;
  /** Adds status and author; only ever sent to the author's and the admin room. */
  staffDto: unknown;
};

/** Call after the database write succeeded. A socket failure must never fail the request. */
export function announceNotice(c: NoticeChange) {
  if (!io) return;
  try {
    if (c.nowPublic)
      io.to("public").emit(c.wasPublic ? "notice:updated" : "notice:created", c.publicDto);
    else if (c.wasPublic) io.to("public").emit("notice:removed", { id: c.id });
    io.to([`user:${c.authorId}`, "admin"]).emit("notice:changed", c.staffDto);
  } catch (err) {
    logger.warn({ err }, "could not announce notice change");
  }
}
