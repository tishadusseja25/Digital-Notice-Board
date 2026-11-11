import type { Server as HttpServer } from "node:http";
import jwt from "jsonwebtoken";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { Server } from "socket.io";
import type { Env } from "../config/env.js";
import { ACCESS_COOKIE } from "../lib/cookies.js";
import { verifyAccessToken } from "../lib/jwt.js";
import { LIMITS } from "../middleware/rateLimit.js";
import { setIo } from "./events.js";

const cookieOf = (header: string | undefined, name: string) => {
  const hit = header && new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(header);
  return hit ? decodeURIComponent(hit[1]!) : undefined;
};

/**
 * Attaches Socket.IO to the HTTP server. Clients only listen: no handler is registered for
 * incoming events, so nothing a client sends can change anything.
 */
export function attachSocket(
  server: HttpServer,
  env: Env,
  connectionsPerMinute = LIMITS.socketConnectionsPerMinute,
) {
  const io = new Server(server, {
    serveClient: false,
    maxHttpBufferSize: 10_000, // clients send nothing useful, so refuse big messages early
    // A browser always sends Origin on a WebSocket. A page from another site is refused, which
    // stops it from using the visitor's login cookie. No Origin (curl, tests) carries no cookie.
    allowRequest: (req, done) => {
      const origin = req.headers.origin;
      done(
        origin && origin !== env.APP_ORIGIN ? "Origin not allowed" : null,
        !origin || origin === env.APP_ORIGIN,
      );
    },
  });
  const limiter = new RateLimiterMemory({ points: connectionsPerMinute, duration: 60 });

  io.use(async (socket, next) => {
    // Behind Render's one proxy the visitor is the last forwarded address (same rule as app.ts).
    const forwarded = socket.handshake.headers["x-forwarded-for"];
    const ip =
      env.NODE_ENV === "production" && typeof forwarded === "string"
        ? forwarded.split(",").at(-1)!.trim()
        : socket.handshake.address;
    try {
      await limiter.consume(ip);
      next();
    } catch {
      next(new Error("Too many connections"));
    }
  });

  io.on("connection", (socket) => {
    socket.join("public");
    // A bad or missing token is not an error: the socket stays public-only.
    const token = cookieOf(socket.handshake.headers.cookie, ACCESS_COOKIE);
    const caller = token ? verifyAccessToken(token, env) : null;
    if (!token || !caller) return;

    socket.join(caller.role === "admin" ? ["admin", `user:${caller.id}`] : `user:${caller.id}`);
    // Drop the socket when its login expires; the client signs in again silently and reconnects.
    const exp = (jwt.decode(token) as { exp: number }).exp * 1000;
    const timer = setTimeout(() => socket.disconnect(true), Math.max(0, exp - Date.now()));
    socket.on("disconnect", () => clearTimeout(timer));
  });

  setIo(io);
  return io;
}
