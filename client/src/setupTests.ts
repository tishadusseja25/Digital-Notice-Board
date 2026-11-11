import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { sockets } from "./fakeSocket";

// No test opens a real connection; tests drive the fake with lastSocket().trigger(...).
vi.mock("socket.io-client", async () => ({ io: (await import("./fakeSocket")).fakeIo }));
afterEach(() => {
  sockets.length = 0;
});
