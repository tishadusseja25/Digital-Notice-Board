import { lazy, useEffect } from "react";
import { Route, Routes } from "react-router-dom";
import AdminNav from "./components/AdminNav";
import Layout from "./components/Layout";
import { GuardedOutlet } from "./components/RouteGuard";
import Board from "./pages/Board";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";
import NoticeDetail from "./pages/NoticeDetail";
import { useSessionStore } from "./store/sessionStore";

// Staff pages are loaded on demand so the public board's download stays small.
const CommitteeHome = lazy(() => import("./pages/committee/Home"));
const NoticeEditor = lazy(() => import("./pages/committee/NoticeEditor"));
const ChangePassword = lazy(() => import("./pages/account/ChangePassword"));
const AdminHome = lazy(() => import("./pages/admin/Home"));
const AdminUsers = lazy(() => import("./pages/admin/Users"));
const AdminCategories = lazy(() => import("./pages/admin/Categories"));

export default function App() {
  const init = useSessionStore((s) => s.init);
  useEffect(() => {
    void init();
  }, [init]);

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
        <Route path="/account" element={<GuardedOutlet roles={["committee", "admin"]} />}>
          <Route path="password" element={<ChangePassword />} />
        </Route>
        <Route path="/admin" element={<GuardedOutlet roles={["admin"]} />}>
          <Route element={<AdminNav />}>
            <Route index element={<AdminHome />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="categories" element={<AdminCategories />} />
          </Route>
        </Route>
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
