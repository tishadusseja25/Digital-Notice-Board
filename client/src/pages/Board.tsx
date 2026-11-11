import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import Filters from "../components/Filters";
import NoticeCard from "../components/NoticeCard";
import Pagination from "../components/Pagination";
import { useNoticesStore, type BoardQuery } from "../store/noticesStore";

const KEYS = ["q", "category", "from", "to"] as const;

export default function Board() {
  const [params, setParams] = useSearchParams();
  const { items, total, page, limit, loading, error, categories, load, loadCategories } =
    useNoticesStore();

  // The address bar is the source of truth, so reloads and shared links show the same view.
  const query: BoardQuery = {};
  for (const key of KEYS) {
    const value = params.get(key);
    if (value) query[key] = value;
  }
  query.page = Number(params.get("page")) || 1;
  const queryKey = params.toString();

  useEffect(() => {
    void load(query);
    // `queryKey` is the serialised form of `query`, so it is the only dependency that matters.
  }, [queryKey, load]);
  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  const navigate = (next: BoardQuery) => {
    const out = new URLSearchParams();
    for (const [key, value] of Object.entries(next)) {
      if (value !== undefined && value !== "" && !(key === "page" && value === 1)) {
        out.set(key, String(value));
      }
    }
    setParams(out);
  };

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Latest notices</h1>
      <Filters
        key={queryKey}
        value={query}
        categories={categories}
        onSearch={(next) => navigate({ ...next, page: 1 })}
      />
      <div aria-busy={loading}>
        {error && (
          <p role="alert" className="rounded border border-red-200 bg-red-50 p-4 text-red-800">
            {error}{" "}
            <button type="button" className="underline" onClick={() => void load(query)}>
              Try again
            </button>
          </p>
        )}
        {!error && loading && items.length === 0 && <p>Loading notices…</p>}
        {!error && !loading && items.length === 0 && <p>No notices match.</p>}
        {!error && items.length > 0 && (
          <ul className="grid gap-4 sm:grid-cols-2">
            {items.map((n) => (
              <NoticeCard key={n.id} notice={n} />
            ))}
          </ul>
        )}
      </div>
      <Pagination
        page={page}
        limit={limit}
        total={total}
        onChange={(p) => navigate({ ...query, page: p })}
      />
    </div>
  );
}
