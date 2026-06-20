import { useEffect, useState } from "react";
import { SeatUsage, api } from "../api";
import { useAuth } from "../auth";

interface Wing { id: number; name: string; code: string; seat_limit: number }

export default function Admin() {
  const { session } = useAuth();
  const [wings, setWings] = useState<Wing[]>([]);
  const [usage, setUsage] = useState<Record<number, SeatUsage>>({});

  useEffect(() => {
    api.wings().then(async (ws) => {
      setWings(ws);
      const entries = await Promise.all(
        ws.map(async (w) => [w.id, await api.seatUsage(w.id)] as const)
      );
      setUsage(Object.fromEntries(entries));
    }).catch(() => {});
  }, []);

  if (session && !["super_admin", "wing_admin"].includes(session.role)) {
    return <div className="text-slate-500">Admin access required.</div>;
  }

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Admin · Seat Pools</h1>
      <div className="grid sm:grid-cols-2 gap-4">
        {wings.map((w) => {
          const u = usage[w.id];
          const pct = u && u.limit ? Math.round((u.used / u.limit) * 100) : 0;
          return (
            <div key={w.id} className="bg-white rounded-lg shadow p-4">
              <div className="flex justify-between items-baseline">
                <h2 className="font-medium">{w.name}</h2>
                <span className="text-xs text-slate-400">{w.code}</span>
              </div>
              {u && (
                <>
                  <div className="text-sm text-slate-600 mt-2">
                    {u.used} / {u.limit} seats in use · {u.available} free
                  </div>
                  <div className="h-2 bg-slate-100 rounded mt-2 overflow-hidden">
                    <div className={`h-full ${pct >= 100 ? "bg-red-500" : "bg-brand"}`}
                         style={{ width: `${Math.min(100, pct)}%` }} />
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-sm text-slate-500">
        Seats are concurrent active sessions. When a wing's pool is full, further logins are blocked
        until a seat frees up (logout or session expiry).
      </p>
    </div>
  );
}
