import { useState, type FormEvent } from "react";
import type { BoardQuery, Category } from "../store/noticesStore";

type Props = {
  value: BoardQuery;
  categories: Category[];
  onSearch: (next: BoardQuery) => void;
};

const field = "w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm";
const label = "block text-sm font-medium text-slate-700";

export default function Filters({ value, categories, onSearch }: Props) {
  const [draft, setDraft] = useState({
    q: value.q ?? "",
    category: value.category ?? "",
    from: value.from ?? "",
    to: value.to ?? "",
  });
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
      className="mb-6 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2"
    >
      <div className="sm:col-span-2">
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
      <div className="grid grid-cols-2 gap-3">
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
      <div className="flex gap-2 sm:col-span-2">
        <button
          type="submit"
          className="rounded bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700"
        >
          Search
        </button>
        <button
          type="button"
          onClick={clear}
          className="rounded border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100"
        >
          Clear
        </button>
      </div>
    </form>
  );
}
