type Props = { page: number; limit: number; total: number; onChange: (page: number) => void };

export default function Pagination({ page, limit, total, onChange }: Props) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return null;
  const button =
    "rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50";
  return (
    <nav aria-label="Pages" className="mt-6 flex items-center justify-between">
      <button
        type="button"
        className={button}
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        Previous
      </button>
      <span className="text-sm text-slate-700">
        Page {page} of {pages}
      </span>
      <button
        type="button"
        className={button}
        disabled={page >= pages}
        onClick={() => onChange(page + 1)}
      >
        Next
      </button>
    </nav>
  );
}
