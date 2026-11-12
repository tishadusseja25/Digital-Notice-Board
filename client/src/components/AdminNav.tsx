import { NavLink, Outlet } from "react-router-dom";

const link = ({ isActive }: { isActive: boolean }) =>
  `-mb-px border-b-4 py-2 text-sm font-semibold ${isActive ? "border-signal text-ink" : "border-transparent text-muted hover:border-line hover:text-ink"}`;

/** Shared tab bar for every admin page; the page itself renders in the Outlet. */
export default function AdminNav() {
  return (
    <div>
      <nav aria-label="Admin" className="mb-8 flex flex-wrap gap-x-6 border-b border-line">
        <NavLink to="/admin" end className={link}>
          Overview
        </NavLink>
        <NavLink to="/admin/users" className={link}>
          Users
        </NavLink>
        <NavLink to="/admin/categories" className={link}>
          Categories
        </NavLink>
        <NavLink to="/admin/audit" className={link}>
          Audit log
        </NavLink>
      </nav>
      <Outlet />
    </div>
  );
}
