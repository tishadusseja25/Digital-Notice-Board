import { Link, Outlet, useNavigate } from "react-router-dom";
import { useLiveStore } from "../lib/socket";
import { useSessionStore } from "../store/sessionStore";

export default function Layout() {
  const { user, status, logout } = useSessionStore();
  const live = useLiveStore((s) => s.status);
  const navigate = useNavigate();
  const area = user?.role === "admin" ? "/admin" : "/committee";
  const onDark = "underline decoration-white/40 hover:decoration-white";

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2"
      >
        Skip to content
      </a>
      <header className="bg-ink text-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-4">
          <div className="flex items-center gap-3">
            {/* On phones only the icon shows, so the header stays on one line; the name stays
                available to screen readers and from sm upwards it is shown in full. */}
            <Link
              to="/"
              aria-label="Digital Notice Board"
              className="flex items-center gap-3 font-display text-2xl font-bold tracking-tight"
            >
              <svg viewBox="0 0 64 64" aria-hidden="true" className="h-9 w-9 shrink-0">
                <rect width="64" height="64" rx="14" fill="#F4F6F5" />
                <rect x="14" y="16" width="36" height="32" rx="4" fill="#13233B" />
                <rect x="19" y="23" width="26" height="4" rx="2" fill="#F4F6F5" />
                <rect x="19" y="31" width="20" height="3" rx="1.5" fill="#7F8B86" />
                <rect x="19" y="37" width="23" height="3" rx="1.5" fill="#7F8B86" />
                <circle cx="45" cy="17" r="6" fill="#F5B800" />
              </svg>
              <span aria-hidden="true" className="hidden sm:inline">
                Digital Notice Board
              </span>
            </Link>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-semibold ${live === "connecting" ? "opacity-0" : ""}`}
            >
              <span
                aria-hidden="true"
                className={`h-2 w-2 rounded-full ${live === "live" ? "animate-pulse bg-marigold" : live === "offline" ? "bg-white/50" : "bg-transparent"}`}
              />
              <span aria-live="polite">
                {live === "live" ? "Live" : live === "offline" ? "Reconnecting…" : ""}
              </span>
            </span>
          </div>
          <nav aria-label="Account" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <Link to="/" className={onDark}>
              Notice board
            </Link>
            {status === "ready" && user && (
              <>
                <Link to={area} className={onDark}>
                  {user.name}
                </Link>
                <Link to="/account/password" className={onDark}>
                  Password
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    // Leave the staff page first, so signing out lands on the board, not the login form.
                    navigate("/", { state: { signedOut: true } });
                    void logout();
                  }}
                  className="btn border border-white/50 px-3 py-1 text-white hover:bg-white/10"
                >
                  Sign out
                </button>
              </>
            )}
            {status === "ready" && !user && (
              <Link to="/login" className="btn bg-white text-ink hover:bg-paper-2">
                Sign in
              </Link>
            )}
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <Outlet />
      </main>
      <footer className="border-t border-line">
        <p className="mx-auto max-w-5xl px-4 py-5 text-sm text-muted">
          Notices are posted by the college committee. You do not need an account to read them.
        </p>
      </footer>
    </div>
  );
}
