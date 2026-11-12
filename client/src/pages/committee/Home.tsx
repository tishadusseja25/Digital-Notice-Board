import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import Pagination from "../../components/Pagination";
import { ApiError, api } from "../../lib/api";
import { categoryStyle } from "../../lib/category";
import { formatDateTime } from "../../lib/format";
import { subscribeLive } from "../../lib/socket";
import type { Notice } from "../../store/noticesStore";
import { useSessionStore } from "../../store/sessionStore";
import { useTitle } from "../../lib/useTitle";

const STATUS_STYLE = {
  published: "bg-cat-green-tint text-cat-green",
  draft: "bg-cat-orange-tint text-cat-orange",
  archived: "bg-cat-slate-tint text-cat-slate",
} as const;
const STATUSES = ["draft", "published", "archived"] as const;
type Pending = { id: string; action: "archive" | "delete" } | null;

type Page = { items: Notice[]; total: number; page: number; limit: number };

const button = "btn btn-quiet px-3 py-1";

export default function CommitteeHome() {
  useTitle("My notices");
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const isAdmin = useSessionStore((s) => s.user?.role === "admin");
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
  // Private live events: changes to my notices (all notices for admins), and reconnects.
  useEffect(
    () =>
      subscribeLive((e) => {
        if (e.type === "notice:changed" || e.type === "reconnected") void load();
      }),
    [load],
  );

  // Runs one change, then reloads the list; the message from the server is shown if it refuses.
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      setPending(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That did not work. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  const run = (id: string, action: "archive" | "delete") =>
    act(() =>
      api(`/notices/${id}`, {
        method: "DELETE",
        query: action === "archive" ? { mode: "archive" } : undefined,
      }),
    );
  const pin = (id: string, pinned: boolean) =>
    act(() => api(`/notices/${id}/pin`, { method: "POST", body: { pinned } }));

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
        <h1 className="page-title !mb-0">My notices</h1>
        <Link to="/committee/new" className="btn btn-primary">
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
          className="field w-auto"
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
              <li key={n.id} className="rounded-lg border border-line bg-white p-4">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                  <span className={`badge capitalize ${STATUS_STYLE[n.status ?? "draft"]}`}>
                    {n.status}
                  </span>
                  {n.pinned && <span className="badge bg-marigold text-ink">Pinned</span>}
                  {expired && <span className="badge bg-cat-red-tint text-cat-red">Expired</span>}
                  <span className={`badge ${categoryStyle(n.category.name).chip}`}>
                    {n.category.name}
                  </span>
                </div>
                <h2 className="font-display text-lg font-bold">
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
                      {isAdmin && (n.pinned || (n.status === "published" && !expired)) && (
                        <button
                          type="button"
                          className={button}
                          disabled={busy}
                          onClick={() => void pin(n.id, !n.pinned)}
                        >
                          {n.pinned ? "Unpin" : "Pin"}
                        </button>
                      )}
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
