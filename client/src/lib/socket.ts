import { io, type Socket } from "socket.io-client";
import { create } from "zustand";
import { api } from "./api";

const NOTICE_EVENTS = [
  "notice:created",
  "notice:updated",
  "notice:removed",
  "notice:changed",
] as const;

export type LiveEvent =
  { type: (typeof NOTICE_EVENTS)[number]; id: string } | { type: "reconnected" };

/** "connecting" is silent on purpose, so screen readers hear only real changes. */
export const useLiveStore = create<{ status: "connecting" | "live" | "offline" }>(() => ({
  status: "connecting",
}));

const listeners = new Set<(event: LiveEvent) => void>();
export function subscribeLive(listener: (event: LiveEvent) => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
const tell = (event: LiveEvent) => listeners.forEach((fn) => fn(event));

let socket: Socket | null = null;

export function stopSocket() {
  socket?.close();
  socket = null;
}

/** (Re)connects. Call after the session check, and again after sign-in or sign-out, so the
 *  server puts this connection in the right rooms. The browser sends the login cookie itself. */
export function restartSocket() {
  stopSocket();
  useLiveStore.setState({ status: "connecting" });
  const s = (socket = io());
  let seenConnected = false;

  s.on("connect", () => {
    useLiveStore.setState({ status: "live" });
    // Events sent while we were away are gone, so listeners must reload.
    if (seenConnected) tell({ type: "reconnected" });
    seenConnected = true;
  });
  s.on("connect_error", () => useLiveStore.setState({ status: "offline" }));
  s.on("disconnect", (reason) => {
    useLiveStore.setState({ status: "offline" });
    // The server ends the socket when the login token expires and does not retry by itself.
    // Refresh the login quietly (api() does it on a 401), then reconnect.
    if (reason === "io server disconnect") {
      void api("/auth/me")
        .catch(() => undefined)
        .finally(() => {
          if (socket === s) s.connect();
        });
    }
  });
  for (const type of NOTICE_EVENTS) {
    s.on(type, (data: { id: string }) => tell({ type, id: data.id }));
  }
}
