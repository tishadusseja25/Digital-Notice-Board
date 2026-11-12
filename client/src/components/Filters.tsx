import { useState, type FormEvent } from "react";
import type { BoardQuery, Category } from "../store/noticesStore";

type Props = {
  value: BoardQuery;
  categories: Category[];
  onSearch: (next: BoardQuery) => void;
};

const field = "field";
const label = "field-label";

export default function Filters({ value, categories, onSearch }: Props) {
  const [draft, setDraft] = useState({
    q: value.q ?? "",
    category: value.category ?? "",
    from: value.from ?? "",
    to: value.to ?? "",
  });
  // On a phone the extra filters start folded away (open when one is already in use).
  const [open, setOpen] = useState(Boolean(value.category || value.from || value.to));
  const active = [draft.category, draft.from, draft.to].filter(Boolean).length;
  const set = (key: keyof typeof draft) => (e: { target: { value: string } }) =>
    setDraft({ ...draft, [key]: e.target.value });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSearch({ ...draft }); // empty strings are dropped when the address is built
  };
  const clear = () => {
    setDraft({ q: "", category: "", from: "", to: "" });
    onSearch({});
  };

  return (
    <form
      onSubmit={submit}
      role="search"
      aria-label="Filter notices"
      className="panel mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end"
    >
      <div className="sm:col-span-2 lg:col-span-1">
        <label htmlFor="q" className={label}>
          Search
        </label>
        <input
          id="q"
          type="search"
          maxLength={100}
          value={draft.q}
          onChange={set("q")}
          className={field}
        />
      </div>
      <div id="filter-fields" className={`${open ? "grid" : "hidden"} gap-3 sm:contents`}>
        <div>
          <label htmlFor="category" className={label}>
            Category
          </label>
          <select id="category" value={draft.category} onChange={set("category")} className={field}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:contents">
          <div>
            <label htmlFor="from" className={label}>
              From
            </label>
            <input
              id="from"
              type="date"
              value={draft.from}
              onChange={set("from")}
              className={field}
            />
          </div>
          <div>
            <label htmlFor="to" className={label}>
              To
            </label>
            <input id="to" type="date" value={draft.to} onChange={set("to")} className={field} />
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-1">
        <button
          type="button"
          className="btn btn-quiet sm:hidden"
          aria-expanded={open}
          aria-controls="filter-fields"
          onClick={() => setOpen(!open)}
        >
          {open ? "Hide filters" : active > 0 ? `Filters (${active})` : "Filters"}
        </button>
        <button type="submit" className="btn btn-primary">
          Search
        </button>
        <button type="button" onClick={clear} className="btn btn-quiet">
          Clear
        </button>
      </div>
    </form>
  );
}
