import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { useNoticesStore } from "./store/noticesStore";
import { useSessionStore, type User } from "./store/sessionStore";
import { calls, json, stubFetch, user } from "./testUtils";

const admin: User = { ...user, id: "u2", name: "Root", role: "admin" };
const unauth = () => json(401, { error: { code: "UNAUTHENTICATED", message: "Sign in required" } });
const emptyList = { items: [], total: 0, page: 1, limit: 20 };

/** Fake server. `me` is who the cookies belong to (null = nobody); `login` handles POST /auth/login. */
function server(me: User | null, login?: () => Response) {
  return stubFetch((url, init) => {
    if (url === "/api/auth/me") return me ? json(200, { user: me }) : unauth();
    if (url === "/api/auth/refresh") return unauth();
    if (url === "/api/auth/login" && init?.method === "POST") return login ? login() : unauth();
    if (url === "/api/auth/logout") return json(204);
    return json(200, emptyList);
  });
}
const renderAt = (path: string, state?: unknown) =>
  render(
    <MemoryRouter initialEntries={[{ pathname: path, state }]}>
      <App />
    </MemoryRouter>,
  );

beforeEach(() => {
  useSessionStore.setState({ user: null, status: "loading" });
  useNoticesStore.setState({ items: [], total: 0, loading: true, error: null, categories: [] });
});
afterEach(() => vi.unstubAllGlobals());

describe("route guards (page half of FR-19)", () => {
  it("sends a signed-out visitor from /admin and /committee to the login page", async () => {
    for (const path of ["/admin", "/committee", "/admin/users"]) {
      server(null);
      const { unmount } = renderAt(path);
      expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
      expect(screen.queryByText(/area/i)).not.toBeInTheDocument();
      unmount();
      useSessionStore.setState({ user: null, status: "loading" });
    }
  });

  it("does not redirect while the session is still loading", () => {
    stubFetch(() => new Promise<Response>(() => {})); // never answers
    renderAt("/admin");
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("shows the 403 page when a committee member opens /admin", async () => {
    server(user);
    renderAt("/admin");
    expect(await screen.findByRole("heading", { name: /403/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Admin area" })).not.toBeInTheDocument();
  });

  it("lets a committee member into /committee and an admin into both areas", async () => {
    server(user);
    const first = renderAt("/committee");
    expect(await screen.findByRole("heading", { name: "Committee area" })).toBeInTheDocument();
    first.unmount();

    useSessionStore.setState({ user: null, status: "loading" });
    server(admin);
    const second = renderAt("/admin");
    expect(await screen.findByRole("heading", { name: "Admin area" })).toBeInTheDocument();
    second.unmount();

    useSessionStore.setState({ user: null, status: "loading" });
    server(admin);
    renderAt("/committee");
    expect(await screen.findByRole("heading", { name: "Committee area" })).toBeInTheDocument();
  });

  it("returns a signed-out user to the login page when they sign out inside an area", async () => {
    server(user);
    renderAt("/committee");
    await screen.findByRole("heading", { name: "Committee area" });
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("shows a not-found page for unknown addresses", async () => {
    server(null);
    renderAt("/no/such/page");
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });
});

describe("login page", () => {
  const fill = (email: string, password: string) => {
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  };

  it("signs a committee member in and opens their area", async () => {
    const fetchMock = server(null, () => json(200, { user }));
    renderAt("/login");
    await screen.findByRole("heading", { name: "Sign in" });
    fill("ann@example.com", "pw");
    expect(await screen.findByRole("heading", { name: "Committee area" })).toBeInTheDocument();
    const loginCall = fetchMock.mock.calls.find(([u]) => u === "/api/auth/login");
    expect(loginCall?.[1]?.body).toBe('{"email":"ann@example.com","password":"pw"}');
  });

  it("opens the admin area for an admin", async () => {
    server(null, () => json(200, { user: admin }));
    renderAt("/login");
    await screen.findByRole("heading", { name: "Sign in" });
    fill("root@example.com", "pw");
    expect(await screen.findByRole("heading", { name: "Admin area" })).toBeInTheDocument();
  });

  it("returns to the page the visitor was sent away from", async () => {
    server(null, () => json(200, { user: admin }));
    renderAt("/login", { from: "/admin" });
    await screen.findByRole("heading", { name: "Sign in" });
    fill("root@example.com", "pw");
    expect(await screen.findByRole("heading", { name: "Admin area" })).toBeInTheDocument();
  });

  it("ignores a return address that leaves the site", async () => {
    server(null, () => json(200, { user }));
    renderAt("/login", { from: "//evil.example/phish" });
    await screen.findByRole("heading", { name: "Sign in" });
    fill("ann@example.com", "pw");
    expect(await screen.findByRole("heading", { name: "Committee area" })).toBeInTheDocument();
  });

  it("shows a clear message for a wrong password and stays on the page", async () => {
    server(null, () =>
      json(401, { error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password" } }),
    );
    renderAt("/login");
    await screen.findByRole("heading", { name: "Sign in" });
    fill("ann@example.com", "bad");
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password.");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("explains rate limiting and generic failures", async () => {
    let status = 429;
    server(null, () => json(status, { error: { code: "RATE_LIMITED", message: "slow down" } }));
    renderAt("/login");
    await screen.findByRole("heading", { name: "Sign in" });
    fill("ann@example.com", "pw");
    expect(await screen.findByRole("alert")).toHaveTextContent(/too many attempts/i);
    status = 500;
    fill("ann@example.com", "pw");
    expect(await screen.findByText(/could not sign in/i)).toBeInTheDocument();
  });

  it("sends an already signed-in user straight to their area", async () => {
    const fetchMock = server(user);
    renderAt("/login");
    expect(await screen.findByRole("heading", { name: "Committee area" })).toBeInTheDocument();
    expect(calls(fetchMock)).not.toContain("POST /api/auth/login");
  });
});
