import { Link } from "react-router-dom";
import { formatDateTime } from "../lib/format";
import type { Notice } from "../store/noticesStore";

export default function NoticeCard({ notice }: { notice: Notice }) {
  const image = notice.images[0];
  return (
    <li className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      {image && (
        // The original file is served untouched; CSS only scales how it is shown.
        <img
          src={`/api/images/${image.id}`}
          alt={image.alt}
          loading="lazy"
          className="h-44 w-full object-cover"
        />
      )}
      <div className="space-y-2 p-4">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {notice.pinned && (
            <span className="rounded bg-amber-100 px-2 py-0.5 font-semibold text-amber-900">
              Pinned
            </span>
          )}
          <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-700">
            {notice.category.name}
          </span>
          <time dateTime={notice.publishedAt ?? undefined} className="text-slate-600">
            {formatDateTime(notice.publishedAt)}
          </time>
        </div>
        <h2 className="text-lg font-semibold">
          <Link to={`/notices/${notice.id}`} className="hover:underline focus:underline">
            {notice.title}
          </Link>
        </h2>
        <p className="line-clamp-3 whitespace-pre-line text-sm text-slate-700">{notice.body}</p>
      </div>
    </li>
  );
}
