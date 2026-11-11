import { useEffect } from "react";
import { Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import Board from "./pages/Board";
import { useSessionStore } from "./store/sessionStore";

export default function App() {
  const init = useSessionStore((s) => s.init);
  useEffect(() => {
    void init();
  }, [init]);

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Board />} />
      </Route>
    </Routes>
  );
}
