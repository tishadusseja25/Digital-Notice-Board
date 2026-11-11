import { vi } from "vitest";

/** A fake server reply for a stubbed `fetch`. */
export const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** Replaces the global fetch with a mock and returns it so tests can inspect the calls. */
export function stubFetch(impl: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const mock = vi.fn((url: string, init?: RequestInit) => Promise.resolve(impl(url, init)));
  vi.stubGlobal("fetch", mock);
  return mock;
}

export const calls = (mock: ReturnType<typeof stubFetch>) =>
  mock.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${url}`);

export const user = {
  id: "u1",
  name: "Ann",
  email: "ann@example.com",
  role: "committee" as const,
  mustChangePassword: false,
};
