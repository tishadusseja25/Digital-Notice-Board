import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import Pagination from "../../components/Pagination";
import { ApiError, api } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { useSessionStore, type Role } from "../../store/sessionStore";

type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  mustChangePassword: boolean;
  createdAt: string | null;
};
type Page = { items: AdminUser[]; total: number; page: number; limit: number };
// One row at a time can be waiting for a second click or a typed password.
type Pending = { id: string; kind: "disable" | "role" | "reset" } | null;

const MIN_PASSWORD = 10;
const input = "w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm";
const button =
  "rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-100 disabled:opacity-50";
const danger =
  "rounded bg-red-700 px-3 py-1 text-sm text-white hover:bg-red-800 disabled:opacity-50";

const messageFor = (err: unknown) => {
  if (err instanceof ApiError) {
    const first = err.fields && Object.values(err.fields)[0];
    return first ?? err.message;
  }
  return "That did not work. Please try again.";
};

export default function AdminUsers() {
  const me = useSessionStore((s) => s.user);
  const [params, setParams] = useSearchParams();
  const pageNo = Number(params.get("page")) || 1;

  const [data, setData] = useState<Page | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setData(await api<Page>("/users", { query: { page: pageNo } }));
    } catch {
      setError("Could not load users.");
    }
  }, [pageNo]);
  useEffect(() => {
    void load();
  }, [load]);

  const patch = async (user: AdminUser, body: Record<string, unknown>, done: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api(`/users/${user.id}`, { method: "PATCH", body });
      setPending(null);
      setResetPassword("");
      setNotice(done);
      await load();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  const create = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const values = Object.fromEntries(new FormData(form)) as Record<string, string>;
    setCreateErrors({});
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await api("/users", { method: "POST", body: values });
      form.reset();
      setNotice(`Account created for ${values.email}. Give them the temporary password.`);
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setCreateErrors(err.fields);
      else setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  const goToPage = (p: number) => {
    const out = new URLSearchParams();
    if (p > 1) out.set("page", String(p));
    setParams(out);
  };

  const createError = (name: string) =>
    createErrors[name] && <p className="mt-1 text-sm text-red-700">{createErrors[name]}</p>;

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Users</h1>

      {notice && (
        <p className="mb-4 rounded border border-green-200 bg-green-50 p-3 text-green-900">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-red-800">
          {error}
        </p>
      )}

      <form
        onSubmit={create}
        aria-label="Create user"
        className="mb-8 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2"
      >
        <h2 className="text-lg font-semibold sm:col-span-2">Create an account</h2>
        <div>
          <label htmlFor="new-name" className="block text-sm font-medium">
            Name
          </label>
          <input id="new-name" name="name" required maxLength={80} className={input} />
          {createError("name")}
        </div>
        <div>
          <label htmlFor="new-email" className="block text-sm font-medium">
            Email
          </label>
          <input id="new-email" name="email" type="email" required className={input} />
          {createError("email")}
        </div>
        <div>
          <label htmlFor="new-role" className="block text-sm font-medium">
            Role
          </label>
          <select id="new-role" name="role" defaultValue="committee" className={input}>
            <option value="committee">Committee member</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div>
          <label htmlFor="new-password" className="block text-sm font-medium">
            Temporary password
          </label>
          <input
            id="new-password"
            name="password"
            type="text"
            required
            minLength={MIN_PASSWORD}
            autoComplete="off"
            className={input}
          />
          {createError("password")}
        </div>
        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700 disabled:opacity-60"
          >
            Create account
          </button>
        </div>
      </form>

      {!data && !error && <p>Loading…</p>}
      {data && (
        <ul className="space-y-3">
          {data.items.map((u) => {
            const self = u.id === me?.id;
            const open = pending?.id === u.id ? pending.kind : null;
            const otherRole: Role = u.role === "admin" ? "committee" : "admin";
            return (
              <li key={u.id} className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded bg-slate-100 px-2 py-0.5 font-semibold capitalize">
                    {u.role}
                  </span>
                  <span
                    className={`rounded px-2 py-0.5 font-semibold ${u.active ? "bg-green-100 text-green-900" : "bg-red-100 text-red-900"}`}
                  >
                    {u.active ? "Active" : "Disabled"}
                  </span>
                  {u.mustChangePassword && (
                    <span className="rounded bg-amber-100 px-2 py-0.5 font-semibold text-amber-900">
                      Must change password
                    </span>
                  )}
                  {self && <span className="text-slate-600">(you)</span>}
                </div>
                <h2 className="font-semibold">{u.name}</h2>
                <p className="mb-3 text-sm text-slate-700">
                  {u.email}
                  {u.createdAt && ` · created ${formatDateTime(u.createdAt)}`}
                </p>

                {self ? (
                  <p className="text-sm text-slate-600">
                    You cannot change your own role, status or password here. Use Password in the
                    header.
                  </p>
                ) : open === "reset" ? (
                  <form
                    className="flex flex-wrap items-end gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (resetPassword.length < MIN_PASSWORD) {
                        return setError(`Use at least ${MIN_PASSWORD} characters.`);
                      }
                      void patch(u, { password: resetPassword }, `Password reset for ${u.email}.`);
                    }}
                  >
                    <div>
                      <label htmlFor={`reset-${u.id}`} className="block text-sm font-medium">
                        New temporary password for {u.name}
                      </label>
                      <input
                        id={`reset-${u.id}`}
                        value={resetPassword}
                        onChange={(e) => setResetPassword(e.target.value)}
                        autoComplete="off"
                        className={input}
                      />
                    </div>
                    <button type="submit" className={danger} disabled={busy}>
                      Set password
                    </button>
                    <button type="button" className={button} onClick={() => setPending(null)}>
                      Cancel
                    </button>
                  </form>
                ) : open ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={danger}
                      disabled={busy}
                      onClick={() =>
                        open === "disable"
                          ? void patch(u, { active: false }, `${u.name} is now disabled.`)
                          : void patch(u, { role: otherRole }, `${u.name} is now ${otherRole}.`)
                      }
                    >
                      {open === "disable" ? "Confirm disable" : `Confirm make ${otherRole}`}
                    </button>
                    <button type="button" className={button} onClick={() => setPending(null)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {u.active ? (
                      <button
                        type="button"
                        className={button}
                        onClick={() => setPending({ id: u.id, kind: "disable" })}
                      >
                        Disable
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={button}
                        disabled={busy}
                        onClick={() =>
                          void patch(u, { active: true }, `${u.name} is enabled again.`)
                        }
                      >
                        Enable
                      </button>
                    )}
                    <button
                      type="button"
                      className={button}
                      onClick={() => setPending({ id: u.id, kind: "role" })}
                    >
                      Make {otherRole}
                    </button>
                    <button
                      type="button"
                      className={button}
                      onClick={() => {
                        setResetPassword("");
                        setError(null);
                        setPending({ id: u.id, kind: "reset" });
                      }}
                    >
                      Reset password
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {data && (
        <Pagination page={data.page} limit={data.limit} total={data.total} onChange={goToPage} />
      )}
    </div>
  );
}
