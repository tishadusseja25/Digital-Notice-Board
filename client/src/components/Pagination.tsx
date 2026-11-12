type Props = { page: number; limit: number; total: number; onChange: (page: number) => void };

export default function Pagination({ page, limit, total, onChange }: Props) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pages" className="mt-8 flex items-center justify-between gap-4">
      <button
        type="button"
        className="btn btn-quiet"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        Previous
      </button>
      <span className="text-sm font-semibold text-muted">
        Page {page} of {pages}
      </span>
      <button
        type="button"
        className="btn btn-quiet"
        disabled={page >= pages}
        onClick={() => onChange(page + 1)}
      >
        Next
      </button>
    </nav>
  );
}
