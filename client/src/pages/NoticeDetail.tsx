import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, api } from "../lib/api";
import { formatDateTime } from "../lib/format";
import type { Notice } from "../store/noticesStore";

type View =
  { state: "loading" } | { state: "gone" } | { state: "error" } | { state: "ok"; notice: Notice };

export default function NoticeDetail() {
  const { id } = useParams();
  const [view, setView] = useState<View>({ state: "loading" });

  useEffect(() => {
    let current = true; // ignore the answer if the visitor already moved on
    setView({ state: "loading" });
    api<{ notice: Notice }>(`/notices/${id}`)
      .then(({ notice }) => current && setView({ state: "ok", notice }))
      .catch((err) => {
        if (!current) return;
        setView({ state: err instanceof ApiError && err.status === 404 ? "gone" : "error" });
      });
    return () => {
      current = false;
    };
  }, [id]);

  const back = (
    <Link to="/" className="underline">
      Back to the notice board
    </Link>
  );

  if (view.state === "loading") return <p aria-busy="true">Loading notice…</p>;
  if (view.state === "gone") {
    return (
      <div>
        <h1 className="mb-2 text-2xl font-bold">This notice is no longer available</h1>
        {back}
      </div>
    );
  }
  if (view.state === "error") {
    return (
      <div>
        <p role="alert" className="mb-2">
          Could not load this notice.
        </p>
        {back}
      </div>
    );
  }

  const { notice } = view;
  return (
    <article>
      <p className="mb-4">{back}</p>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-700">
          {notice.category.name}
        </span>
        <time dateTime={notice.publishedAt ?? undefined} className="text-slate-600">
          {formatDateTime(notice.publishedAt)}
        </time>
      </div>
      <h1 className="mb-4 text-2xl font-bold">{notice.title}</h1>
      <p className="mb-6 whitespace-pre-line">{notice.body}</p>
      <div className="space-y-4">
        {notice.images.map((image) => (
          // Original file, scaled only by CSS so quality is never reduced.
          <img
            key={image.id}
            src={`/api/images/${image.id}`}
            alt={image.alt}
            loading="lazy"
            className="h-auto max-w-full rounded border border-slate-200"
          />
        ))}
      </div>
    </article>
  );
}
