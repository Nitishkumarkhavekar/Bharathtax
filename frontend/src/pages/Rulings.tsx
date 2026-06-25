import { FormEvent, useState } from "react";
import { BookOpen, Loader2, ArrowUpRight, AlertTriangle } from "lucide-react";
import { api } from "../api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export default function Rulings() {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function search(e: FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true); setErr(""); setRes(null);
    try { setRes(await api.rulings(q)); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2"><BookOpen className="size-5 text-primary" /> Rulings</h2>
        <p className="text-sm text-muted-foreground">Search the ingested income-tax case law (ITAT / HC / SC).</p>
      </div>

      <Card>
        <CardContent className="pt-5">
          <form onSubmit={search} className="flex gap-3">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. unexplained share application money section 68 creditworthiness" />
            <Button type="submit" disabled={busy}>{busy ? <><Loader2 className="size-4 animate-spin" /> Searching…</> : "Search"}</Button>
          </form>
        </CardContent>
      </Card>

      {err && <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{err}</div>}

      {res && !res.results.length && (
        <Card className="border-amber-300 bg-amber-50"><CardContent className="pt-6 flex gap-3 text-amber-800">
          <AlertTriangle className="size-5 shrink-0" /><p className="text-sm">No matching rulings. The case-law corpus may be empty or unrelated — an admin can ingest judgments under the case_law domain.</p>
        </CardContent></Card>
      )}

      <div className="space-y-3">
        {res?.results?.map((r: any, i: number) => (
          <Card key={i} className="hover:border-primary/40 transition-colors">
            <CardContent className="py-4">
              <div className="flex items-start gap-3">
                <Badge variant="secondary" className="font-mono shrink-0">{r.score}</Badge>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm">{r.breadcrumb}</div>
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-3">{r.snippet}</p>
                  {r.source_url && (
                    <a href={r.source_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-0.5 text-xs text-primary hover:underline">
                      open source <ArrowUpRight className="size-3" />
                    </a>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
