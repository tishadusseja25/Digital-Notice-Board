import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../../lib/api";
import { useSessionStore } from "../../store/sessionStore";

const MIN_LENGTH = 10; // same minimum as the server
const input = "w-full rounded border border-slate-300 bg-white px-3 py-2";

export default function ChangePassword() {
  const { user, changePassword } = useSessionStore();
  const navigate = useNavigate();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const current = String(form.get("current"));
    const next = String(form.get("next"));
    const found: Record<string, string> = {};
    if (next.length < MIN_LENGTH) found.next = `Use at least ${MIN_LENGTH} characters.`;
    if (next !== String(form.get("confirm"))) found.confirm = "The two new passwords do not match.";
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    try {
      await changePassword(current, next);
      navigate(user?.role === "admin" ? "/admin" : "/committee", { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 400 && err.fields) setErrors(err.fields);
      else setFormError("Could not change the password. Please try again.");
      setBusy(false);
    }
  };

  const fieldError = (name: string) =>
    errors[name] && (
      <p id={`${name}-error`} className="mt-1 text-sm text-red-700">
        {errors[name]}
      </p>
    );
  const field = (name: string, text: string, autoComplete: string) => (
    <div>
      <label htmlFor={name} className="block text-sm font-medium">
        {text}
      </label>
      <input
        id={name}
        name={name}
        type="password"
        required
        autoComplete={autoComplete}
        aria-invalid={!!errors[name]}
        aria-describedby={errors[name] ? `${name}-error` : undefined}
        className={input}
      />
      {fieldError(name)}
    </div>
  );

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-4 text-2xl font-bold">Change password</h1>
      {user?.mustChangePassword && (
        <p className="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          You are using a temporary password. Choose a new one to continue.
        </p>
      )}
      <form onSubmit={submit} className="space-y-4">
        {field("current", "Current password", "current-password")}
        {field("next", "New password", "new-password")}
        {field("confirm", "Repeat new password", "new-password")}
        {formError && (
          <p
            role="alert"
            className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          >
            {formError}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-slate-900 px-4 py-2 text-white hover:bg-slate-700 disabled:opacity-60"
        >
          {busy ? "Saving…" : "Change password"}
        </button>
      </form>
    </div>
  );
}
