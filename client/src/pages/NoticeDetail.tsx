import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, api } from "../lib/api";
import { categoryStyle } from "../lib/category";
import { formatDateTime } from "../lib/format";
import { subscribeLive } from "../lib/socket";
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

  // Taken down while someone is reading it.
  useEffect(
    () =>
      subscribeLive((e) => {
        if (e.type === "notice:removed" && e.id === id) setView({ state: "gone" });
      }),
    [id],
  );

  const back = (
    <Link to="/" className="font-semibold text-signal underline">
      Back to the notice board
    </Link>
  );

  if (view.state === "loading")
    return (
      <p aria-busy="true" className="text-muted">
        Loading notice…
      </p>
    );
  if (view.state === "gone") {
    return (
      <div className="panel max-w-xl">
        <h1 className="mb-2 font-display text-2xl font-bold">This notice is no longer available</h1>
        <p className="mb-4 text-muted">It may have expired or been taken down by the committee.</p>
        {back}
      </div>
    );
  }
  if (view.state === "error") {
    return (
      <div className="panel max-w-xl">
        <p role="alert" className="mb-3 font-semibold">
          Could not load this notice.
        </p>
        {back}
      </div>
    );
  }

  const { notice } = view;
  const style = categoryStyle(notice.category.name);
  return (
    <article>
      <p className="mb-6 text-sm">{back}</p>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className={`badge ${style.chip}`}>{notice.category.name}</span>
        <time dateTime={notice.publishedAt ?? undefined} className="text-sm text-muted">
          {formatDateTime(notice.publishedAt)}
        </time>
      </div>
      <h1 className="mb-6 max-w-3xl font-display text-3xl font-bold sm:text-5xl">{notice.title}</h1>
      <p className="mb-8 max-w-prose whitespace-pre-line text-lg leading-relaxed">{notice.body}</p>
      <div className="space-y-6">
        {notice.images.map((image) => (
          // Original file, scaled only by CSS so quality is never reduced.
          <img
            key={image.id}
            src={`/api/images/${image.id}`}
            alt={image.alt}
            loading="lazy"
            className="h-auto max-w-full rounded-lg border border-line"
          />
        ))}
      </div>
    </article>
  );
}
