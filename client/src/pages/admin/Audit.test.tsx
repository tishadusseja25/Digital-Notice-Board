import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
import { useSessionStore, type User } from "../../store/sessionStore";
import { calls, json, stubFetch, user } from "../../testUtils";

const admin: User = { ...user, id: "u0", name: "Root", role: "admin" };
const entry = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `a${n}`,
  action: "notice.create",
  targetType: "notice",
  targetId: `507f1f77bcf86cd7994390${String(10 + n)}`,
  ip: "203.0.113.7",
  at: "2026-11-10T16:00:00.000Z",
  actor: { id: "u1", name: "Ann", email: "ann@example.com" },
  ...extra,
});
const list = (items: unknown[], total = items.length, page = 1) => ({
  items,
  total,
  page,
  limit: 20,
});

function server(answer: (url: string) => Response, me: User = admin) {
  return stubFetch((url) => (url === "/api/auth/me" ? json(200, { user: me }) : answer(url)));
}
const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/admin/audit"]}>
      <App />
    </MemoryRouter>,
  );

beforeEach(() => useSessionStore.setState({ user: null, status: "loading" }));
afterEach(() => vi.unstubAllGlobals());

describe("audit log page", () => {
  it("shows who did what, to what and from where", async () => {
    server(() =>
      json(
        200,
        list([
          entry(1),
          entry(2, { action: "login.failure", actor: null, targetType: null, targetId: null }),
        ]),
      ),
    );
    renderPage();
    const table = await screen.findByRole("table", { name: "Audit log entries" });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3); // header + 2 entries
    const first = within(rows[1]!);
    expect(first.getByText("Ann")).toBeInTheDocument();
    expect(first.getByText("ann@example.com")).toBeInTheDocument();
    expect(first.getByText("notice.create")).toBeInTheDocument();
    expect(first.getByText(/^notice /)).toBeInTheDocument();
    expect(first.getByText("203.0.113.7")).toBeInTheDocument();
    const second = within(rows[2]!);
    expect(second.getByText("login.failure")).toBeInTheDocument();
    expect(second.getByText("Unknown (not signed in)")).toBeInTheDocument();
  });

  it("is reachable from the admin tab bar", async () => {
    server(() => json(200, list([entry(1)])));
    renderPage();
    await screen.findByRole("table");
    const tabs = screen.getByRole("navigation", { name: "Admin" });
    expect(within(tabs).getByRole("link", { name: "Audit log" })).toHaveAttribute(
      "href",
      "/admin/audit",
    );
  });

  it("pages through the entries", async () => {
    const fetchMock = server(() => json(200, list([entry(1)], 45)));
    renderPage();
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(calls(fetchMock).at(-1)).toBe("GET /api/audit?page=2"));
  });

  it("shows empty and error states, and retries", async () => {
    let fail = true;
    server(() =>
      fail ? json(500, { error: { code: "INTERNAL", message: "x" } }) : json(200, list([])),
    );
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the audit log.");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Nothing has been logged yet.")).toBeInTheDocument();
  });

  it("is closed to committee members", async () => {
    const fetchMock = server(() => json(200, list([entry(1)])), user);
    renderPage();
    expect(await screen.findByRole("heading", { name: /403/ })).toBeInTheDocument();
    expect(calls(fetchMock).some((c) => c.includes("/api/audit"))).toBe(false);
  });
});
