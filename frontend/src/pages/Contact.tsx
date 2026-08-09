import { FormEvent, useState } from "react";
import { Mail, Building2, LifeBuoy, CheckCircle2, Loader2, Send } from "lucide-react";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { api, ApiError } from "../api";

const TOPICS = ["Sales enquiry", "Book a demo", "Wing / bench licensing", "Technical support", "Partnership", "Other"];

export default function Contact() {
  const [form, setForm] = useState({ name: "", email: "", organisation: "", topic: TOPICS[0], message: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setErr(null);
    setBusy(true);
    try {
      await api.contact(form);
      setDone(true);
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "Couldn't send — please try again or email us directly.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <MarketingShell
      eyebrow="Contact"
      title="Talk to the BharatTax team."
      intro="Sales, a demo for your bench, licensing for a wing, or a support question — tell us what you need and we'll get back within one business day."
    >
      <div className="grid lg:grid-cols-[1fr_260px] gap-8 items-start">
        {/* Form */}
        <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm p-6 sm:p-8">
          {done ? (
            <div className="text-center py-10">
              <div className="mx-auto size-12 rounded-full bg-emerald-50 text-emerald-600 grid place-items-center mb-4">
                <CheckCircle2 className="size-6" />
              </div>
              <div className="text-lg font-semibold text-slate-900">Message sent</div>
              <p className="text-[14px] text-slate-600 mt-1.5 max-w-sm mx-auto">
                Thanks, {form.name.split(" ")[0] || "there"} — we've received your message and will be in touch shortly.
              </p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Name" required>
                  <input required value={form.name} onChange={(e) => set("name", e.target.value)}
                    className={inputCls} placeholder="Your full name" />
                </Field>
                <Field label="Work email" required>
                  <input required type="email" value={form.email} onChange={(e) => set("email", e.target.value)}
                    className={inputCls} placeholder="you@department.gov.in" />
                </Field>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Organisation">
                  <input value={form.organisation} onChange={(e) => set("organisation", e.target.value)}
                    className={inputCls} placeholder="Wing / firm / department" />
                </Field>
                <Field label="Topic">
                  <select value={form.topic} onChange={(e) => set("topic", e.target.value)} className={inputCls}>
                    {TOPICS.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Message" required>
                <textarea required rows={5} value={form.message} onChange={(e) => set("message", e.target.value)}
                  className={inputCls + " resize-y"} placeholder="How can we help?" />
              </Field>
              {err && <div className="text-[13px] text-rose-700 bg-rose-50 rounded-lg px-3 py-2">{err}</div>}
              <button type="submit" disabled={busy}
                className="inline-flex items-center gap-2 h-11 px-6 rounded-xl bg-primary text-white font-semibold text-[14px] hover:bg-primary/90 transition-colors disabled:opacity-60">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                {busy ? "Sending…" : "Send message"}
              </button>
            </form>
          )}
        </div>

        {/* Direct channels */}
        <aside className="space-y-3">
          <ContactCard icon={<Mail className="size-4" />} title="Sales" lines={["sales@wenvia.global"]} href="mailto:sales@wenvia.global" />
          <ContactCard icon={<LifeBuoy className="size-4" />} title="Support" lines={["support@wenvia.global"]} href="mailto:support@wenvia.global" />
          <ContactCard icon={<Building2 className="size-4" />} title="General" lines={["hello@bharattax.wenvia.global"]} href="mailto:hello@bharattax.wenvia.global" />
        </aside>
      </div>
    </MarketingShell>
  );
}

const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-[14px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[12.5px] font-semibold text-slate-800 mb-1 block">
        {label}{required && <span className="text-rose-500"> *</span>}
      </span>
      {children}
    </label>
  );
}

function ContactCard({ icon, title, lines, href }: { icon: React.ReactNode; title: string; lines: string[]; href: string }) {
  return (
    <a href={href} className="block rounded-xl bg-white ring-1 ring-slate-200 shadow-sm p-4 hover:ring-primary/30 transition-all">
      <div className="flex items-center gap-2 text-primary">
        <span className="size-8 rounded-lg bg-primary/10 grid place-items-center">{icon}</span>
        <span className="text-[13px] font-semibold text-slate-900">{title}</span>
      </div>
      {lines.map((l) => <div key={l} className="text-[12.5px] text-slate-600 mt-1.5">{l}</div>)}
    </a>
  );
}
