import { Link } from "react-router-dom";

export default function Forbidden() {
  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold">403: No access</h1>
      <p className="mb-4">Your account is not allowed to open this page.</p>
      <Link to="/" className="underline">
        Back to the notice board
      </Link>
    </div>
  );
}
