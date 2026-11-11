import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import Forbidden from "../pages/Forbidden";
import { useSessionStore, type Role } from "../store/sessionStore";

/**
 * Decides what to SHOW. It is a convenience: the page code is public, so the real protection is
 * the server, which re-checks the token and role on every API call.
 */
export default function RouteGuard({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user, status } = useSessionStore();
  const location = useLocation();

  if (status === "loading") return <p>Loading…</p>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!roles.includes(user.role)) return <Forbidden />;
  return <>{children}</>;
}
