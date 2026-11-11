import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
import { useNoticesStore } from "../../store/noticesStore";
import { useSessionStore, type User } from "../../store/sessionStore";
import { calls, json, stubFetch, user } from "../../testUtils";

const admin: User = { ...user, id: "u0", name: "Root", email: "root@example.com", role: "admin" };
const row = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `u${n}`,
  name: `Person ${n}`,
  email: `p${n}@example.com`,
  role: "committee",
  active: true,
  mustChangePassword: false,
  createdAt: "2026-11-10T16:00:00.000Z",
  ...extra,
});
const list = (items: unknown[], total = items.length, page = 1) => ({
  items,
  total,
  page,
  limit: 20,
});
const err = (status: number, code: string, message: string, fields?: Record<string, string>) =>
  json(status, { error: { code, message, fields } });

type Handler = (url: string, init?: RequestInit) => Response | undefined;
/** Fake server: signed in as `me`, user list from `users`, and `custom` can answer anything first. */
function server(users: unknown[], me: User = admin, custom: Handler = () => undefined) {
  return stubFetch((url, init) => {
    const answer = custom(url, init);
    if (answer) return answer;
    if (url === "/api/auth/me") return json(200, { user: me });
    if (url.startsWith("/api/users") && (init?.method ?? "GET") === "GET")
      return json(200, list(users));
    if (url.startsWith("/api/users")) return json(200, { user: users[0] });
    return json(200, list([]));
  });
}
const renderAt = (path = "/admin/users") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
const rowOf = (name: string) => screen.getByRole("heading", { name }).closest("li")!;
const sent = (mock: ReturnType<typeof stubFetch>, method: string, url: string) => {
  const call = mock.mock.calls.find(([u, init]) => u === url && init?.method === method);
  return call ? JSON.parse(String(call[1]?.body)) : undefined;
};

beforeEach(() => {
  useSessionStore.setState({ user: null, status: "loading" });
  useNoticesStore.setState({ categories: [] });
});
afterEach(() => vi.unstubAllGlobals());

describe("access to the users page", () => {
  it("shows the 403 page to a committee member and the login page to a visitor", async () => {
    server([], user);
    const first = renderAt();
    expect(await screen.findByRole("heading", { name: /403/ })).toBeInTheDocument();
    first.unmount();

    useSessionStore.setState({ user: null, status: "loading" });
    stubFetch(() => err(401, "UNAUTHENTICATED", "Sign in required"));
    renderAt();
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("gives admins the tab bar", async () => {
    server([row(1)]);
    renderAt();
    await screen.findByRole("heading", { name: "Users" });
    const tabs = screen.getByRole("navigation", { name: "Admin" });
    expect(within(tabs).getByRole("link", { name: "Categories" })).toHaveAttribute(
      "href",
      "/admin/categories",
    );
  });
});

describe("user list", () => {
  it("shows role, status and the must-change-password flag, and no actions on your own row", async () => {
    server([
      { ...row(0), id: admin.id, name: "Root", role: "admin" },
      row(1, { active: false }),
      row(2, { mustChangePassword: true }),
    ]);
    renderAt();
    await screen.findByRole("heading", { name: "Person 1" });
    expect(within(rowOf("Person 1")).getByText("Disabled")).toBeInTheDocument();
    expect(within(rowOf("Person 2")).getByText("Must change password")).toBeInTheDocument();
    const own = rowOf("Root");
    expect(within(own).getByText("(you)")).toBeInTheDocument();
    expect(within(own).queryByRole("button")).not.toBeInTheDocument();
  });

  it("pages through the list", async () => {
    const fetchMock = stubFetch((url) =>
      url === "/api/auth/me" ? json(200, { user: admin }) : json(200, list([row(1)], 45)),
    );
    renderAt();
    await screen.findByRole("heading", { name: "Person 1" });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(calls(fetchMock).at(-1)).toBe("GET /api/users?page=2"));
  });

  it("shows an error when the list cannot be loaded", async () => {
    server([], admin, (url) =>
      url.startsWith("/api/users") ? err(500, "INTERNAL", "x") : undefined,
    );
    renderAt();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load users.");
  });
});

describe("creating accounts", () => {
  const fillAndSubmit = (email = "new@example.com", password = "temporary-password") => {
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "New Person" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "admin" } });
    fireEvent.change(screen.getByLabelText("Temporary password"), { target: { value: password } });
    fireEvent.submit(screen.getByRole("form", { name: "Create user" }));
  };

  it("sends the details, reloads the list and reminds the admin to pass the password on", async () => {
    const fetchMock = server([row(1)]);
    renderAt();
    await screen.findByRole("heading", { name: "Person 1" });
    fillAndSubmit();
    expect(await screen.findByText(/Account created for new@example.com/)).toBeInTheDocument();
    expect(sent(fetchMock, "POST", "/api/users")).toEqual({
      name: "New Person",
      email: "new@example.com",
      role: "admin",
      password: "temporary-password",
    });
    expect(calls(fetchMock).filter((c) => c === "GET /api/users?page=1").length).toBeGreaterThan(1);
  });

  it("shows the server's message beside the field for a duplicate email", async () => {
    server([row(1)], admin, (url, init) =>
      url === "/api/users" && init?.method === "POST"
        ? err(409, "CONFLICT", "Invalid input", { email: "That email is already in use" })
        : undefined,
    );
    renderAt();
    await screen.findByRole("heading", { name: "Person 1" });
    fillAndSubmit("p1@example.com");
    expect(await screen.findByText("That email is already in use")).toBeInTheDocument();
    expect(screen.queryByText(/Account created/)).not.toBeInTheDocument();
  });
});

describe("changing accounts", () => {
  it("disabling needs a second click and can be cancelled; enabling is immediate", async () => {
    const fetchMock = server([row(1), row(2, { active: false })]);
    renderAt();
    await screen.findByRole("heading", { name: "Person 1" });

    const first = rowOf("Person 1");
    fireEvent.click(within(first).getByRole("button", { name: "Disable" }));
    expect(sent(fetchMock, "PATCH", "/api/users/u1")).toBeUndefined();
    fireEvent.click(within(first).getByRole("button", { name: "Cancel" }));
    expect(within(first).getByRole("button", { name: "Disable" })).toBeInTheDocument();

    fireEvent.click(within(first).getByRole("button", { name: "Disable" }));
    fireEvent.click(within(first).getByRole("button", { name: "Confirm disable" }));
    await waitFor(() =>
      expect(sent(fetchMock, "PATCH", "/api/users/u1")).toEqual({ active: false }),
    );
    expect(await screen.findByText("Person 1 is now disabled.")).toBeInTheDocument();

    fireEvent.click(within(rowOf("Person 2")).getByRole("button", { name: "Enable" }));
    await waitFor(() =>
      expect(sent(fetchMock, "PATCH", "/api/users/u2")).toEqual({ active: true }),
    );
  });

  it("changing a role needs a second click", async () => {
    const fetchMock = server([row(1), row(2, { role: "admin" })]);
    renderAt();
    await screen.findByRole("heading", { name: "Person 1" });
    fireEvent.click(within(rowOf("Person 1")).getByRole("button", { name: "Make admin" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm make admin" }));
    await waitFor(() =>
      expect(sent(fetchMock, "PATCH", "/api/users/u1")).toEqual({ role: "admin" }),
    );

    fireEvent.click(within(rowOf("Person 2")).getByRole("button", { name: "Make committee" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm make committee" }));
    await waitFor(() =>
      expect(sent(fetchMock, "PATCH", "/api/users/u2")).toEqual({ role: "committee" }),
    );
  });

  it("resets a password only when it is long enough", async () => {
    const fetchMock = server([row(1)]);
    renderAt();
    await screen.findByRole("heading", { name: "Person 1" });
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

    fireEvent.change(screen.getByLabelText(/New temporary password/), {
      target: { value: "short" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Set password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("at least 10 characters");
    expect(sent(fetchMock, "PATCH", "/api/users/u1")).toBeUndefined();

    fireEvent.change(screen.getByLabelText(/New temporary password/), {
      target: { value: "a-long-temporary-pw" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Set password" }));
    await waitFor(() =>
      expect(sent(fetchMock, "PATCH", "/api/users/u1")).toEqual({
        password: "a-long-temporary-pw",
      }),
    );
    expect(await screen.findByText("Password reset for p1@example.com.")).toBeInTheDocument();
  });

  it("shows the server's refusal and leaves the row as it was", async () => {
    server([row(1)], admin, (url, init) =>
      url === "/api/users/u1" && init?.method === "PATCH"
        ? err(409, "CANNOT_CHANGE_SELF", "You cannot change your own role, status or password here")
        : undefined,
    );
    renderAt();
    await screen.findByRole("heading", { name: "Person 1" });
    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm disable" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You cannot change your own");
    expect(within(rowOf("Person 1")).getByText("Active")).toBeInTheDocument();
  });
});
