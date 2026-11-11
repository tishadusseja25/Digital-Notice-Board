import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNoticesStore, type Notice } from "../../store/noticesStore";
import { calls, json, stubFetch } from "../../testUtils";
import NoticeEditor from "./NoticeEditor";

const categories = {
  items: [
    { id: "c1", name: "Exams" },
    { id: "c2", name: "Events" },
  ],
};
const existing = (extra: Partial<Notice> = {}): Notice => ({
  id: "n1",
  title: "Old title",
  body: "Old body",
  category: { id: "c1", name: "Exams" },
  images: [{ id: "i1", alt: "Old picture" }],
  pinned: false,
  publishedAt: null,
  expiresAt: null,
  createdAt: "2026-11-10T16:00:00.000Z",
  updatedAt: "2026-11-10T16:00:00.000Z",
  status: "draft",
  authorId: "u1",
  ...extra,
});

type Handler = (url: string, init?: RequestInit) => Response | undefined;
/** Fake server with sensible defaults; a test overrides only what it cares about. */
const server = (handler: Handler = () => undefined) =>
  stubFetch((url, init) => {
    const custom = handler(url, init);
    if (custom) return custom;
    if (url.startsWith("/api/categories")) return json(200, categories);
    if (url === "/api/images" && init?.method === "POST") {
      const alt = (init.body as FormData).get("alt");
      return json(201, { fileId: `new-${alt}`, alt });
    }
    if (url.startsWith("/api/images/") && init?.method === "DELETE") return json(204);
    if (url === "/api/notices" && init?.method === "POST") return json(201, { notice: existing() });
    if (url.startsWith("/api/notices/") && init?.method === "PATCH")
      return json(200, { notice: existing() });
    return json(404, { error: { code: "NOT_FOUND", message: "nope" } });
  });

const Saved = () => {
  const { state } = useLocation();
  return <p>Back on the list{state?.saved ? " (saved)" : ""}</p>;
};
const renderEditor = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/committee" element={<Saved />} />
        <Route path="/committee/new" element={<NoticeEditor />} />
        <Route path="/committee/:id/edit" element={<NoticeEditor />} />
      </Routes>
    </MemoryRouter>,
  );

const picture = (type = "image/png", size = 1000) => {
  const file = new File(["x"], "pic", { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
};
const attach = async (alt: string, file = picture()) => {
  fireEvent.change(screen.getByLabelText("Image description (alt text)"), {
    target: { value: alt },
  });
  fireEvent.change(screen.getByLabelText("Choose image"), { target: { files: [file] } });
};
const body = (mock: ReturnType<typeof stubFetch>, method: string, url: string) => {
  const call = mock.mock.calls.find(([u, init]) => u === url && init?.method === method);
  return JSON.parse(String(call?.[1]?.body));
};

beforeEach(() => useNoticesStore.setState({ categories: [] }));
afterEach(() => vi.unstubAllGlobals());

describe("new notice", () => {
  it("creates a notice with an uploaded image and returns to the list", async () => {
    const fetchMock = server();
    renderEditor("/committee/new");
    await screen.findByRole("option", { name: "Events" });

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Exam timetable" } });
    fireEvent.change(screen.getByLabelText("Text"), { target: { value: "Starts Monday" } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "c2" } });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "published" } });
    await attach("Timetable");

    const img = await screen.findByRole("img", { name: "Timetable" });
    expect(img).toHaveAttribute("src", "/api/images/new-Timetable");
    fireEvent.click(screen.getByRole("button", { name: "Create notice" }));

    expect(await screen.findByText("Back on the list (saved)")).toBeInTheDocument();
    expect(body(fetchMock, "POST", "/api/notices")).toEqual({
      title: "Exam timetable",
      body: "Starts Monday",
      categoryId: "c2",
      status: "published",
      expiresAt: null,
      images: [{ fileId: "new-Timetable", alt: "Timetable" }],
    });
  });

  it("uploads the file as chosen, with its alt text, and shows the location-data note", async () => {
    const fetchMock = server();
    renderEditor("/committee/new");
    await screen.findByRole("option", { name: "Events" });
    expect(screen.getByText(/location where a photo was taken/i)).toBeInTheDocument();
    const file = picture();
    await attach("Hall", file);
    await screen.findByRole("img", { name: "Hall" });
    const form = fetchMock.mock.calls.find(([u]) => u === "/api/images")?.[1]?.body as FormData;
    expect(form.get("file")).toBe(file);
    expect(form.get("alt")).toBe("Hall");
  });

  it("converts the expiry date to an exact timestamp", async () => {
    const fetchMock = server();
    renderEditor("/committee/new");
    await screen.findByRole("option", { name: "Events" });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "T" } });
    fireEvent.change(screen.getByLabelText("Text"), { target: { value: "B" } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "c1" } });
    fireEvent.change(screen.getByLabelText(/hide automatically/i), {
      target: { value: "2999-01-01T10:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create notice" }));
    await screen.findByText(/Back on the list/);
    expect(body(fetchMock, "POST", "/api/notices").expiresAt).toBe(
      new Date("2999-01-01T10:30").toISOString(),
    );
  });

  it("shows the server's messages beside the fields and stays on the form", async () => {
    server((url, init) =>
      url === "/api/notices" && init?.method === "POST"
        ? json(400, {
            error: {
              code: "VALIDATION",
              message: "Invalid input",
              fields: { title: "Too long", expiresAt: "Expiry must be in the future" },
            },
          })
        : undefined,
    );
    renderEditor("/committee/new");
    await screen.findByRole("option", { name: "Events" });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "T" } });
    fireEvent.change(screen.getByLabelText("Text"), { target: { value: "B" } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "c1" } });
    fireEvent.click(screen.getByRole("button", { name: "Create notice" }));
    expect(await screen.findByText("Too long")).toBeInTheDocument();
    expect(screen.getByText("Expiry must be in the future")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Create notice" })).toBeEnabled();
  });

  it("shows a general error when saving fails for another reason", async () => {
    server((url, init) =>
      url === "/api/notices" && init?.method === "POST"
        ? json(500, { error: { code: "INTERNAL", message: "Something went wrong" } })
        : undefined,
    );
    renderEditor("/committee/new");
    await screen.findByRole("option", { name: "Events" });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "T" } });
    fireEvent.change(screen.getByLabelText("Text"), { target: { value: "B" } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "c1" } });
    fireEvent.click(screen.getByRole("button", { name: "Create notice" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  });
});

describe("image rules in the browser", () => {
  const upload = (mock: ReturnType<typeof stubFetch>) =>
    calls(mock).filter((c) => c === "POST /api/images");

  it("needs a description, a supported type and a size under 10 MB before uploading", async () => {
    const fetchMock = server();
    renderEditor("/committee/new");
    await screen.findByRole("option", { name: "Events" });

    fireEvent.change(screen.getByLabelText("Choose image"), { target: { files: [picture()] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Describe the image first");

    await attach("Doc", picture("application/pdf"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only JPEG, PNG or WebP");

    await attach("Big", picture("image/png", 10 * 1024 * 1024 + 1));
    expect(await screen.findByRole("alert")).toHaveTextContent("larger than 10 MB");
    expect(upload(fetchMock)).toHaveLength(0);
  });

  it("refuses a sixth image", async () => {
    const fetchMock = server();
    renderEditor("/committee/new");
    await screen.findByRole("option", { name: "Events" });
    for (let i = 1; i <= 5; i++) {
      await attach(`Pic ${i}`);
      await screen.findByRole("img", { name: `Pic ${i}` });
    }
    await attach("Pic 6");
    expect(await screen.findByRole("alert")).toHaveTextContent("At most 5 images");
    expect(upload(fetchMock)).toHaveLength(5);
  });

  it("explains a rejected upload", async () => {
    server((url, init) =>
      url === "/api/images" && init?.method === "POST"
        ? json(413, { error: { code: "FILE_TOO_LARGE", message: "File is too large" } })
        : undefined,
    );
    renderEditor("/committee/new");
    await screen.findByRole("option", { name: "Events" });
    await attach("Huge");
    expect(await screen.findByRole("alert")).toHaveTextContent("larger than 10 MB");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("removing a just-uploaded image deletes it on the server", async () => {
    const fetchMock = server();
    renderEditor("/committee/new");
    await screen.findByRole("option", { name: "Events" });
    await attach("Temp");
    await screen.findByRole("img", { name: "Temp" });
    fireEvent.click(screen.getByRole("button", { name: "Remove image: Temp" }));
    await waitFor(() =>
      expect(screen.queryByRole("img", { name: "Temp" })).not.toBeInTheDocument(),
    );
    expect(calls(fetchMock)).toContain("DELETE /api/images/new-Temp");
  });
});

describe("edit notice", () => {
  const serveExisting = (notice: Notice) =>
    server((url, init) =>
      url === `/api/notices/${notice.id}` && init?.method === "GET"
        ? json(200, { notice })
        : undefined,
    );

  it("loads the notice, sends the changes, and drops a removed existing image without deleting it now", async () => {
    const fetchMock = serveExisting(existing({ expiresAt: "2999-01-01T10:30:00.000Z" }));
    renderEditor("/committee/n1/edit");
    expect(await screen.findByLabelText("Title")).toHaveValue("Old title");
    expect(screen.getByLabelText("Text")).toHaveValue("Old body");
    expect(screen.getByLabelText("Status")).toHaveValue("draft");
    await waitFor(() => expect(screen.getByLabelText("Category")).toHaveValue("c1"));
    expect(screen.getByRole("img", { name: "Old picture" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "New title" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove image: Old picture" }));
    await waitFor(() =>
      expect(screen.queryByRole("img", { name: "Old picture" })).not.toBeInTheDocument(),
    );
    expect(calls(fetchMock).some((c) => c.startsWith("DELETE"))).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Back on the list (saved)");
    const sent = body(fetchMock, "PATCH", "/api/notices/n1");
    expect(sent).toMatchObject({ title: "New title", images: [] });
    expect(sent.expiresAt).toBe("2999-01-01T10:30:00.000Z");
  });

  it("clears the expiry date when the field is emptied", async () => {
    const fetchMock = serveExisting(existing({ expiresAt: "2999-01-01T10:30:00.000Z" }));
    renderEditor("/committee/n1/edit");
    await screen.findByLabelText("Title");
    fireEvent.change(screen.getByLabelText(/hide automatically/i), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText(/Back on the list/);
    expect(body(fetchMock, "PATCH", "/api/notices/n1").expiresAt).toBeNull();
  });

  it("lets an archived notice be moved back to published", async () => {
    serveExisting(existing({ status: "archived" }));
    renderEditor("/committee/n1/edit");
    await screen.findByLabelText("Title");
    expect(screen.getByLabelText("Status")).toHaveValue("archived");
    expect(screen.getByRole("option", { name: /Published/ })).toBeInTheDocument();
  });

  it("does not offer the form for someone else's notice or a missing one", async () => {
    const { status: _status, authorId: _author, ...publicShape } = existing();
    void _status;
    void _author;
    serveExisting(publicShape as Notice);
    const first = renderEditor("/committee/n1/edit");
    expect(await screen.findByRole("heading", { name: /only edit your own/i })).toBeInTheDocument();
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
    first.unmount();

    server();
    renderEditor("/committee/zzz/edit");
    expect(await screen.findByRole("heading", { name: "Notice not found" })).toBeInTheDocument();
  });
});
