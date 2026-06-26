import { useEffect, useState } from "react";
import { ShieldCheck, Database, BookOpen } from "lucide-react";
import { SeatUsage, api } from "../api";
import { useAuth } from "../auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Wing { id: number; name: string; code: string; seat_limit: number }

function Corpus({ isSuper }: { isSuper: boolean }) {
  const [stats, setStats] = useState<any>(null);
  const [msg, setMsg] = useState("");
  useEffect(() => { api.corpusStats().then(setStats).catch(() => {}); }, []);
  async function ingest() {
    setMsg("");
    try { await api.ingestCaseLaw(); setMsg("Case-law ingest started in the worker (drop PDFs + manifest.jsonl in data/manual/case_law/ first)."); }
    catch (e: any) { setMsg(e.message); }
  }
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-2"><Database className="size-4 text-primary" /> Corpus</h3>
          {isSuper && <Button size="sm" variant="outline" onClick={ingest}><BookOpen className="size-4" /> Ingest case law</Button>}
        </div>
        {stats ? (
          <div className="flex flex-wrap gap-2">
            {Object.entries(stats.by_domain).map(([d, n]: any) => (
              <Badge key={d} variant="secondary">{d.replace("_", " ")}: {n.toLocaleString()}</Badge>
            ))}
            <Badge variant="default">total: {stats.chunks.toLocaleString()} chunks</Badge>
          </div>
        ) : <p className="text-sm text-muted-foreground">Loading…</p>}
        {msg && <p className="text-sm text-success mt-2">{msg}</p>}
      </CardContent>
    </Card>
  );
}

export default function Admin() {
  const { session } = useAuth();
  const [wings, setWings] = useState<Wing[]>([]);
  const [usage, setUsage] = useState<Record<number, SeatUsage>>({});

  useEffect(() => {
    api.wings().then(async (ws) => {
      setWings(ws);
      const entries = await Promise.all(ws.map(async (w) => [w.id, await api.seatUsage(w.id)] as const));
      setUsage(Object.fromEntries(entries));
    }).catch(() => {});
  }, []);

  if (session && !["super_admin", "wing_admin"].includes(session.role)) {
    return <div className="text-muted-foreground">Admin access required.</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2"><ShieldCheck className="size-5 text-primary" /> Admin · Seat Pools</h2>
        <p className="text-sm text-muted-foreground">Concurrent active sessions per wing. A full pool blocks further logins until a seat frees up.</p>
      </div>
      <Corpus isSuper={session?.role === "super_admin"} />
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {wings.map((w) => {
          const u = usage[w.id];
          const pct = u && u.limit ? Math.round((u.used / u.limit) * 100) : 0;
          const full = pct >= 100;
          return (
            <Card key={w.id}>
              <CardContent className="pt-5">
                <div className="flex justify-between items-baseline">
                  <h3 className="font-semibold">{w.name}</h3>
                  <Badge variant="secondary">{w.code}</Badge>
                </div>
                {u && (
                  <>
                    <div className="text-sm text-muted-foreground mt-2 flex justify-between">
                      <span>{u.used}/{u.limit} in use</span>
                      <span className={cn(full ? "text-destructive" : "text-success")}>{u.available} free</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full mt-2 overflow-hidden">
                      <div className={cn("h-full rounded-full", full ? "bg-destructive" : "bg-primary")} style={{ width: `${Math.min(100, pct)}%` }} />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
        {wings.length === 0 && <p className="text-sm text-muted-foreground">No wings found.</p>}
      </div>
    </div>
  );
}
