import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api, SeatUsage } from "../api";
import { useAuth } from "../auth";

function SeatWidget() {
  const { session } = useAuth();
  const [usage, setUsage] = useState<SeatUsage | null>(null);
  const isAdmin = session && ["super_admin", "wing_admin"].includes(session.role);
  useEffect(() => {
    if (!isAdmin || !session) return;
    api.seatUsage(session.wingId).then(setUsage).catch(() => setUsage(null));
  }, [isAdmin, session]);
  if (!usage) return null;
  return (
    <span className="text-sm text-slate-200" title="Live seat pool for your wing">
      Seats {usage.used}/{usage.limit}
    </span>
  );
}

const NAV = [
  { to: "/ask", label: "Ask Bot" },
  { to: "/documents", label: "Documents" },
  { to: "/history", label: "History" },
  { to: "/admin", label: "Admin", roles: ["super_admin", "wing_admin"] },
];

export default function Layout({ children }: { children: ReactNode }) {
  const { session, logout } = useAuth();
  const loc = useLocation();
  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-brand-dark text-white">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-6">
          <Link to="/ask" className="font-bold text-lg">BharathTax</Link>
          <nav className="flex gap-4 flex-1">
            {NAV.filter((n) => !n.roles || (session && n.roles.includes(session.role))).map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className={`text-sm hover:text-white ${
                  loc.pathname === n.to ? "text-white" : "text-slate-300"
                }`}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <SeatWidget />
          <span className="text-sm text-slate-300">{session?.username}</span>
          <button onClick={logout} className="text-sm bg-white/10 px-3 py-1 rounded hover:bg-white/20">
            Logout
          </button>
        </div>
      </header>
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6">{children}</main>
      <footer className="text-center text-xs text-slate-400 py-3">
        Grounded only in primary Indian tax law. Answers are citation-backed; verify before reliance.
      </footer>
    </div>
  );
}
