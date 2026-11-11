import { Suspense, lazy, useEffect } from "react";
import { Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import RouteGuard, { GuardedOutlet } from "./components/RouteGuard";
import Board from "./pages/Board";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";
import NoticeDetail from "./pages/NoticeDetail";
import { useSessionStore } from "./store/sessionStore";

// Staff pages are loaded on demand so the public board's download stays small.
const CommitteeHome = lazy(() => import("./pages/committee/Home"));
const NoticeEditor = lazy(() => import("./pages/committee/NoticeEditor"));
const AdminHome = lazy(() => import("./pages/admin/Home"));

export default function App() {
  const init = useSessionStore((s) => s.init);
  useEffect(() => {
    void init();
  }, [init]);

  const loading = <p>Loading…</p>;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Board />} />
        <Route path="/notices/:id" element={<NoticeDetail />} />
        <Route path="/login" element={<Login />} />
        <Route path="/committee" element={<GuardedOutlet roles={["committee", "admin"]} />}>
          <Route index element={<CommitteeHome />} />
          <Route path="new" element={<NoticeEditor />} />
          <Route path=":id/edit" element={<NoticeEditor />} />
        </Route>
        <Route
          path="/admin/*"
          element={
            <RouteGuard roles={["admin"]}>
              <Suspense fallback={loading}>
                <AdminHome />
              </Suspense>
            </RouteGuard>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
