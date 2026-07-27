import { Navigate, Route, Routes } from "react-router-dom";
import { ReactNode } from "react";
import Layout from "./components/Layout";
import { landingPath, useAuth } from "./auth";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Landing from "./pages/Landing";
import ReleasesLanding from "./pages/Releases";
import Ask from "./pages/Ask";
import ProfilePage from "./pages/Profile";
import Documents from "./pages/Documents";
import History from "./pages/History";
import Appeals from "./pages/Appeals";
import AppealCase from "./pages/AppealCase";
import Rulings from "./pages/Rulings";
import Drafting from "./pages/Drafting";

// Admin console
import AdminLayout from "./pages/admin/AdminLayout";
import AdminDashboardPage from "./pages/admin/Dashboard";
import UserManagement from "./pages/admin/UserManagement";
import ModelManagementPage from "./pages/admin/ModelManagement";
import ServerStatsPage from "./pages/admin/ServerStats";
import RevenueManagementPage from "./pages/admin/RevenueManagement";
import LicenseManagementPage from "./pages/admin/LicenseManagement";
import TokenUsagePage from "./pages/admin/TokenUsage";
import AdminPricingPage from "./pages/admin/Pricing";
import AdminBillingPage from "./pages/admin/Billing";
import AdminReleasesPage from "./pages/admin/Releases";
import AdminSupportTicketsPage from "./pages/admin/SupportTickets";
import AdminDesktopLogsPage from "./pages/admin/DesktopLogs";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import GeminiPage from "./pages/admin/Gemini";

function Protected({ children, raw }: { children: ReactNode; raw?: boolean }) {
  const { session, loading } = useAuth();
  if (loading) return <div className="p-8 text-slate-500">Loading…</div>;
  if (!session) return <Navigate to="/login" replace />;
  return raw ? <>{children}</> : <Layout>{children}</Layout>;
}

// Chat / non-admin pages are off-limits to admin accounts — they're routed
// straight to the admin console instead.
function NonAdminOnly({ children, raw }: { children: ReactNode; raw?: boolean }) {
  const { session, loading } = useAuth();
  if (loading) return <div className="p-8 text-slate-500">Loading…</div>;
  if (!session) return <Navigate to="/login" replace />;
  if (["super_admin", "wing_admin"].includes(session.role)) {
    return <Navigate to="/admin/dashboard" replace />;
  }
  return raw ? <>{children}</> : <Layout>{children}</Layout>;
}

function AdminGuard({ children, superOnly }: { children: ReactNode; superOnly?: boolean }) {
  const { session } = useAuth();
  if (!session) return <Navigate to="/login" replace />;
  if (!["super_admin", "wing_admin"].includes(session.role)) {
    return <Navigate to="/ask" replace />;
  }
  if (superOnly && session.role !== "super_admin") {
    return <Navigate to="/admin/dashboard" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  const { session } = useAuth();
  const landing = landingPath(session?.role);
  return (
    <Routes>
      {/* Public landing page — the front door for logged-out visitors;
          signed-in users skip straight to their role's home. */}
      <Route path="/" element={session ? <Navigate to={landing} replace /> : <Landing />} />
      <Route path="/releases" element={<ReleasesLanding />} />
      <Route path="/login" element={session ? <Navigate to={landing} replace /> : <Login />} />
      <Route path="/register" element={session ? <Navigate to={landing} replace /> : <Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      {/* Chat + user-facing tools are not for admin accounts — admins are
          bounced to the admin console. */}
      <Route path="/ask" element={<NonAdminOnly raw><Ask /></NonAdminOnly>} />
      <Route path="/appeals" element={<NonAdminOnly><Appeals /></NonAdminOnly>} />
      <Route path="/appeals/:id" element={<NonAdminOnly><AppealCase /></NonAdminOnly>} />
      <Route path="/drafts" element={<NonAdminOnly><Drafting /></NonAdminOnly>} />
      <Route path="/rulings" element={<NonAdminOnly><Rulings /></NonAdminOnly>} />
      <Route path="/documents" element={<NonAdminOnly><Documents /></NonAdminOnly>} />
      <Route path="/history" element={<NonAdminOnly><History /></NonAdminOnly>} />
      <Route path="/profile" element={<NonAdminOnly><ProfilePage /></NonAdminOnly>} />
      {/* Token Usage + Billing merged into Profile's "Plan & Usage" tab. Keep the
          old paths working by redirecting to it. */}
      <Route path="/tokens" element={<Navigate to="/profile?tab=plan" replace />} />
      <Route path="/billing" element={<Navigate to="/profile?tab=plan" replace />} />

      {/* Admin console — full-screen with its own sidebar (no outer Layout). */}
      <Route
        path="/admin"
        element={
          <Protected raw>
            <AdminGuard>
              <AdminLayout />
            </AdminGuard>
          </Protected>
        }
      >
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<AdminDashboardPage />} />
        <Route path="users" element={<UserManagement mode="users" />} />
        <Route path="admins" element={<UserManagement mode="admins" />} />
        <Route path="model" element={<ModelManagementPage />} />
        <Route path="server" element={<ServerStatsPage />} />
        <Route path="tokens" element={<TokenUsagePage />} />
        <Route path="gemini" element={<GeminiPage />} />
        <Route path="pricing" element={<AdminPricingPage />} />
        <Route path="billing" element={<AdminBillingPage />} />
        <Route path="releases" element={<AdminReleasesPage />} />
        <Route path="support" element={<AdminSupportTicketsPage />} />
        <Route path="desktop-logs" element={<AdminDesktopLogsPage />} />
        <Route
          path="revenue"
          element={
            <AdminGuard superOnly>
              <RevenueManagementPage />
            </AdminGuard>
          }
        />
        <Route
          path="licenses"
          element={
            <AdminGuard superOnly>
              <LicenseManagementPage />
            </AdminGuard>
          }
        />
      </Route>

      {/* Unknown URL: signed-in users hit their home; everyone else lands on /. */}
      <Route
        path="*"
        element={<Navigate to={session ? landing : "/"} replace />}
      />
    </Routes>
  );
}
