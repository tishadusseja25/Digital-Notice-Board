import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, stubFetch } from "../testUtils";
import NoticeDetail from "./NoticeDetail";

const notice = {
  id: "n1",
  title: "Exam timetable",
  body: "Line one\nLine two",
  category: { id: "c1", name: "Exams" },
  images: [
    { id: "i1", alt: "Timetable photo" },
    { id: "i2", alt: "Seating plan" },
  ],
  pinned: false,
  publishedAt: "2026-11-10T16:00:00.000Z",
  expiresAt: null,
  createdAt: "2026-11-10T16:00:00.000Z",
  updatedAt: "2026-11-10T16:00:00.000Z",
};
const renderDetail = () =>
  render(
    <MemoryRouter initialEntries={["/notices/n1"]}>
      <Routes>
        <Route path="/notices/:id" element={<NoticeDetail />} />
      </Routes>
    </MemoryRouter>,
  );

afterEach(() => vi.unstubAllGlobals());

describe("NoticeDetail", () => {
  it("shows the full notice and every image from the original file", async () => {
    stubFetch(() => json(200, { notice }));
    renderDetail();
    expect(await screen.findByRole("heading", { name: "Exam timetable" })).toBeInTheDocument();
    expect(screen.getByText("Exams")).toBeInTheDocument();
    expect(screen.getByText(/Line one/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Timetable photo" })).toHaveAttribute(
      "src",
      "/api/images/i1",
    );
    expect(screen.getByRole("img", { name: "Seating plan" })).toHaveAttribute(
      "src",
      "/api/images/i2",
    );
  });

  it("renders text as plain text, never as HTML", async () => {
    const hostile = {
      ...notice,
      title: "<img src=x onerror=alert(1)>",
      body: "<script>alert(1)</script>",
      images: [],
    };
    stubFetch(() => json(200, { notice: hostile }));
    const { container } = renderDetail();
    expect(await screen.findByText("<script>alert(1)</script>")).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("explains that a missing, draft or expired notice is no longer available", async () => {
    stubFetch(() => json(404, { error: { code: "NOT_FOUND", message: "Notice not found" } }));
    renderDetail();
    expect(
      await screen.findByRole("heading", { name: /no longer available/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to the notice board/i })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("shows a generic error for other failures", async () => {
    stubFetch(() => json(500, { error: { code: "INTERNAL", message: "x" } }));
    renderDetail();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load this notice.");
  });
});
