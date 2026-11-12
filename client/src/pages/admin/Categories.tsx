import { categoryStyle } from "../../lib/category";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ApiError, api } from "../../lib/api";

type Category = { id: string; name: string };
type Pending = { id: string; kind: "rename" | "delete" } | null;

const input = "field w-auto";
const button = "btn btn-quiet px-3 py-1";

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
      <h1 className="page-title">Categories</h1>
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
          <label htmlFor="new-category" className="field-label">
            New category
          </label>
          <input id="new-category" name="name" required maxLength={40} className={input} />
        </div>
        <button type="submit" disabled={busy} className="btn btn-primary">
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
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-white p-3"
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
                      <label htmlFor={`rename-${c.id}`} className="field-label">
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
                    <span className="flex items-center gap-2 font-semibold">
                      <span
                        aria-hidden="true"
                        className={`h-3 w-3 rounded-full ${categoryStyle(c.name).bar}`}
                      />
                      {c.name}
                    </span>
                    <div className="flex gap-2">
                      {open === "delete" ? (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            className="btn bg-cat-red px-3 py-1 text-white hover:opacity-90"
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
