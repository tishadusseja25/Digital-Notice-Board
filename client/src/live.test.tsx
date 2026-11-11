import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { lastSocket, sockets } from "./fakeSocket";
import { useLiveStore } from "./lib/socket";
import { useNoticesStore, type Notice } from "./store/noticesStore";
import { useSessionStore, type User } from "./store/sessionStore";
import { calls, json, stubFetch, user } from "./testUtils";

const notice = (n: number, extra: Partial<Notice> = {}): Notice => ({
  id: `id${n}`,
  title: `Notice ${n}`,
  body: "Body",
  category: { id: "c1", name: "Exams" },
  images: [],
  pinned: false,
  publishedAt: "2026-11-10T16:00:00.000Z",
  expiresAt: null,
  createdAt: "2026-11-10T16:00:00.000Z",
  updatedAt: "2026-11-10T16:00:00.000Z",
  ...extra,
});
const page = (items: Notice[]) => ({ items, total: items.length, page: 1, limit: 20 });

/** Visitor by default (/auth/me answers 401); `list` is what the board's list call returns. */
function server(list: () => unknown, me: User | null = null) {
  return stubFetch((url) => {
    if (url === "/api/auth/me") return me ? json(200, { user: me }) : json(401, {});
    if (url === "/api/auth/refresh") return json(401, {});
    if (url.startsWith("/api/categories")) return json(200, { items: [] });
    if (url.startsWith("/api/notices/")) return json(200, { notice: notice(1) });
    return json(200, list());
  });
}
const renderApp = (path = "/") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
const connectedSocket = async () => {
  await waitFor(() => expect(sockets).toHaveLength(1));
  const s = lastSocket();
  act(() => s.trigger("connect"));
  return s;
};
const listCalls = (m: ReturnType<typeof stubFetch>) =>
  calls(m).filter((c) => c.startsWith("GET /api/notices")).length;

beforeEach(() => {
  useSessionStore.setState({ user: null, status: "loading" });
  useLiveStore.setState({ status: "connecting" });
  useNoticesStore.setState({ items: [], total: 0, loading: true, error: null });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("live status", () => {
  it("connects after the session check and shows Live, then Reconnecting", async () => {
    server(() => page([notice(1)]));
    renderApp();
    expect(sockets).toHaveLength(0);
    const s = await connectedSocket();
    expect(await screen.findByText("Live")).toBeInTheDocument();
    act(() => s.trigger("disconnect", "transport close"));
    expect(screen.getByText("Reconnecting…")).toBeInTheDocument();
  });

  it("reconnects with the new login after sign-in", async () => {
    server(() => page([]));
    renderApp();
    await connectedSocket();
    act(() => useSessionStore.setState({ user }));
    await waitFor(() => expect(sockets).toHaveLength(2));
    expect(sockets[0]!.close).toHaveBeenCalled();
  });

  it("refreshes the login quietly and reconnects when the server drops the socket", async () => {
    const fetchMock = server(() => page([]));
    renderApp();
    const s = await connectedSocket();
    act(() => s.trigger("disconnect", "io server disconnect"));
    await waitFor(() => expect(s.connect).toHaveBeenCalledTimes(1));
    expect(calls(fetchMock).filter((c) => c === "GET /api/auth/me")).toHaveLength(2);
  });

  it("does not reconnect by hand after an ordinary connection loss", async () => {
    server(() => page([]));
    renderApp();
    const s = await connectedSocket();
    act(() => s.trigger("disconnect", "transport close"));
    expect(s.connect).not.toHaveBeenCalled();
  });
});

describe("live board", () => {
  it("reloads once for a burst of events, and shows the new notice", async () => {
    let items = [notice(1)];
    const fetchMock = server(() => page(items));
    renderApp();
    const s = await connectedSocket();
    await screen.findByText("Notice 1");
    const before = listCalls(fetchMock);

    items = [notice(2), notice(1)];
    act(() => {
      s.trigger("notice:created", { id: "id2" });
      s.trigger("notice:updated", { id: "id2" });
      s.trigger("notice:updated", { id: "id1" });
    });
    expect(await screen.findByText("Notice 2")).toBeInTheDocument();
    expect(screen.getByText("Notice 1")).toBeInTheDocument(); // the list never blanked out
    expect(listCalls(fetchMock)).toBe(before + 1);
  });

  it("drops a removed notice from the next reload", async () => {
    let items = [notice(1), notice(2)];
    server(() => page(items));
    renderApp();
    const s = await connectedSocket();
    await screen.findByText("Notice 2");
    items = [notice(1)];
    act(() => s.trigger("notice:removed", { id: "id2" }));
    await waitFor(() => expect(screen.queryByText("Notice 2")).not.toBeInTheDocument());
  });

  it("reloads after a reconnect, but not on the first connect", async () => {
    const fetchMock = server(() => page([notice(1)]));
    renderApp();
    const s = await connectedSocket();
    await screen.findByText("Notice 1");
    await new Promise((r) => setTimeout(r, 400));
    const before = listCalls(fetchMock);
    act(() => {
      s.trigger("disconnect", "transport close");
      s.trigger("connect");
    });
    await waitFor(() => expect(listCalls(fetchMock)).toBe(before + 1));
  });

  it("ignores private events on the public board", async () => {
    const fetchMock = server(() => page([notice(1)]));
    renderApp();
    const s = await connectedSocket();
    await screen.findByText("Notice 1");
    const before = listCalls(fetchMock);
    act(() => s.trigger("notice:changed", { id: "id1" }));
    await new Promise((r) => setTimeout(r, 450));
    expect(listCalls(fetchMock)).toBe(before);
  });

  it("hides a notice once its expiry time passes, within the 30 s sweep", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const past = new Date(Date.now() + 5_000).toISOString();
    server(() => page([notice(1, { expiresAt: past }), notice(2)]));
    renderApp();
    await screen.findByText("Notice 1");
    expect(screen.getByText("Notice 2")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(30_000));
    expect(screen.queryByText("Notice 1")).not.toBeInTheDocument();
    expect(screen.getByText("Notice 2")).toBeInTheDocument();
  });
});

describe("live detail and My notices", () => {
  it("tells a reader their notice was taken down", async () => {
    server(() => page([]));
    renderApp("/notices/id1");
    const s = await connectedSocket();
    await screen.findByRole("heading", { name: "Notice 1" });
    act(() => s.trigger("notice:removed", { id: "other" }));
    expect(screen.getByRole("heading", { name: "Notice 1" })).toBeInTheDocument();
    act(() => s.trigger("notice:removed", { id: "id1" }));
    expect(
      await screen.findByRole("heading", { name: "This notice is no longer available" }),
    ).toBeInTheDocument();
  });

  it("reloads My notices on a private event", async () => {
    let items = [notice(1, { status: "draft", authorId: "u1" })];
    const fetchMock = stubFetch((url) => {
      if (url === "/api/auth/me") return json(200, { user });
      if (url.startsWith("/api/me/notices")) return json(200, page(items));
      return json(200, { items: [] });
    });
    renderApp("/committee");
    const s = await connectedSocket();
    await screen.findByRole("heading", { name: "Notice 1" });
    items = [notice(1, { status: "published" }), notice(3)];
    act(() => s.trigger("notice:changed", { id: "id3" }));
    expect(await screen.findByRole("heading", { name: "Notice 3" })).toBeInTheDocument();
    expect(calls(fetchMock).filter((c) => c.startsWith("GET /api/me/notices"))).toHaveLength(2);
  });
});
