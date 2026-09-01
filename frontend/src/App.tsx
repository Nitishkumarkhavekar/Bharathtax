import { Navigate, Route, Routes } from "react-router-dom";
import { ReactNode, Suspense, lazy } from "react";
import { Loader2 } from "lucide-react";
import Layout from "./components/Layout";
import { landingPath, useAuth } from "./auth";

// Every route is code-split so a logged-out visitor no longer downloads the
// whole app (incl. the ~5k-line admin console). Vite emits one chunk per lazy
// import; the admin subtree only loads for admins, heavy pages only on visit.
const Login = lazy(() => import("./pages/Login"));
const Register = lazy(() => import("./pages/Register"));
const Landing = lazy(() => import("./pages/Landing"));
const ReleasesLanding = lazy(() => import("./pages/Releases"));
const Ask = lazy(() => import("./pages/Ask"));
const ProfilePage = lazy(() => import("./pages/Profile"));
const History = lazy(() => import("./pages/History"));
const AppealCase = lazy(() => import("./pages/AppealCase"));
const AssessmentCase = lazy(() => import("./pages/AssessmentCase"));
const Rulings = lazy(() => import("./pages/Rulings"));
const News = lazy(() => import("./pages/News"));
const DraftingHub = lazy(() => import("./pages/DraftingHub"));
const Workspace = lazy(() => import("./pages/Workspace"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Calculators = lazy(() => import("./pages/Calculators"));
const Templates = lazy(() => import("./pages/Templates"));
const Watchlists = lazy(() => import("./pages/Watchlists"));
const Library = lazy(() => import("./pages/Library"));
const Reconcile = lazy(() => import("./pages/Reconcile"));
const SharedChat = lazy(() => import("./pages/SharedChat"));
const Contact = lazy(() => import("./pages/Contact"));
const Terms = lazy(() => import("./pages/Terms"));
const Privacy = lazy(() => import("./pages/Privacy"));
const Docs = lazy(() => import("./pages/Docs"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));

// Admin console (loads only for admin accounts)
const AdminLayout = lazy(() => import("./pages/admin/AdminLayout"));
const AdminDashboardPage = lazy(() => import("./pages/admin/Dashboard"));
const UserManagement = lazy(() => import("./pages/admin/UserManagement"));
const ModelManagementPage = lazy(() => import("./pages/admin/ModelManagement"));
const ServerStatsPage = lazy(() => import("./pages/admin/ServerStats"));
const RevenueManagementPage = lazy(() => import("./pages/admin/RevenueManagement"));
const LicenseManagementPage = lazy(() => import("./pages/admin/LicenseManagement"));
const TokenUsagePage = lazy(() => import("./pages/admin/TokenUsage"));
const AdminPricingPage = lazy(() => import("./pages/admin/Pricing"));
const AdminBillingPage = lazy(() => import("./pages/admin/Billing"));
const AdminReleasesPage = lazy(() => import("./pages/admin/Releases"));
const AdminSupportTicketsPage = lazy(() => import("./pages/admin/SupportTickets"));
const AdminContactMessagesPage = lazy(() => import("./pages/admin/ContactMessages"));
const AdminDesktopLogsPage = lazy(() => import("./pages/admin/DesktopLogs"));
const GeminiPage = lazy(() => import("./pages/admin/Gemini"));

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[60vh] text-slate-400">
      <Loader2 className="size-6 animate-spin" />
    </div>
  );
}

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
    <Suspense fallback={<PageLoader />}>
    <Routes>
      {/* Public landing page — the front door for logged-out visitors;
          signed-in users skip straight to their role's home. */}
      <Route path="/" element={session ? <Navigate to={landing} replace /> : <Landing />} />
      <Route path="/releases" element={<ReleasesLanding />} />
      {/* Public marketing / info pages — accessible signed-in or out. */}
      <Route path="/contact" element={<Contact />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/docs" element={<Docs />} />
      <Route path="/login" element={session ? <Navigate to={landing} replace /> : <Login />} />
      <Route path="/register" element={session ? <Navigate to={landing} replace /> : <Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      {/* Chat + user-facing tools are not for admin accounts — admins are
          bounced to the admin console. */}
      <Route path="/ask" element={<NonAdminOnly raw><Ask /></NonAdminOnly>} />
      {/* Unified Drafting hub — assessment orders, appellate orders & notices
          under one item, switched by tabs. The old list routes redirect in so
          existing links/bookmarks keep working; the case-detail pages stay. */}
      <Route path="/drafting" element={<NonAdminOnly><DraftingHub /></NonAdminOnly>} />
      <Route path="/drafting/:tab" element={<NonAdminOnly><DraftingHub /></NonAdminOnly>} />
      <Route path="/appeals" element={<Navigate to="/drafting/appeals" replace />} />
      <Route path="/assessments" element={<Navigate to="/drafting/assessments" replace />} />
      <Route path="/drafts" element={<Navigate to="/drafting/notices" replace />} />
      <Route path="/appeals/:id" element={<NonAdminOnly><AppealCase /></NonAdminOnly>} />
      <Route path="/assessments/:id" element={<NonAdminOnly><AssessmentCase /></NonAdminOnly>} />
      <Route path="/dashboard" element={<NonAdminOnly><Dashboard /></NonAdminOnly>} />
      <Route path="/workspace" element={<NonAdminOnly><Workspace /></NonAdminOnly>} />
      <Route path="/calculators" element={<NonAdminOnly><Calculators /></NonAdminOnly>} />
      <Route path="/templates" element={<NonAdminOnly><Templates /></NonAdminOnly>} />
      <Route path="/watchlists" element={<NonAdminOnly><Watchlists /></NonAdminOnly>} />
      <Route path="/library" element={<NonAdminOnly><Library /></NonAdminOnly>} />
      <Route path="/reconcile" element={<NonAdminOnly><Reconcile /></NonAdminOnly>} />
      {/* Read-only shared chat — any signed-in user with the link can view. */}
      <Route path="/shared/:shareId" element={<Protected raw><SharedChat /></Protected>} />
      <Route path="/rulings" element={<NonAdminOnly><Rulings /></NonAdminOnly>} />
      <Route path="/news" element={<NonAdminOnly><News /></NonAdminOnly>} />
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
        <Route path="contact" element={<AdminContactMessagesPage />} />
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
    </Suspense>
  );
}
