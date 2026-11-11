import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
import { useNoticesStore } from "../../store/noticesStore";
import { useSessionStore, type User } from "../../store/sessionStore";
import { calls, json, stubFetch, user } from "../../testUtils";

const temp: User = { ...user, mustChangePassword: true };
const emptyList = { items: [], total: 0, page: 1, limit: 20 };

/** Fake server for a signed-in user; `password` decides the answer to POST /auth/password. */
function server(me: User, password: () => Response = () => json(204)) {
  return stubFetch((url, init) => {
    if (url === "/api/auth/me") return json(200, { user: me });
    if (url === "/api/auth/password" && init?.method === "POST") return password();
    return json(200, emptyList);
  });
}
const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
const fill = (current: string, next: string, confirm = next) => {
  fireEvent.change(screen.getByLabelText("Current password"), { target: { value: current } });
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: next } });
  fireEvent.change(screen.getByLabelText("Repeat new password"), { target: { value: confirm } });
  fireEvent.click(screen.getByRole("button", { name: "Change password" }));
};
const passwordCalls = (mock: ReturnType<typeof stubFetch>) =>
  calls(mock).filter((c) => c === "POST /api/auth/password");

beforeEach(() => {
  useSessionStore.setState({ user: null, status: "loading" });
  useNoticesStore.setState({ items: [], total: 0, loading: true, error: null, categories: [] });
});
afterEach(() => vi.unstubAllGlobals());

describe("change password page", () => {
  it("checks length and matching on the page before asking the server", async () => {
    const fetchMock = server(user);
    renderAt("/account/password");
    await screen.findByRole("heading", { name: "Change password" });

    fill("old-password", "short");
    expect(await screen.findByText(/at least 10 characters/i)).toBeInTheDocument();
    fill("old-password", "a-long-new-password", "a-different-one");
    expect(await screen.findByText(/do not match/i)).toBeInTheDocument();
    expect(passwordCalls(fetchMock)).toHaveLength(0);
  });

  it("shows the server's message when the current password is wrong", async () => {
    server(user, () =>
      json(400, {
        error: {
          code: "VALIDATION",
          message: "Invalid input",
          fields: { current: "Current password is wrong" },
        },
      }),
    );
    renderAt("/account/password");
    await screen.findByRole("heading", { name: "Change password" });
    fill("wrong", "a-long-new-password");
    expect(await screen.findByText("Current password is wrong")).toBeInTheDocument();
    expect(screen.getByLabelText("Current password")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Change password" })).toBeEnabled();
  });

  it("shows a general message when the request fails", async () => {
    server(user, () => json(500, { error: { code: "INTERNAL", message: "x" } }));
    renderAt("/account/password");
    await screen.findByRole("heading", { name: "Change password" });
    fill("old-password", "a-long-new-password");
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not change the password");
  });

  it("changes the password and goes to the user's area", async () => {
    const fetchMock = server(user);
    renderAt("/account/password");
    await screen.findByRole("heading", { name: "Change password" });
    fill("old-password", "a-long-new-password");
    expect(await screen.findByRole("heading", { name: "My notices" })).toBeInTheDocument();
    const sent = fetchMock.mock.calls.find(([u]) => u === "/api/auth/password")?.[1]?.body;
    expect(JSON.parse(String(sent))).toEqual({
      current: "old-password",
      next: "a-long-new-password",
    });
  });

  it("needs a signed-in user", async () => {
    stubFetch((url) =>
      url.startsWith("/api/auth")
        ? json(401, { error: { code: "UNAUTHENTICATED", message: "x" } })
        : json(200, emptyList),
    );
    renderAt("/account/password");
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });
});

describe("temporary password rule", () => {
  it("sends a user with a temporary password to the change page from the staff areas", async () => {
    server(temp);
    renderAt("/committee");
    expect(await screen.findByRole("heading", { name: "Change password" })).toBeInTheDocument();
    expect(screen.getByText(/temporary password/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "My notices" })).not.toBeInTheDocument();
  });

  it("leaves the public board alone", async () => {
    server(temp);
    renderAt("/");
    expect(await screen.findByRole("heading", { name: "Latest notices" })).toBeInTheDocument();
  });

  it("lets the user into their area once the password has been changed", async () => {
    server(temp);
    renderAt("/account/password");
    await screen.findByRole("heading", { name: "Change password" });
    fill("temp-password", "a-long-new-password");
    expect(await screen.findByRole("heading", { name: "My notices" })).toBeInTheDocument();
    expect(useSessionStore.getState().user?.mustChangePassword).toBe(false);
  });
});
