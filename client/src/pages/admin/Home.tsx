import { Link } from "react-router-dom";

export default function AdminHome() {
  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Admin area</h1>
      <ul className="list-disc space-y-2 pl-5">
        <li>
          <Link to="/admin/users" className="underline">
            Users
          </Link>{" "}
          : create committee accounts, disable them, reset passwords.
        </li>
        <li>
          <Link to="/admin/categories" className="underline">
            Categories
          </Link>{" "}
          : add, rename and remove the categories notices belong to.
        </li>
        <li>
          <Link to="/committee" className="underline">
            My notices
          </Link>{" "}
          : all notices, with Pin and Unpin.
        </li>
      </ul>
    </div>
  );
}
