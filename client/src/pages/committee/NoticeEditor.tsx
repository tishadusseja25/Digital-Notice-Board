import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import NoticeForm from "../../components/NoticeForm";
import { ApiError, api } from "../../lib/api";
import { useTitle } from "../../lib/useTitle";
import type { Notice } from "../../store/noticesStore";

type View =
  | { state: "new" }
  | { state: "loading" }
  | { state: "gone" }
  | { state: "error" }
  | { state: "ok"; notice: Notice };

export default function NoticeEditor() {
  const { id } = useParams();
  useTitle(id ? "Edit notice" : "New notice");
  const navigate = useNavigate();
  const [view, setView] = useState<View>(id ? { state: "loading" } : { state: "new" });

  useEffect(() => {
    if (!id) return;
    let current = true;
    setView({ state: "loading" });
    api<{ notice: Notice }>(`/notices/${id}`)
      .then(({ notice }) => current && setView({ state: "ok", notice }))
      .catch((err) => {
        if (current)
          setView({ state: err instanceof ApiError && err.status === 404 ? "gone" : "error" });
      });
    return () => {
      current = false;
    };
  }, [id]);

  const back = (
    <Link to="/committee" className="underline">
      Back to my notices
    </Link>
  );
  const saved = () => navigate("/committee", { state: { saved: true } });

  if (view.state === "loading") return <p>Loading…</p>;
  if (view.state === "gone") {
    return (
      <div>
        <h1 className="mb-2 font-display text-2xl font-bold">Notice not found</h1>
        {back}
      </div>
    );
  }
  if (view.state === "error") {
    return (
      <div>
        <p role="alert" className="mb-2">
          Could not load this notice.
        </p>
        {back}
      </div>
    );
  }
  // The public shape has no `status`: this notice is someone else's, so it cannot be edited here.
  if (view.state === "ok" && !view.notice.status) {
    return (
      <div>
        <h1 className="mb-2 font-display text-2xl font-bold">You can only edit your own notices</h1>
        {back}
      </div>
    );
  }

  return (
    <div>
      <p className="mb-4">{back}</p>
      <h1 className="page-title">{id ? "Edit notice" : "New notice"}</h1>
      <NoticeForm
        key={id ?? "new"}
        initial={view.state === "ok" ? view.notice : undefined}
        onSaved={saved}
      />
    </div>
  );
}
