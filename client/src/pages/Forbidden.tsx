import { Link } from "react-router-dom";

export default function Forbidden() {
  return (
    <div className="panel max-w-xl">
      <h1 className="mb-2 font-display text-3xl font-bold">403: No access</h1>
      <p className="mb-4 text-muted">Your account is not allowed to open this page.</p>
      <Link to="/" className="btn btn-primary">
        Back to the notice board
      </Link>
    </div>
  );
}
