import { NavLink, Outlet } from "react-router-dom";

const link = ({ isActive }: { isActive: boolean }) =>
  `rounded px-3 py-1 text-sm ${isActive ? "bg-slate-900 text-white" : "border border-slate-300 bg-white hover:bg-slate-100"}`;

/** Shared tab bar for every admin page; the page itself renders in the Outlet. */
export default function AdminNav() {
  return (
    <div>
      <nav aria-label="Admin" className="mb-6 flex flex-wrap gap-2">
        <NavLink to="/admin" end className={link}>
          Overview
        </NavLink>
        <NavLink to="/admin/users" className={link}>
          Users
        </NavLink>
        <NavLink to="/admin/categories" className={link}>
          Categories
        </NavLink>
      </nav>
      <Outlet />
    </div>
  );
}
