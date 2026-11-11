import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import Pagination from "../../components/Pagination";
import { ApiError, api } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import type { Notice } from "../../store/noticesStore";

const STATUSES = ["draft", "published", "archived"] as const;
type Pending = { id: string; action: "archive" | "delete" } | null;

type Page = { items: Notice[]; total: number; page: number; limit: number };

const button =
  "rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-100 disabled:opacity-50";

export default function CommitteeHome() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const status = params.get("status") ?? "";
  const pageNo = Number(params.get("page")) || 1;

  const [data, setData] = useState<Page | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null); // waiting for the second click
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await api<Page>("/me/notices", {
        query: { status: status || undefined, page: pageNo },
      });
      // After deleting the last item of a later page, step back instead of showing an empty page.
      if (result.items.length === 0 && pageNo > 1) {
        const back = new URLSearchParams(params);
        if (pageNo - 1 > 1) back.set("page", String(pageNo - 1));
        else back.delete("page");
        setParams(back, { replace: true });
        return;
      }
      setData(result);
    } catch {
      setError("Could not load your notices.");
    }
    // `params` is only read when stepping back; `status` and `pageNo` are what trigger reloads.
  }, [status, pageNo]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (id: string, action: "archive" | "delete") => {
    setBusy(true);
    setError(null);
    try {
      await api(`/notices/${id}`, {
        method: "DELETE",
        query: action === "archive" ? { mode: "archive" } : undefined,
      });
      setPending(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That did not work. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const setFilter = (next: string) => {
    const out = new URLSearchParams();
    if (next) out.set("status", next);
    setParams(out);
  };
  const setPage = (p: number) => {
    const out = new URLSearchParams(params);
    if (p > 1) out.set("page", String(p));
    else out.delete("page");
    setParams(out);
  };

  const saved = (location.state as { saved?: boolean } | null)?.saved;
  const now = Date.now();

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">My notices</h1>
        <Link
          to="/committee/new"
          className="rounded bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700"
        >
          New notice
        </Link>
      </div>
      {saved && (
        <p
          role="status"
          className="mb-4 rounded border border-green-200 bg-green-50 p-3 text-green-900"
        >
          Saved.
        </p>
      )}
      <div className="mb-4">
        <label htmlFor="status" className="mr-2 text-sm font-medium">
          Show
        </label>
        <select
          id="status"
          value={status}
          onChange={(e) => setFilter(e.target.value)}
          className="rounded border border-slate-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">All notices</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s[0]!.toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-red-800">
          {error}
        </p>
      )}
      {!data && !error && <p>Loading…</p>}
      {data && data.items.length === 0 && <p>No notices here yet.</p>}
      {data && data.items.length > 0 && (
        <ul className="space-y-3">
          {data.items.map((n) => {
            const expired =
              n.status === "published" && !!n.expiresAt && new Date(n.expiresAt).getTime() < now;
            const confirming = pending?.id === n.id ? pending.action : null;
            return (
              <li key={n.id} className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded bg-slate-100 px-2 py-0.5 font-semibold capitalize">
                    {n.status}
                  </span>
                  {expired && (
                    <span className="rounded bg-amber-100 px-2 py-0.5 font-semibold text-amber-900">
                      Expired
                    </span>
                  )}
                  <span className="text-slate-600">{n.category.name}</span>
                </div>
                <h2 className="text-lg font-semibold">
                  <Link to={`/notices/${n.id}`} className="hover:underline">
                    {n.title}
                  </Link>
                </h2>
                <p className="mb-3 text-xs text-slate-600">
                  Updated {formatDateTime(n.updatedAt)}
                  {n.publishedAt && ` · Published ${formatDateTime(n.publishedAt)}`}
                  {n.expiresAt && ` · Expires ${formatDateTime(n.expiresAt)}`}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Link to={`/committee/${n.id}/edit`} className={button}>
                    Edit
                  </Link>
                  {confirming ? (
                    <>
                      <button
                        type="button"
                        className="rounded bg-red-700 px-3 py-1 text-sm text-white hover:bg-red-800 disabled:opacity-50"
                        disabled={busy}
                        onClick={() => void run(n.id, confirming)}
                      >
                        Confirm {confirming}
                      </button>
                      <button type="button" className={button} onClick={() => setPending(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      {n.status !== "archived" && (
                        <button
                          type="button"
                          className={button}
                          onClick={() => setPending({ id: n.id, action: "archive" })}
                        >
                          Archive
                        </button>
                      )}
                      <button
                        type="button"
                        className={button}
                        onClick={() => setPending({ id: n.id, action: "delete" })}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {data && (
        <Pagination page={data.page} limit={data.limit} total={data.total} onChange={setPage} />
      )}
    </div>
  );
}
