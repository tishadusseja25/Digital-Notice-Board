import { afterEach, describe, expect, it, vi } from "vitest";
import { calls, json, stubFetch } from "../testUtils";
import { ApiError, api, setSessionLostHandler } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
  setSessionLostHandler(() => {});
});

describe("api()", () => {
  it("sends cookies, returns parsed JSON and skips empty query values", async () => {
    const fetchMock = stubFetch(() => json(200, { items: [] }));
    const data = await api("/notices", {
      query: { q: "exam", page: 2, category: "", from: undefined },
    });
    expect(data).toEqual({ items: [] });
    expect(calls(fetchMock)).toEqual(["GET /api/notices?q=exam&page=2"]);
    expect(fetchMock.mock.calls[0]?.[1]?.credentials).toBe("same-origin");
  });

  it("sends JSON bodies with a content type", async () => {
    const fetchMock = stubFetch(() => json(200, {}));
    await api("/auth/login", { method: "POST", body: { email: "a@b.c" } });
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.body).toBe('{"email":"a@b.c"}');
    expect(init?.headers).toEqual({ "Content-Type": "application/json" });
  });

  it("returns undefined for 204", async () => {
    stubFetch(() => json(204));
    expect(await api("/auth/logout", { method: "POST" })).toBeUndefined();
  });

  it("turns an error reply into an ApiError with code and field messages", async () => {
    stubFetch(() =>
      json(400, {
        error: { code: "VALIDATION", message: "Invalid input", fields: { title: "Required" } },
      }),
    );
    const err = await api("/notices").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, code: "VALIDATION", fields: { title: "Required" } });
  });

  it("copes with a non-JSON error reply", async () => {
    stubFetch(() => new Response("<html>bad gateway</html>", { status: 502 }));
    const err = await api("/notices").catch((e) => e);
    expect(err).toMatchObject({ status: 502, code: "UNKNOWN" });
  });

  it("on 401 refreshes once and retries the original request", async () => {
    let first = true;
    const fetchMock = stubFetch((url) => {
      if (url === "/api/auth/refresh") return json(204);
      if (first) {
        first = false;
        return json(401, { error: { code: "UNAUTHENTICATED", message: "Sign in required" } });
      }
      return json(200, { ok: true });
    });
    expect(await api("/me/notices")).toEqual({ ok: true });
    expect(calls(fetchMock)).toEqual([
      "GET /api/me/notices",
      "POST /api/auth/refresh",
      "GET /api/me/notices",
    ]);
  });

  it("shares ONE refresh between simultaneous 401s", async () => {
    const seen = new Set<string>();
    const fetchMock = stubFetch((url) => {
      if (url === "/api/auth/refresh") return json(204);
      if (!seen.has(url)) {
        seen.add(url);
        return json(401, { error: { code: "UNAUTHENTICATED", message: "x" } });
      }
      return json(200, { url });
    });
    const results = await Promise.all([api("/a"), api("/b"), api("/c")]);
    expect(results).toHaveLength(3);
    expect(calls(fetchMock).filter((c) => c === "POST /api/auth/refresh")).toHaveLength(1);
  });

  it("when the refresh fails: no retry, the session is reported lost, the 401 is thrown", async () => {
    const lost = vi.fn();
    setSessionLostHandler(lost);
    const fetchMock = stubFetch((url) =>
      url === "/api/auth/refresh"
        ? json(401, { error: { code: "SESSION_EXPIRED", message: "x" } })
        : json(401, { error: { code: "UNAUTHENTICATED", message: "Sign in required" } }),
    );
    await expect(api("/me/notices")).rejects.toMatchObject({ status: 401 });
    expect(lost).toHaveBeenCalledTimes(1);
    expect(calls(fetchMock)).toEqual(["GET /api/me/notices", "POST /api/auth/refresh"]);
  });

  it("does not try to refresh after a failed login", async () => {
    const fetchMock = stubFetch(() =>
      json(401, { error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password" } }),
    );
    await expect(api("/auth/login", { method: "POST", body: {} })).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
    expect(calls(fetchMock)).toEqual(["POST /api/auth/login"]);
  });
});
