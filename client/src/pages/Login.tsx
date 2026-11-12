import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { ApiError } from "../lib/api";
import { useSessionStore, type User } from "../store/sessionStore";

const areaFor = (user: User) => (user.role === "admin" ? "/admin" : "/committee");
// Only same-site paths: "//evil.example" or "https://..." in router state must never be followed.
const safePath = (value: unknown) =>
  typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : null;

const messageFor = (err: unknown) => {
  if (err instanceof ApiError && err.status === 401) return "Invalid email or password.";
  if (err instanceof ApiError && err.status === 429) {
    return "Too many attempts. Please wait a few minutes and try again.";
  }
  return "Could not sign in. Please try again.";
};

export default function Login() {
  const { user, login } = useSessionStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={areaFor(user)} replace />;

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const signedIn = await login(String(form.get("email")), String(form.get("password")));
      const from = safePath((location.state as { from?: unknown } | null)?.from);
      navigate(from ?? areaFor(signedIn), { replace: true });
    } catch (err) {
      setError(messageFor(err));
      setBusy(false);
    }
  };

  const field = "field";
  return (
    <div className="mx-auto max-w-sm">
      <h1 className="page-title">Sign in</h1>
      <p className="mb-4 text-sm text-slate-700">For committee members and admins.</p>
      <form onSubmit={submit} className="panel space-y-4">
        <div>
          <label htmlFor="email" className="field-label">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="username"
            className={field}
          />
        </div>
        <div>
          <label htmlFor="password" className="field-label">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className={field}
          />
        </div>
        {error && (
          <p
            role="alert"
            className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          >
            {error}
          </p>
        )}
        <button type="submit" disabled={busy} className="btn btn-primary">
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
