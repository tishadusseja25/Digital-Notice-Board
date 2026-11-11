import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calls, json, stubFetch, user } from "../testUtils";
import { useSessionStore } from "./sessionStore";

beforeEach(() => useSessionStore.setState({ user: null, status: "loading" }));
afterEach(() => vi.unstubAllGlobals());

describe("sessionStore", () => {
  it("init() stores the signed-in user", async () => {
    stubFetch(() => json(200, { user }));
    await useSessionStore.getState().init();
    expect(useSessionStore.getState()).toMatchObject({ user, status: "ready" });
  });

  it("init() treats a 401 (after a failed silent refresh) as a visitor", async () => {
    const fetchMock = stubFetch(() =>
      json(401, { error: { code: "UNAUTHENTICATED", message: "x" } }),
    );
    await useSessionStore.getState().init();
    expect(useSessionStore.getState()).toMatchObject({ user: null, status: "ready" });
    expect(calls(fetchMock)).toEqual(["GET /api/auth/me", "POST /api/auth/refresh"]);
  });

  it("init() treats a network failure as a visitor", async () => {
    stubFetch(() => {
      throw new Error("offline");
    });
    await useSessionStore.getState().init();
    expect(useSessionStore.getState()).toMatchObject({ user: null, status: "ready" });
  });

  it("login() stores the user and returns it", async () => {
    stubFetch(() => json(200, { user }));
    expect(await useSessionStore.getState().login("ann@example.com", "pw")).toEqual(user);
    expect(useSessionStore.getState().user).toEqual(user);
  });

  it("login() leaves the store untouched when the server refuses", async () => {
    stubFetch(() =>
      json(401, { error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password" } }),
    );
    await expect(useSessionStore.getState().login("a@b.c", "bad")).rejects.toMatchObject({
      status: 401,
    });
    expect(useSessionStore.getState().user).toBeNull();
  });

  it("logout() clears the user even if the request fails", async () => {
    useSessionStore.setState({ user, status: "ready" });
    stubFetch(() => {
      throw new Error("offline");
    });
    await useSessionStore
      .getState()
      .logout()
      .catch(() => undefined);
    expect(useSessionStore.getState().user).toBeNull();
  });

  it("changePassword() clears the must-change flag without another request", async () => {
    useSessionStore.setState({ user: { ...user, mustChangePassword: true }, status: "ready" });
    const fetchMock = stubFetch(() => json(204));
    await useSessionStore.getState().changePassword("old", "a-long-new-password");
    expect(useSessionStore.getState().user?.mustChangePassword).toBe(false);
    expect(calls(fetchMock)).toEqual(["POST /api/auth/password"]);
  });

  it("changePassword() keeps the flag when the server refuses", async () => {
    useSessionStore.setState({ user: { ...user, mustChangePassword: true }, status: "ready" });
    stubFetch(() => json(400, { error: { code: "VALIDATION", message: "Invalid input" } }));
    await expect(
      useSessionStore.getState().changePassword("bad", "a-long-new-password"),
    ).rejects.toMatchObject({ status: 400 });
    expect(useSessionStore.getState().user?.mustChangePassword).toBe(true);
  });
});
