import { Link } from "react-router-dom";
import { categoryStyle } from "../lib/category";
import { formatDateTime } from "../lib/format";
import type { Notice } from "../store/noticesStore";

type Props = { notice: Notice; variant?: "row" | "feature"; fresh?: boolean };

export default function NoticeCard({ notice, variant = "row", fresh = false }: Props) {
  const image = notice.images[0];
  const style = categoryStyle(notice.category.name);
  const when = notice.publishedAt ?? notice.createdAt;
  const date = new Date(when);

  const chips = (
    <div className="flex flex-wrap items-center gap-2">
      {notice.pinned && <span className="badge bg-marigold text-ink">Pinned</span>}
      <span className={`badge ${style.chip}`}>{notice.category.name}</span>
      <time dateTime={when} className="text-xs text-muted">
        {formatDateTime(when)}
      </time>
    </div>
  );
  const title = (size: string) => (
    <h2 className={`font-display font-bold ${size}`}>
      <Link to={`/notices/${notice.id}`} className="hover:underline focus:underline">
        {notice.title}
      </Link>
    </h2>
  );

  if (variant === "feature") {
    return (
      <li
        data-fresh={fresh || undefined}
        className={`flex flex-col overflow-hidden rounded-lg border border-line border-t-4 border-t-marigold bg-white ${fresh ? "animate-arrive ring-2 ring-marigold" : ""}`}
      >
        {image && (
          // The original file is served untouched; CSS only scales how it is shown.
          <img
            src={`/api/images/${image.id}`}
            alt={image.alt}
            loading="lazy"
            className="aspect-[16/9] w-full object-cover"
          />
        )}
        <div className="flex flex-1 flex-col gap-3 p-5">
          {chips}
          {title("text-xl leading-snug sm:text-2xl")}
          <p className="line-clamp-3 whitespace-pre-line text-muted">{notice.body}</p>
        </div>
      </li>
    );
  }

  return (
    <li
      data-fresh={fresh || undefined}
      className={`relative flex gap-4 border-b border-line py-4 pl-6 pr-4 last:border-b-0 ${fresh ? "animate-arrive bg-[#FFF8DC]" : "bg-white"}`}
    >
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1.5 ${style.bar}`} />
      <div aria-hidden="true" className="w-12 shrink-0 text-center">
        <div className="font-display text-3xl font-bold leading-none">{date.getDate()}</div>
        <div className="mt-1 text-xs font-semibold text-muted">
          {date.toLocaleDateString(undefined, { month: "short" })}
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        {chips}
        {title("text-lg leading-snug")}
        <p className="line-clamp-2 whitespace-pre-line text-sm text-muted">{notice.body}</p>
      </div>
      {image && (
        <img
          src={`/api/images/${image.id}`}
          alt={image.alt}
          loading="lazy"
          className="h-16 w-20 shrink-0 rounded-md border border-line object-cover sm:h-20 sm:w-28"
        />
      )}
    </li>
  );
}
