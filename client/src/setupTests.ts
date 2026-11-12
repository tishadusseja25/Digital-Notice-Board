import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { sockets } from "./fakeSocket";

// No test opens a real connection; tests drive the fake with lastSocket().trigger(...).
vi.mock("socket.io-client", async () => ({ io: (await import("./fakeSocket")).fakeIo }));
// jsdom does not implement scrolling.
window.scrollTo = vi.fn();
afterEach(() => {
  sockets.length = 0;
});
