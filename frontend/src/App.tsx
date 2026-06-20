import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import { useAuth } from "./auth";
import Login from "./pages/Login";
import Ask from "./pages/Ask";
import Documents from "./pages/Documents";
import Admin from "./pages/Admin";
import History from "./pages/History";
import { ReactNode } from "react";

function Protected({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <div className="p-8 text-slate-500">Loading…</div>;
  if (!session) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  const { session } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={session ? <Navigate to="/ask" replace /> : <Login />} />
      <Route path="/ask" element={<Protected><Ask /></Protected>} />
      <Route path="/documents" element={<Protected><Documents /></Protected>} />
      <Route path="/history" element={<Protected><History /></Protected>} />
      <Route path="/admin" element={<Protected><Admin /></Protected>} />
      <Route path="*" element={<Navigate to="/ask" replace />} />
    </Routes>
  );
}
