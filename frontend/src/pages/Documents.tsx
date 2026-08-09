import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { Upload, FileText, AlertTriangle, Loader2 } from "lucide-react";
import { AnswerResponse, ApiError, DocumentOut, api } from "../api";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ImprovePrompt } from "@/components/ImprovePrompt";
import { cn } from "@/lib/utils";

export default function Documents() {
  const [docs, setDocs] = useState<DocumentOut[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<AnswerResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => api.documents().then(setDocs).catch(() => {});
  useEffect(() => { refresh(); }, []);

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setError(null);
    try { await api.uploadDocument(file); await refresh(); toast.success("Document uploaded"); }
    catch (err) {
      const m = err instanceof ApiError ? err.message : "Upload failed";
      setError(m); toast.error(m);
    }
    finally { setBusy(false); e.target.value = ""; }
  }

  async function ask(e: FormEvent) {
    e.preventDefault();
    if (!selected || !q.trim()) return;
    setBusy(true); setError(null); setAnswer(null);
    try { setAnswer(await api.askDocument(selected, q)); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Request failed"); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif text-xl font-semibold">Documents</h2>
        <p className="text-sm text-muted-foreground">Upload a file and ask questions answered only from that document.</p>
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-3">
          <label className={cn("inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-4 h-9 text-sm font-medium cursor-pointer hover:bg-primary/90", busy && "opacity-50 pointer-events-none")}>
            <Upload className="size-4" /> Upload a file
            <input type="file" className="hidden" onChange={upload} disabled={busy} />
          </label>
          <Card>
            <CardContent className="p-0 divide-y">
              {docs.map((d) => (
                <button key={d.id} onClick={() => { setSelected(d.id); setAnswer(null); }}
                  className={cn("w-full text-left p-3 flex items-center gap-3 hover:bg-accent/50 transition-colors",
                    selected === d.id && "bg-accent")}>
                  <FileText className="size-4 text-muted-foreground shrink-0" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium truncate">{d.filename}</span>
                  </span>
                  <Badge variant={d.status === "ready" ? "success" : "secondary"}>{d.status}</Badge>
                </button>
              ))}
              {docs.length === 0 && <div className="p-4 text-sm text-muted-foreground">No documents yet.</div>}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-3">
          <Card>
            <CardContent className="pt-5">
              <form onSubmit={ask} className="space-y-3">
                <Textarea disabled={!selected} value={q} onChange={(e) => setQ(e.target.value)}
                  placeholder={selected ? "Ask about this document…" : "Select a document first"} />
                <div className="flex items-center gap-3">
                  <ImprovePrompt value={q} onChange={setQ} context="document" disabled={busy || !selected} />
                  <Button type="submit" className="ml-auto" disabled={busy || !selected}>
                    {busy ? <><Loader2 className="size-4 animate-spin" /> Working…</> : "Ask"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
          {error && <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</div>}
          {answer && (
            <Card>
              <CardContent className="pt-5">
                {!answer.grounded && (
                  <div className="flex gap-2 text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-sm mb-3">
                    <AlertTriangle className="size-4 shrink-0" /> Nothing relevant found in this document.
                  </div>
                )}
                <p className="whitespace-pre-wrap leading-relaxed text-[15px]">{answer.answer}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
