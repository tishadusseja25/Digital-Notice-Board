import { useEffect } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import Filters from "../components/Filters";
import NoticeCard from "../components/NoticeCard";
import Pagination from "../components/Pagination";
import { subscribeLive } from "../lib/socket";
import { useNoticesStore, type BoardQuery } from "../store/noticesStore";
import { useTitle } from "../lib/useTitle";

const KEYS = ["q", "category", "from", "to"] as const;

export default function Board() {
  useTitle();
  const [params, setParams] = useSearchParams();
  const signedOut = (useLocation().state as { signedOut?: boolean } | null)?.signedOut;
  const { items, total, page, limit, loading, error, categories, fresh, load, loadCategories } =
    useNoticesStore();
  const pinned = items.filter((n) => n.pinned);
  const rest = items.filter((n) => !n.pinned);

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

  // Live updates: any public change (or a reconnect) reloads this view; every 30 s notices past
  // their expiry time are dropped without asking the server.
  useEffect(() => {
    const { reload, dropExpired } = useNoticesStore.getState();
    const off = subscribeLive((e) => e.type !== "notice:changed" && reload());
    const timer = setInterval(dropExpired, 30_000);
    return () => {
      off();
      clearInterval(timer);
    };
  }, []);

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
      <h1 className="page-title">Latest notices</h1>
      {signedOut && (
        <p role="status" className="mb-6 rounded-lg border border-line bg-white p-3 text-sm">
          You have been signed out.
        </p>
      )}
      <Filters
        key={queryKey}
        value={query}
        categories={categories}
        onSearch={(next) => navigate({ ...next, page: 1 })}
      />
      <div aria-busy={loading}>
        {error && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
            {error}{" "}
            <button
              type="button"
              className="font-semibold underline"
              onClick={() => void load(query)}
            >
              Try again
            </button>
          </p>
        )}
        {!error && loading && items.length === 0 && <p className="text-muted">Loading notices…</p>}
        {!error && !loading && items.length === 0 && (
          <div className="panel">
            <p className="font-display text-xl font-bold">No notices match.</p>
            <p className="mt-1 text-muted">
              Try a different word, or clear the filters to see everything.
            </p>
          </div>
        )}
        {!error && pinned.length > 0 && (
          <section aria-label="Pinned notices" className="mb-8">
            <ul className="grid gap-4 md:grid-cols-3">
              {pinned.map((n) => (
                <NoticeCard key={n.id} notice={n} variant="feature" fresh={fresh.includes(n.id)} />
              ))}
            </ul>
          </section>
        )}
        {!error && rest.length > 0 && (
          <ul className="overflow-hidden rounded-lg border border-line bg-white">
            {rest.map((n) => (
              <NoticeCard key={n.id} notice={n} fresh={fresh.includes(n.id)} />
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
