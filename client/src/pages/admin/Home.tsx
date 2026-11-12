import { Link } from "react-router-dom";

const AREAS = [
  {
    to: "/admin/users",
    name: "Users",
    text: "Create committee accounts, disable them, reset passwords.",
  },
  {
    to: "/admin/categories",
    name: "Categories",
    text: "Add, rename and remove the categories notices belong to.",
  },
  { to: "/admin/audit", name: "Audit log", text: "See who did what, newest first." },
  { to: "/committee", name: "My notices", text: "Every notice, with Pin and Unpin." },
];

export default function AdminHome() {
  return (
    <div>
      <h1 className="page-title">Admin area</h1>
      <ul className="grid gap-4 sm:grid-cols-2">
        {AREAS.map((a) => (
          <li key={a.to} className="panel relative transition-colors hover:bg-paper-2">
            <h2 className="mb-1 font-display text-xl font-bold">
              {/* The whole card is clickable; the link text stays the short name. */}
              <Link to={a.to} className="after:absolute after:inset-0">
                {a.name}
              </Link>
            </h2>
            <p className="text-muted">{a.text}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
