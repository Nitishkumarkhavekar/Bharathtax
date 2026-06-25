import { FormEvent, useState } from "react";
import { Sparkles, BookOpen, AlertTriangle, Loader2, ArrowUpRight } from "lucide-react";
import { AnswerResponse, ApiError, api } from "../api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ImprovePrompt } from "@/components/ImprovePrompt";

const MODULES = [
  { value: "", label: "All modules" },
  { value: "income_tax", label: "Income Tax" },
  { value: "gst", label: "GST (coming soon)" },
  { value: "customs", label: "Customs (coming soon)" },
];
const STYLES = ["explanatory", "concise"];
const selectCls =
  "h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function AnswerView({ q, a }: { q: string; a: AnswerResponse }) {
  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground">You asked</div>
      <div className="text-lg font-medium">{q}</div>

      {!a.grounded ? (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="pt-6 flex gap-3 text-amber-800">
            <AlertTriangle className="size-5 shrink-0" />
            <p className="text-sm">{a.answer}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="pt-6">
              <p className="whitespace-pre-wrap leading-relaxed text-[15px]">{a.answer}</p>
            </CardContent>
          </Card>

          {a.citations.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-foreground">
                <BookOpen className="size-4 text-primary" /> Sources ({a.citations.length})
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                {a.citations.map((c) => (
                  <Card key={c.n} className="hover:border-primary/40 transition-colors">
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-start gap-2">
                        <Badge variant="default" className="font-mono">[{c.n}]</Badge>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium leading-snug">{c.breadcrumb}</div>
                          <div className="mt-1 flex items-center gap-2">
                            {c.section_number && <Badge variant="secondary">§ {c.section_number}</Badge>}
                            {c.source_url && (
                              <a href={c.source_url} target="_blank" rel="noreferrer"
                                className="text-xs text-primary hover:underline inline-flex items-center gap-0.5">
                                source <ArrowUpRight className="size-3" />
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            {a.latency_ms != null && <>answered in {a.latency_ms} ms · </>}
            top score {String(a.meta["top_score"] ?? "—")}
          </div>
        </>
      )}
    </div>
  );
}

export default function Ask() {
  const [q, setQ] = useState("");
  const [asked, setAsked] = useState("");
  const [module, setModule] = useState("");
  const [style, setStyle] = useState("explanatory");
  const [answer, setAnswer] = useState<AnswerResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true); setError(null); setAnswer(null); setAsked(q);
    try { setAnswer(await api.ask(q, module || undefined, style)); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Request failed"); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2"><Sparkles className="size-5 text-primary" /> Ask Bot</h2>
        <p className="text-sm text-muted-foreground">Ask a tax-law question — answers are grounded in primary law and cited, or it refuses.</p>
      </div>

      <Card>
        <CardContent className="pt-5">
          <form onSubmit={submit} className="space-y-3">
            <Textarea className="min-h-[96px] text-[15px]" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="e.g. When is an addition under section 68 sustainable for unexplained share application money?" />
            <div className="flex flex-wrap items-center gap-3">
              <ImprovePrompt value={q} onChange={setQ} context="ask" disabled={busy} />
              <select className={selectCls} value={module} onChange={(e) => setModule(e.target.value)}>
                {MODULES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
              <select className={selectCls} value={style} onChange={(e) => setStyle(e.target.value)}>
                {STYLES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
              </select>
              <Button type="submit" className="ml-auto" disabled={busy}>
                {busy ? <><Loader2 className="size-4 animate-spin" /> Researching…</> : <>Ask</>}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {error && <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</div>}
      {busy && <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Retrieving primary sources and composing a cited answer…</div>}
      {answer && <AnswerView q={asked} a={answer} />}
    </div>
  );
}
