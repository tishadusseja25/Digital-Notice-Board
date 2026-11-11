import { Link, Outlet } from "react-router-dom";
import { useSessionStore } from "../store/sessionStore";

export default function Layout() {
  const { user, status, logout } = useSessionStore();
  const area = user?.role === "admin" ? "/admin" : "/committee";

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:rounded focus:bg-white focus:p-2"
      >
        Skip to content
      </a>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/" className="text-lg font-bold">
            Digital Notice Board
          </Link>
          <nav aria-label="Account" className="flex items-center gap-3 text-sm">
            {status === "ready" && user && (
              <>
                <Link to={area} className="underline">
                  {user.name}
                </Link>
                <Link to="/account/password" className="underline">
                  Password
                </Link>
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-100"
                >
                  Sign out
                </button>
              </>
            )}
            {status === "ready" && !user && (
              <Link to="/login" className="underline">
                Sign in
              </Link>
            )}
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-4xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
