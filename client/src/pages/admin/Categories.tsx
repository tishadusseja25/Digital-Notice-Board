import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ApiError, api } from "../../lib/api";

type Category = { id: string; name: string };
type Pending = { id: string; kind: "rename" | "delete" } | null;

const input = "rounded border border-slate-300 bg-white px-3 py-2 text-sm";
const button =
  "rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-100 disabled:opacity-50";

const messageFor = (err: unknown) => {
  if (err instanceof ApiError) return (err.fields && Object.values(err.fields)[0]) ?? err.message;
  return "That did not work. Please try again.";
};

export default function AdminCategories() {
  const [items, setItems] = useState<Category[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems((await api<{ items: Category[] }>("/categories")).items);
    } catch {
      setError("Could not load categories.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (work: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      after?.();
      await load();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  const add = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const name = String(new FormData(form).get("name"));
    void run(
      () => api("/categories", { method: "POST", body: { name } }),
      () => form.reset(),
    );
  };

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Categories</h1>
      {error && (
        <p role="alert" className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-red-800">
          {error}
        </p>
      )}

      <form
        onSubmit={add}
        aria-label="Add category"
        className="mb-6 flex flex-wrap items-end gap-2"
      >
        <div>
          <label htmlFor="new-category" className="block text-sm font-medium">
            New category
          </label>
          <input id="new-category" name="name" required maxLength={40} className={input} />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700 disabled:opacity-60"
        >
          Add
        </button>
      </form>

      {!items && !error && <p>Loading…</p>}
      {items && items.length === 0 && <p>No categories yet.</p>}
      {items && items.length > 0 && (
        <ul className="space-y-2">
          {items.map((c) => {
            const open = pending?.id === c.id ? pending.kind : null;
            return (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3"
              >
                {open === "rename" ? (
                  <form
                    className="flex flex-wrap items-end gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run(
                        () =>
                          api(`/categories/${c.id}`, { method: "PATCH", body: { name: draft } }),
                        () => setPending(null),
                      );
                    }}
                  >
                    <div>
                      <label htmlFor={`rename-${c.id}`} className="block text-sm font-medium">
                        New name for {c.name}
                      </label>
                      <input
                        id={`rename-${c.id}`}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        required
                        maxLength={40}
                        className={input}
                      />
                    </div>
                    <button type="submit" disabled={busy} className={button}>
                      Save
                    </button>
                    <button type="button" className={button} onClick={() => setPending(null)}>
                      Cancel
                    </button>
                  </form>
                ) : (
                  <>
                    <span className="font-medium">{c.name}</span>
                    <div className="flex gap-2">
                      {open === "delete" ? (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            className="rounded bg-red-700 px-3 py-1 text-sm text-white hover:bg-red-800 disabled:opacity-50"
                            onClick={() =>
                              void run(
                                () => api(`/categories/${c.id}`, { method: "DELETE" }),
                                () => setPending(null),
                              )
                            }
                          >
                            Confirm delete
                          </button>
                          <button type="button" className={button} onClick={() => setPending(null)}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className={button}
                            onClick={() => {
                              setDraft(c.name);
                              setError(null);
                              setPending({ id: c.id, kind: "rename" });
                            }}
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            className={button}
                            onClick={() => {
                              setError(null);
                              setPending({ id: c.id, kind: "delete" });
                            }}
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
