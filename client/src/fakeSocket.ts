import { vi } from "vitest";

/** Stands in for socket.io-client in tests: `trigger` plays an event from the server. */
export class FakeSocket {
  private handlers = new Map<string, ((...args: never[]) => void)[]>();
  connect = vi.fn();
  close = vi.fn();
  on(event: string, fn: (...args: never[]) => void) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), fn]);
    return this;
  }
  trigger(event: string, ...args: unknown[]) {
    for (const fn of this.handlers.get(event) ?? []) (fn as (...a: unknown[]) => void)(...args);
  }
}

export const sockets: FakeSocket[] = [];
export const fakeIo = () => {
  const s = new FakeSocket();
  sockets.push(s);
  return s;
};
export const lastSocket = () => sockets.at(-1)!;
