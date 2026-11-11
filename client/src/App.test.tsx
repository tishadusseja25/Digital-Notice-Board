import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { useSessionStore } from "./store/sessionStore";
import { json, stubFetch, user } from "./testUtils";

beforeEach(() => useSessionStore.setState({ user: null, status: "loading" }));
afterEach(() => vi.unstubAllGlobals());

const renderApp = () =>
  render(
    <MemoryRouter>
      <App />
    </MemoryRouter>,
  );

describe("App shell", () => {
  it("shows the site name and a Sign in link to a visitor", async () => {
    stubFetch((url) =>
      url.startsWith("/api/auth")
        ? json(401, { error: { code: "UNAUTHENTICATED", message: "x" } })
        : json(200, { items: [], total: 0, page: 1, limit: 20 }),
    );
    renderApp();
    expect(screen.getByRole("link", { name: /digital notice board/i })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /sign in/i })).toBeInTheDocument();
  });

  it("shows the user's name and a Sign out button when signed in", async () => {
    stubFetch((url) =>
      url === "/api/auth/me"
        ? json(200, { user })
        : json(200, { items: [], total: 0, page: 1, limit: 20 }),
    );
    renderApp();
    expect(await screen.findByRole("button", { name: /sign out/i })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("link", { name: user.name })).toHaveAttribute("href", "/committee"),
    );
    expect(screen.queryByRole("link", { name: /sign in/i })).not.toBeInTheDocument();
  });
});
