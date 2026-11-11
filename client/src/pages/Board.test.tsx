import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNoticesStore, type Notice } from "../store/noticesStore";
import { calls, json, stubFetch } from "../testUtils";
import Board from "./Board";

const notice = (n: number, extra: Partial<Notice> = {}): Notice => ({
  id: `id${n}`,
  title: `Notice ${n}`,
  body: `Body ${n}`,
  category: { id: "c1", name: "Exams" },
  images: [],
  pinned: false,
  publishedAt: "2026-11-10T16:00:00.000Z",
  expiresAt: null,
  createdAt: "2026-11-10T16:00:00.000Z",
  updatedAt: "2026-11-10T16:00:00.000Z",
  ...extra,
});
const categories = {
  items: [
    { id: "c1", name: "Exams" },
    { id: "c2", name: "Events" },
  ],
};

/** Fake server: categories, plus whatever the test returns for the notice list. */
const server = (list: (url: string) => unknown) =>
  stubFetch((url) =>
    url.startsWith("/api/categories") ? json(200, categories) : json(200, list(url)),
  );

const Where = () => {
  const { search } = useLocation();
  return <output data-testid="where">{search}</output>;
};
const renderBoard = (path = "/") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Board />
      <Where />
    </MemoryRouter>,
  );
const page = (items: Notice[], total = items.length, pageNo = 1) => ({
  items,
  total,
  page: pageNo,
  limit: 20,
});

beforeEach(() =>
  useNoticesStore.setState({
    items: [],
    total: 0,
    page: 1,
    limit: 20,
    loading: true,
    error: null,
    categories: [],
  }),
);
afterEach(() => vi.unstubAllGlobals());

describe("Board", () => {
  it("lists notices with category, date, pinned badge and the first image", async () => {
    server(() =>
      page([notice(1, { pinned: true, images: [{ id: "img9", alt: "Exam hall" }] }), notice(2)]),
    );
    renderBoard();
    expect(await screen.findByRole("heading", { name: "Notice 1" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Notice 2" })).toBeInTheDocument();
    expect(screen.getByText("Pinned")).toBeInTheDocument();
    const img = screen.getByRole("img", { name: "Exam hall" });
    expect(img).toHaveAttribute("src", "/api/images/img9");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(screen.getByRole("link", { name: "Notice 1" })).toHaveAttribute("href", "/notices/id1");
  });

  it("shows an empty message when nothing matches", async () => {
    server(() => page([]));
    renderBoard();
    expect(await screen.findByText("No notices match.")).toBeInTheDocument();
  });

  it("shows an error with a working Try again button", async () => {
    let ok = false;
    stubFetch((url) => {
      if (url.startsWith("/api/categories")) return json(200, categories);
      return ok
        ? json(200, page([notice(1)]))
        : json(500, { error: { code: "INTERNAL", message: "x" } });
    });
    renderBoard();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load notices.");
    ok = true;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Notice 1" })).toBeInTheDocument();
  });

  it("reads filters and page from the address and fills the form", async () => {
    const fetchMock = server(() => page([notice(1)], 45, 2));
    renderBoard("/?q=exam&category=c1&from=2026-01-01&page=2");
    await screen.findByRole("heading", { name: "Notice 1" });
    expect(calls(fetchMock)[0]).toBe("GET /api/notices?q=exam&category=c1&from=2026-01-01&page=2");
    expect(screen.getByLabelText("Search")).toHaveValue("exam");
    expect(screen.getByLabelText("From")).toHaveValue("2026-01-01");
    await waitFor(() => expect(screen.getByLabelText("Category")).toHaveValue("c1"));
  });

  it("submitting the form puts the filters in the address and refetches from page 1", async () => {
    const fetchMock = server((url) => page(url.includes("q=camp") ? [notice(7)] : [notice(1)]));
    renderBoard("/?page=3");
    await screen.findByRole("heading", { name: "Notice 1" });

    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "camp" } });
    await waitFor(() => expect(screen.getByLabelText("Category")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "c2" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByRole("heading", { name: "Notice 7" })).toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent("?q=camp&category=c2");
    expect(screen.getByTestId("where").textContent).not.toContain("page");
    expect(calls(fetchMock).at(-1)).toBe("GET /api/notices?q=camp&category=c2&page=1");
  });

  it("Clear removes every filter", async () => {
    server(() => page([notice(1)]));
    renderBoard("/?q=exam");
    await screen.findByRole("heading", { name: "Notice 1" });
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^$/));
    expect(screen.getByLabelText("Search")).toHaveValue("");
  });

  it("pages forward and back, disabling the buttons at the ends", async () => {
    const fetchMock = server((url) => page([notice(1)], 45, url.includes("page=2") ? 2 : 1));
    renderBoard();
    await screen.findByRole("heading", { name: "Notice 1" });
    const nav = screen.getByRole("navigation", { name: "Pages" });
    expect(within(nav).getByText("Page 1 of 3")).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "Previous" })).toBeDisabled();

    fireEvent.click(within(nav).getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("?page=2"));
    expect(calls(fetchMock).at(-1)).toBe("GET /api/notices?page=2");
    await waitFor(() => expect(within(nav).getByText("Page 2 of 3")).toBeInTheDocument());

    fireEvent.click(within(nav).getByRole("button", { name: "Previous" }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^$/));
  });

  it("hides the pager when everything fits on one page", async () => {
    server(() => page([notice(1)]));
    renderBoard();
    await screen.findByRole("heading", { name: "Notice 1" });
    expect(screen.queryByRole("navigation", { name: "Pages" })).not.toBeInTheDocument();
  });
});
