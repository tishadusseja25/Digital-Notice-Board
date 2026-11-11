import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Notice } from "../../store/noticesStore";
import { useSessionStore } from "../../store/sessionStore";
import { calls, json, stubFetch } from "../../testUtils";
import CommitteeHome from "./Home";

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
  updatedAt: "2026-11-10T17:00:00.000Z",
  status: "published",
  authorId: "u1",
  ...extra,
});
const page = (items: Notice[], total = items.length, pageNo = 1) => ({
  items,
  total,
  page: pageNo,
  limit: 20,
});

const Where = () => {
  const { search } = useLocation();
  return <output data-testid="where">{search}</output>;
};
const renderHome = (path = "/committee", state?: unknown) =>
  render(
    <MemoryRouter
      initialEntries={[{ pathname: path.split("?")[0], search: path.split("?")[1] ?? "", state }]}
    >
      <Routes>
        <Route path="/committee" element={<CommitteeHome />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );

afterEach(() => vi.unstubAllGlobals());

describe("My notices", () => {
  it("lists notices with status, category, dates and a link to the public page", async () => {
    stubFetch(() =>
      json(200, page([notice(1), notice(2, { status: "draft", publishedAt: null })])),
    );
    renderHome();
    expect(await screen.findByRole("heading", { name: "Notice 1" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Notice 1" })).toHaveAttribute("href", "/notices/id1");
    expect(screen.getByText("draft")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Edit" })[0]).toHaveAttribute(
      "href",
      "/committee/id1/edit",
    );
    expect(screen.getByRole("link", { name: "New notice" })).toHaveAttribute(
      "href",
      "/committee/new",
    );
    expect(screen.getAllByText("Exams")).toHaveLength(2);
  });

  it("marks a published notice past its expiry date as Expired, but not a future one", async () => {
    stubFetch(() =>
      json(
        200,
        page([
          notice(1, { expiresAt: "2020-01-01T00:00:00.000Z" }),
          notice(2, { expiresAt: "2999-01-01T00:00:00.000Z" }),
        ]),
      ),
    );
    renderHome();
    await screen.findByRole("heading", { name: "Notice 1" });
    expect(screen.getAllByText("Expired")).toHaveLength(1);
    const first = screen.getByRole("heading", { name: "Notice 1" }).closest("li")!;
    expect(within(first).getByText("Expired")).toBeInTheDocument();
  });

  it("filters by status through the address bar", async () => {
    const fetchMock = stubFetch(() => json(200, page([notice(1)])));
    renderHome();
    await screen.findByRole("heading", { name: "Notice 1" });
    fireEvent.change(screen.getByLabelText("Show"), { target: { value: "draft" } });
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("?status=draft"));
    await waitFor(() =>
      expect(calls(fetchMock).at(-1)).toBe("GET /api/me/notices?status=draft&page=1"),
    );
  });

  it("shows empty, error and saved messages", async () => {
    stubFetch(() => json(200, page([])));
    const first = renderHome("/committee", { saved: true });
    expect(await screen.findByText("No notices here yet.")).toBeInTheDocument();
    expect(screen.getByText("Saved.")).toBeInTheDocument();
    first.unmount();

    stubFetch(() => json(500, { error: { code: "INTERNAL", message: "x" } }));
    renderHome();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load your notices.");
  });

  it("archive needs a second click and can be cancelled", async () => {
    const fetchMock = stubFetch((url, init) =>
      init?.method === "DELETE" ? json(204) : json(200, page([notice(1)])),
    );
    renderHome();
    await screen.findByRole("heading", { name: "Notice 1" });

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(calls(fetchMock).some((c) => c.startsWith("DELETE"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm archive" }));
    await waitFor(() => expect(calls(fetchMock)).toContain("DELETE /api/notices/id1?mode=archive"));
    await waitFor(() => expect(calls(fetchMock).at(-1)).toBe("GET /api/me/notices?page=1"));
  });

  it("delete needs a second click and sends a plain delete", async () => {
    const fetchMock = stubFetch((url, init) =>
      init?.method === "DELETE" ? json(204) : json(200, page([notice(1)])),
    );
    renderHome();
    await screen.findByRole("heading", { name: "Notice 1" });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(calls(fetchMock)).toContain("DELETE /api/notices/id1"));
  });

  it("offers no Archive button for an archived notice", async () => {
    stubFetch(() => json(200, page([notice(1, { status: "archived" })])));
    renderHome();
    await screen.findByRole("heading", { name: "Notice 1" });
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("keeps the notice and shows the server's message when an action fails", async () => {
    stubFetch((url, init) =>
      init?.method === "DELETE"
        ? json(403, {
            error: { code: "FORBIDDEN", message: "You can only change your own notices" },
          })
        : json(200, page([notice(1)])),
    );
    renderHome();
    await screen.findByRole("heading", { name: "Notice 1" });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You can only change your own notices",
    );
    expect(screen.getByRole("heading", { name: "Notice 1" })).toBeInTheDocument();
  });

  it("pages forward, and steps back when the last item of a later page is removed", async () => {
    let deleted = false;
    stubFetch((url, init) => {
      if (init?.method === "DELETE") {
        deleted = true;
        return json(204);
      }
      if (url.includes("page=2"))
        return json(200, deleted ? page([], 20, 2) : page([notice(21)], 21, 2));
      return json(200, page([notice(1)], 20, 1));
    });
    renderHome("/committee?page=2");
    await screen.findByRole("heading", { name: "Notice 21" });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(await screen.findByRole("heading", { name: "Notice 1" })).toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent(/^$/);
  });
});

describe("pin controls", () => {
  const asAdmin = () =>
    useSessionStore.setState({
      user: {
        id: "u9",
        name: "Root",
        email: "root@example.com",
        role: "admin",
        mustChangePassword: false,
      },
      status: "ready",
    });
  const pinCalls = (mock: ReturnType<typeof stubFetch>) =>
    calls(mock).filter((c) => c.includes("/pin"));
  const pinBody = (mock: ReturnType<typeof stubFetch>) => {
    const call = mock.mock.calls.find(([u]) => String(u).endsWith("/pin"));
    return JSON.parse(String(call?.[1]?.body));
  };

  afterEach(() => useSessionStore.setState({ user: null, status: "loading" }));

  it("lets an admin pin a published notice and unpin a pinned one, and shows the badge", async () => {
    asAdmin();
    const fetchMock = stubFetch((url, init) =>
      init?.method === "POST"
        ? json(200, { notice: notice(1) })
        : json(200, page([notice(1), notice(2, { pinned: true })])),
    );
    renderHome();
    await screen.findByRole("heading", { name: "Notice 1" });
    expect(
      within(screen.getByRole("heading", { name: "Notice 2" }).closest("li")!).getByText("Pinned"),
    ).toBeInTheDocument();

    fireEvent.click(
      within(screen.getByRole("heading", { name: "Notice 1" }).closest("li")!).getByRole("button", {
        name: "Pin",
      }),
    );
    await waitFor(() => expect(pinCalls(fetchMock)).toEqual(["POST /api/notices/id1/pin"]));
    expect(pinBody(fetchMock)).toEqual({ pinned: true });

    fireEvent.click(
      within(screen.getByRole("heading", { name: "Notice 2" }).closest("li")!).getByRole("button", {
        name: "Unpin",
      }),
    );
    await waitFor(() => expect(pinCalls(fetchMock)).toContain("POST /api/notices/id2/pin"));
  });

  it("offers Pin only for published notices that have not expired", async () => {
    asAdmin();
    stubFetch(() =>
      json(
        200,
        page([
          notice(1, { status: "draft" }),
          notice(2, { status: "archived" }),
          notice(3, { expiresAt: "2020-01-01T00:00:00.000Z" }),
          notice(4),
        ]),
      ),
    );
    renderHome();
    await screen.findByRole("heading", { name: "Notice 4" });
    expect(screen.getAllByRole("button", { name: "Pin" })).toHaveLength(1);
    expect(
      within(screen.getByRole("heading", { name: "Notice 4" }).closest("li")!).getByRole("button", {
        name: "Pin",
      }),
    ).toBeInTheDocument();
  });

  it("shows the server's message when the limit of three is reached", async () => {
    asAdmin();
    stubFetch((url, init) =>
      init?.method === "POST"
        ? json(409, {
            error: {
              code: "PIN_LIMIT",
              message: "At most 3 notices can be pinned. Unpin one first.",
            },
          })
        : json(200, page([notice(1)])),
    );
    renderHome();
    await screen.findByRole("heading", { name: "Notice 1" });
    fireEvent.click(screen.getByRole("button", { name: "Pin" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("At most 3 notices can be pinned");
  });

  it("gives committee members no pin buttons, only the badge", async () => {
    useSessionStore.setState({
      user: {
        id: "u1",
        name: "Ann",
        email: "ann@example.com",
        role: "committee",
        mustChangePassword: false,
      },
      status: "ready",
    });
    stubFetch(() => json(200, page([notice(1), notice(2, { pinned: true })])));
    renderHome();
    await screen.findByRole("heading", { name: "Notice 1" });
    expect(screen.queryByRole("button", { name: "Pin" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unpin" })).not.toBeInTheDocument();
    expect(screen.getByText("Pinned")).toBeInTheDocument();
  });
});
