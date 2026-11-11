import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
import { useNoticesStore } from "../../store/noticesStore";
import { useSessionStore, type User } from "../../store/sessionStore";
import { calls, json, stubFetch, user } from "../../testUtils";

const admin: User = { ...user, id: "u0", name: "Root", role: "admin" };
const cats = [
  { id: "c1", name: "Exams" },
  { id: "c2", name: "Events" },
];
const err = (status: number, code: string, message: string, fields?: Record<string, string>) =>
  json(status, { error: { code, message, fields } });

type Handler = (url: string, init?: RequestInit) => Response | undefined;
function server(custom: Handler = () => undefined, items = cats) {
  return stubFetch((url, init) => {
    const answer = custom(url, init);
    if (answer) return answer;
    if (url === "/api/auth/me") return json(200, { user: admin });
    if (url === "/api/categories" && (init?.method ?? "GET") === "GET") return json(200, { items });
    return json(204);
  });
}
const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/admin/categories"]}>
      <App />
    </MemoryRouter>,
  );
const rowOf = (name: string) => screen.getByText(name).closest("li")!;
const sent = (mock: ReturnType<typeof stubFetch>, method: string, url: string) => {
  const call = mock.mock.calls.find(([u, init]) => u === url && init?.method === method);
  return call ? JSON.parse(String(call[1]?.body)) : undefined;
};

beforeEach(() => {
  useSessionStore.setState({ user: null, status: "loading" });
  useNoticesStore.setState({ categories: [] });
});
afterEach(() => vi.unstubAllGlobals());

describe("categories page", () => {
  it("lists the categories, or says there are none", async () => {
    server();
    const first = renderPage();
    expect(await screen.findByText("Exams")).toBeInTheDocument();
    expect(screen.getByText("Events")).toBeInTheDocument();
    first.unmount();

    useSessionStore.setState({ user: null, status: "loading" });
    server(() => undefined, []);
    renderPage();
    expect(await screen.findByText("No categories yet.")).toBeInTheDocument();
  });

  it("shows an error if the list cannot be loaded", async () => {
    server((url) => (url === "/api/categories" ? err(500, "INTERNAL", "x") : undefined));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load categories.");
  });

  it("adds a category and reloads the list", async () => {
    const fetchMock = server();
    renderPage();
    await screen.findByText("Exams");
    fireEvent.change(screen.getByLabelText("New category"), { target: { value: "Sports" } });
    fireEvent.submit(screen.getByRole("form", { name: "Add category" }));
    await waitFor(() =>
      expect(sent(fetchMock, "POST", "/api/categories")).toEqual({ name: "Sports" }),
    );
    await waitFor(() => expect(screen.getByLabelText("New category")).toHaveValue(""));
    expect(calls(fetchMock).filter((c) => c === "GET /api/categories").length).toBeGreaterThan(1);
  });

  it("shows the server's message for a duplicate name and keeps what was typed", async () => {
    server((url, init) =>
      url === "/api/categories" && init?.method === "POST"
        ? err(409, "CONFLICT", "Invalid input", { name: "That category already exists" })
        : undefined,
    );
    renderPage();
    await screen.findByText("Exams");
    fireEvent.change(screen.getByLabelText("New category"), { target: { value: "exams" } });
    fireEvent.submit(screen.getByRole("form", { name: "Add category" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That category already exists");
    expect(screen.getByLabelText("New category")).toHaveValue("exams");
  });

  it("renames a category", async () => {
    const fetchMock = server();
    renderPage();
    await screen.findByText("Exams");
    fireEvent.click(within(rowOf("Exams")).getByRole("button", { name: "Rename" }));
    const field = screen.getByLabelText("New name for Exams");
    expect(field).toHaveValue("Exams");
    fireEvent.change(field, { target: { value: "Tests" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(sent(fetchMock, "PATCH", "/api/categories/c1")).toEqual({ name: "Tests" }),
    );
    await waitFor(() =>
      expect(screen.queryByLabelText("New name for Exams")).not.toBeInTheDocument(),
    );
  });

  it("deleting needs a second click and can be cancelled", async () => {
    const fetchMock = server();
    renderPage();
    await screen.findByText("Exams");
    fireEvent.click(within(rowOf("Exams")).getByRole("button", { name: "Delete" }));
    expect(calls(fetchMock).some((c) => c.startsWith("DELETE"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(within(rowOf("Exams")).getByRole("button", { name: "Delete" })).toBeInTheDocument();

    fireEvent.click(within(rowOf("Exams")).getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(calls(fetchMock)).toContain("DELETE /api/categories/c1"));
  });

  it("explains that a category in use cannot be deleted", async () => {
    server((url, init) =>
      init?.method === "DELETE"
        ? err(409, "CATEGORY_IN_USE", "This category is used by notices and cannot be deleted")
        : undefined,
    );
    renderPage();
    await screen.findByText("Exams");
    fireEvent.click(within(rowOf("Exams")).getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("used by notices");
    expect(screen.getByText("Exams")).toBeInTheDocument();
  });

  it("is closed to committee members", async () => {
    server((url) => (url === "/api/auth/me" ? json(200, { user }) : undefined));
    renderPage();
    expect(await screen.findByRole("heading", { name: /403/ })).toBeInTheDocument();
  });
});
