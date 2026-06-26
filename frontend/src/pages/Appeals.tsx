import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Gavel, Plus, ArrowRight } from "lucide-react";
import { api } from "../api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

const STATUS_VARIANT: Record<string, "default" | "success" | "secondary" | "destructive"> = {
  new: "secondary", running: "default", ready: "success", error: "destructive",
};

export default function Appeals() {
  const [cases, setCases] = useState<any[]>([]);
  const [f, setF] = useState({ title: "", assessment_year: "", pan: "", section: "" });
  const [err, setErr] = useState("");
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const load = () => api.appealCases().then(setCases).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  async function create(e: FormEvent) {
    e.preventDefault(); if (!f.title) return;
    await api.appealCreateCase({ ...f, assessment_year: f.assessment_year || null, pan: f.pan || null, section: f.section || null });
    setF({ title: "", assessment_year: "", pan: "", section: "" }); load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2"><Gavel className="size-5 text-primary" /> Appeal cases</h2>
        <p className="text-sm text-muted-foreground">Draft CIT(A)/NFAC appellate orders — grounded in primary law and case law.</p>
      </div>

      <Card>
        <CardContent className="pt-5">
          <form onSubmit={create} className="grid sm:grid-cols-12 gap-3 items-end">
            <div className="sm:col-span-5"><Label>Title</Label><Input value={f.title} onChange={set("title")} placeholder="ABC Traders Pvt Ltd — AY 2021-22" /></div>
            <div className="sm:col-span-2"><Label>AY</Label><Input value={f.assessment_year} onChange={set("assessment_year")} placeholder="2021-22" /></div>
            <div className="sm:col-span-2"><Label>PAN</Label><Input value={f.pan} onChange={set("pan")} /></div>
            <div className="sm:col-span-2"><Label>Section</Label><Input value={f.section} onChange={set("section")} placeholder="143(3)" /></div>
            <div className="sm:col-span-1"><Button type="submit" className="w-full"><Plus className="size-4" /></Button></div>
          </form>
        </CardContent>
      </Card>

      {err && <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{err}</div>}

      <div className="grid gap-3">
        {cases.map((c) => (
          <Link key={c.id} to={`/appeals/${c.id}`}>
            <Card className="hover:border-primary/40 transition-colors">
              <CardContent className="py-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{c.title}</div>
                  <div className="text-xs text-muted-foreground">AY {c.assessment_year || "—"} · PAN {c.pan || "—"} · s.{c.section || "—"}</div>
                </div>
                <Badge variant={STATUS_VARIANT[c.status] || "secondary"}>{c.status}</Badge>
                <ArrowRight className="size-4 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
        ))}
        {cases.length === 0 && <p className="text-sm text-muted-foreground">No cases yet — create one above.</p>}
      </div>
    </div>
  );
}
