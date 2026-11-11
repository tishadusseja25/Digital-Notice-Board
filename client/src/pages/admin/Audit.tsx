import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Pagination from "../../components/Pagination";
import { api } from "../../lib/api";
import { formatDateTime } from "../../lib/format";

type Entry = {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  ip: string | null;
  at: string;
  actor: { id: string; name: string; email: string } | null;
};
type Page = { items: Entry[]; total: number; page: number; limit: number };

export default function AdminAudit() {
  const [params, setParams] = useSearchParams();
  const pageNo = Number(params.get("page")) || 1;
  const [data, setData] = useState<Page | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api<Page>("/audit", { query: { page: pageNo } }));
    } catch {
      setError("Could not load the audit log.");
    }
  }, [pageNo]);
  useEffect(() => {
    void load();
  }, [load]);

  const goToPage = (p: number) => {
    const out = new URLSearchParams();
    if (p > 1) out.set("page", String(p));
    setParams(out);
  };

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Audit log</h1>
      <p className="mb-4 text-sm text-slate-700">
        Newest first. Entries are kept for one year and cannot be changed.
      </p>
      {error && (
        <p role="alert" className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-red-800">
          {error}{" "}
          <button type="button" className="underline" onClick={() => void load()}>
            Try again
          </button>
        </p>
      )}
      {!data && !error && <p>Loading…</p>}
      {data && data.items.length === 0 && <p>Nothing has been logged yet.</p>}
      {data && data.items.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Audit log entries</caption>
            <thead className="bg-slate-100 text-xs uppercase text-slate-700">
              <tr>
                <th scope="col" className="px-3 py-2">
                  When
                </th>
                <th scope="col" className="px-3 py-2">
                  Who
                </th>
                <th scope="col" className="px-3 py-2">
                  Action
                </th>
                <th scope="col" className="px-3 py-2">
                  Target
                </th>
                <th scope="col" className="px-3 py-2">
                  IP address
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((e) => (
                <tr key={e.id} className="border-t border-slate-200 align-top">
                  <td className="whitespace-nowrap px-3 py-2">
                    <time dateTime={e.at}>{formatDateTime(e.at)}</time>
                  </td>
                  <td className="px-3 py-2">
                    {e.actor ? (
                      <>
                        {e.actor.name}
                        <br />
                        <span className="text-xs text-slate-600">{e.actor.email}</span>
                      </>
                    ) : (
                      <span className="text-slate-600">Unknown (not signed in)</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{e.action}</td>
                  <td className="px-3 py-2 text-xs">
                    {e.targetType ? `${e.targetType} ${e.targetId?.slice(-6) ?? ""}` : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs">{e.ip ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && (
        <Pagination page={data.page} limit={data.limit} total={data.total} onChange={goToPage} />
      )}
    </div>
  );
}
