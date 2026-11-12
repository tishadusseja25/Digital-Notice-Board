import { Link } from "react-router-dom";
import { useTitle } from "../lib/useTitle";

export default function NotFound() {
  useTitle("Page not found");
  return (
    <div className="panel max-w-xl">
      <h1 className="mb-2 font-display text-3xl font-bold">Page not found</h1>
      <p className="mb-4 text-muted">The address may be mistyped, or the page may have moved.</p>
      <Link to="/" className="btn btn-primary">
        Back to the notice board
      </Link>
    </div>
  );
}
