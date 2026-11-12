import { lazy, useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import AdminNav from "./components/AdminNav";
import Layout from "./components/Layout";
import { GuardedOutlet } from "./components/RouteGuard";
import Board from "./pages/Board";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";
import NoticeDetail from "./pages/NoticeDetail";
import { restartSocket, stopSocket } from "./lib/socket";
import { useSessionStore } from "./store/sessionStore";

// Staff pages are loaded on demand so the public board's download stays small.
const CommitteeHome = lazy(() => import("./pages/committee/Home"));
const NoticeEditor = lazy(() => import("./pages/committee/NoticeEditor"));
const ChangePassword = lazy(() => import("./pages/account/ChangePassword"));
const AdminHome = lazy(() => import("./pages/admin/Home"));
const AdminUsers = lazy(() => import("./pages/admin/Users"));
const AdminCategories = lazy(() => import("./pages/admin/Categories"));
const AdminAudit = lazy(() => import("./pages/admin/Audit"));

/** A new page should start at the top, as it would after following a link on any website. */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export default function App() {
  const init = useSessionStore((s) => s.init);
  const status = useSessionStore((s) => s.status);
  const userId = useSessionStore((s) => s.user?.id);
  useEffect(() => {
    void init();
  }, [init]);
  // Connect once the session is known, and reconnect on sign-in or sign-out so the server
  // puts the socket in the right rooms.
  useEffect(() => {
    if (status === "ready") restartSocket();
    return stopSocket;
  }, [status, userId]);

  return (
    <>
      <ScrollToTop />
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
          <Route path="/account" element={<GuardedOutlet roles={["committee", "admin"]} />}>
            <Route path="password" element={<ChangePassword />} />
          </Route>
          <Route path="/admin" element={<GuardedOutlet roles={["admin"]} />}>
            <Route element={<AdminNav />}>
              <Route index element={<AdminHome />} />
              <Route path="users" element={<AdminUsers />} />
              <Route path="categories" element={<AdminCategories />} />
              <Route path="audit" element={<AdminAudit />} />
            </Route>
          </Route>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </>
  );
}
