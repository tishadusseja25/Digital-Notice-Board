import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold">Page not found</h1>
      <Link to="/" className="underline">
        Back to the notice board
      </Link>
    </div>
  );
}
