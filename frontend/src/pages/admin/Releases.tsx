import { useEffect, useMemo, useState } from "react";
import {
  Download,
  Upload,
  Package,
  Pencil,
  Trash2,
  CheckCircle2,
  X,
  Loader2,
  AlertTriangle,
  Sparkles,
  ExternalLink,
} from "lucide-react";
import { DesktopRelease, api } from "@/api";
import { toast } from "@/lib/toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Section } from "@/components/admin/charts";
import { Empty, ErrorBanner, Header, Loading } from "./Dashboard";

function fmtSize(n: number | null): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function ReleasesPage() {
  const [rows, setRows] = useState<DesktopRelease[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState<DesktopRelease | null>(null);
  const { confirm, dialog } = useConfirm();

  async function refresh() {
    try {
      setRows(await api.adminListReleases());
    } catch (e: any) { setErr(e?.message ?? "load failed"); }
  }
  useEffect(() => { refresh(); }, []);

  if (err) return <ErrorBanner msg={err} />;
  if (!rows) return <Loading label="Loading releases…" />;

  const current = rows.find((r) => r.is_current);

  return (
    <div className="space-y-5">
      {dialog}
      <Header
        title="Desktop app releases"
        subtitle="Upload a new .exe here and every installed BharatTax desktop app on the current channel picks it up on its next launch."
      />

      {current ? (
        <div className="rounded-2xl bg-emerald-50/50 ring-1 ring-emerald-200 p-4 flex items-start gap-3">
          <div className="size-9 rounded-lg bg-emerald-600 text-white grid place-items-center shrink-0">
            <CheckCircle2 className="size-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] uppercase tracking-wider text-emerald-700 font-semibold">Currently live</div>
            <div className="text-[15px] font-semibold text-slate-900 mt-0.5">
              v{current.version} <span className="text-slate-400 font-normal">· channel {current.channel}</span>
            </div>
            {current.notes && (
              <div className="text-[12.5px] text-slate-600 mt-1 line-clamp-2 whitespace-pre-wrap">
                {current.notes}
              </div>
            )}
          </div>
          <button
            onClick={() => setUploading(true)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-[12.5px] font-semibold hover:bg-primary/90"
          >
            <Upload className="size-4" /> Upload new
          </button>
        </div>
      ) : (
        <div className="rounded-2xl bg-white border border-dashed border-slate-300 p-6 text-center">
          <div className="mx-auto size-12 rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15 flex items-center justify-center mb-3">
            <Package className="size-5" />
          </div>
          <div className="text-[15px] font-semibold text-slate-900">No releases published yet</div>
          <div className="text-[12.5px] text-slate-500 mt-1">
            Upload your first .exe to bootstrap the auto-update feed.
          </div>
          <button
            onClick={() => setUploading(true)}
            className="mt-3 inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-[13px] font-semibold hover:bg-primary/90"
          >
            <Upload className="size-4" /> Upload first release
          </button>
        </div>
      )}

      <Section
        title="All releases"
        subtitle={rows.length === 0 ? "" : `${rows.length} total · newest first`}
        icon={<Package className="size-4" />}
      >
        {rows.length === 0 ? (
          <Empty label="Nothing here yet." />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[880px] text-sm admin-table">
              <thead className="bg-slate-50 text-slate-700 text-[11px] font-semibold uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium">Version</th>
                  <th className="text-left px-4 py-2.5 font-medium">Channel</th>
                  <th className="text-left px-4 py-2.5 font-medium">Notes</th>
                  <th className="text-right px-4 py-2.5 font-medium">Setup</th>
                  <th className="text-right px-4 py-2.5 font-medium">Portable</th>
                  <th className="text-left px-4 py-2.5 font-medium">Uploaded</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-900">v{r.version}</span>
                        {r.is_current && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-50 ring-1 ring-emerald-200 text-emerald-700 text-[10px] font-semibold">
                            <Sparkles className="size-3" /> current
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 text-[12.5px]">{r.channel}</td>
                    <td className="px-4 py-2.5 text-slate-600 text-[12.5px] max-w-[280px] truncate">
                      {r.notes || <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-800 text-[12.5px]">
                      {fmtSize(r.installer_size)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-800 text-[12.5px]">
                      {fmtSize(r.portable_size)}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 text-[12.5px] whitespace-nowrap">
                      {r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      {!r.is_current && (
                        <button
                          onClick={async () => {
                            if (!(await confirm({
                              title: `Publish v${r.version} as the current release?`,
                              description: "Every installed desktop app will pick it up on next launch.",
                              tone: "primary", confirmLabel: "Publish",
                            }))) return;
                            try {
                              await api.adminPublishRelease(r.id);
                              refresh();
                              toast.success(`v${r.version} published`);
                            } catch (e: any) { toast.error(e?.message ?? "Publish failed"); }
                          }}
                          className="inline-flex items-center gap-1 h-7 px-2 rounded-md bg-emerald-50 ring-1 ring-emerald-200 text-emerald-700 text-[11px] font-semibold hover:bg-emerald-100 mr-1"
                        >
                          Publish
                        </button>
                      )}
                      <button onClick={() => setEditing(r)}
                              className="p-1.5 rounded-md text-slate-400 hover:text-primary hover:bg-primary/10 mr-1"
                              title="Edit notes">
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        onClick={async () => {
                          if (r.is_current) { toast.info("Publish another release first — you cannot delete the current one."); return; }
                          if (!(await confirm({
                            title: `Delete v${r.version}?`,
                            description: "The release and its artefacts are removed from R2.",
                            tone: "danger", confirmLabel: "Delete release",
                          }))) return;
                          try {
                            await api.adminDeleteRelease(r.id);
                            refresh();
                            toast.success(`v${r.version} deleted`);
                          } catch (e: any) { toast.error(e?.message ?? "Delete failed"); }
                        }}
                        className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                        title="Delete release"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-4 text-[12px] text-slate-600">
        <div className="font-semibold text-slate-900 mb-1 flex items-center gap-1.5">
          <ExternalLink className="size-3.5" /> Update feed
        </div>
        <div>
          Installed desktop apps read <code className="font-mono text-slate-800">/desktop/update/latest.yml</code>{" "}
          from this API on launch. Publishing a release automatically rewrites that manifest and
          uploads the .exe to R2. Users see an <b>“Update ready — Restart to install”</b> banner
          when the download completes.
        </div>
      </div>

      {uploading && (
        <UploadDialog
          onClose={() => setUploading(false)}
          onDone={() => { setUploading(false); refresh(); }}
        />
      )}
      {editing && (
        <EditDialog
          release={editing}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); refresh(); }}
        />
      )}
    </div>
  );
}

// ==================================================================== upload

function UploadDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [version, setVersion] = useState("");
  const [channel, setChannel] = useState("latest");
  const [notes, setNotes] = useState("");
  const [publish, setPublish] = useState(true);
  const [installer, setInstaller] = useState<File | null>(null);
  const [portable, setPortable] = useState<File | null>(null);
  const [blockmap, setBlockmap] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const validVersion = useMemo(() => /^\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?$/.test(version), [version]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!installer) { setErr("Installer .exe is required."); return; }
    if (!validVersion) { setErr("Version must look like 1.0.0 or 1.0.0-beta.1."); return; }
    setBusy(true); setErr(null);
    try {
      await api.adminCreateRelease({
        version: version.trim(),
        channel: channel.trim() || "latest",
        notes: notes.trim() || undefined,
        publish,
        installer,
        portable,
        blockmap,
      });
      onDone();
    } catch (e: any) { setErr(e?.message ?? "upload failed"); }
    finally { setBusy(false); }
  }

  return (
    <Modal title="Upload new release" onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Version" required>
            <input value={version} onChange={(e) => setVersion(e.target.value)}
              placeholder="1.0.2" required className="input font-mono" autoFocus />
          </Field>
          <Field label="Channel">
            <input value={channel} onChange={(e) => setChannel(e.target.value)}
              placeholder="latest" className="input font-mono" />
          </Field>
        </div>
        <Field label="Release notes (optional, markdown ok)">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
            placeholder="What's new in this version?"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
        </Field>

        <FilePicker
          label="Setup installer (.exe)"
          required
          accept=".exe"
          file={installer} onChange={setInstaller}
        />
        <FilePicker
          label="Portable (.exe, optional)"
          accept=".exe"
          file={portable} onChange={setPortable}
        />
        <FilePicker
          label="Blockmap (.exe.blockmap, optional but recommended)"
          accept=".blockmap"
          file={blockmap} onChange={setBlockmap}
        />

        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} className="size-4 rounded border-slate-300" />
          Publish immediately (rewrites <code className="font-mono">latest.yml</code>, every installed app updates)
        </label>

        {err && (
          <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 flex items-start gap-2">
            <AlertTriangle className="size-4 mt-0.5 shrink-0" /> {err}
          </div>
        )}

        <div className="pt-1 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="bt-btn-ghost h-9 px-4 rounded-lg">Cancel</button>
          <button type="submit" disabled={busy || !installer || !validVersion} className="bt-btn-primary h-9 px-5 rounded-lg">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            {busy ? "Uploading…" : "Upload"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function FilePicker({
  label, required, accept, file, onChange,
}: {
  label: string; required?: boolean; accept?: string;
  file: File | null; onChange: (f: File | null) => void;
}) {
  return (
    <Field label={label} required={required}>
      <div className="flex items-center gap-2">
        <label className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-slate-50 ring-1 ring-slate-200 text-slate-700 text-[12.5px] font-medium hover:bg-slate-100 cursor-pointer">
          <Download className="size-3.5 rotate-180" /> Pick file
          <input type="file" accept={accept} className="hidden"
            onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
        </label>
        {file ? (
          <div className="flex items-center gap-2 text-[12.5px] text-slate-700">
            <span className="truncate max-w-[280px]">{file.name}</span>
            <span className="text-slate-400 tabular-nums">{fmtSize(file.size)}</span>
            <button type="button" onClick={() => onChange(null)}
              className="text-slate-400 hover:text-rose-600" title="Remove">
              <X className="size-3.5" />
            </button>
          </div>
        ) : (
          <span className="text-[12px] text-slate-400">no file</span>
        )}
      </div>
    </Field>
  );
}

// ==================================================================== edit

function EditDialog({ release, onClose, onDone }: {
  release: DesktopRelease; onClose: () => void; onDone: () => void;
}) {
  const [notes, setNotes] = useState(release.notes ?? "");
  const [channel, setChannel] = useState(release.channel);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await api.adminPatchRelease(release.id, {
        notes: notes.trim() || null,
        channel: channel.trim() || null,
      });
      onDone();
    } catch (e: any) { setErr(e?.message ?? "save failed"); }
    finally { setBusy(false); }
  }

  return (
    <Modal title={`Edit v${release.version}`} onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <Field label="Channel">
          <input value={channel} onChange={(e) => setChannel(e.target.value)} className="input font-mono" />
        </Field>
        <Field label="Release notes (markdown)">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={5}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
        </Field>
        {err && (
          <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 flex items-start gap-2">
            <AlertTriangle className="size-4 mt-0.5 shrink-0" /> {err}
          </div>
        )}
        <div className="pt-1 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="bt-btn-ghost h-9 px-4 rounded-lg">Cancel</button>
          <button type="submit" disabled={busy} className="bt-btn-primary h-9 px-5 rounded-lg">
            {busy ? <Loader2 className="size-4 animate-spin" /> : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ==================================================================== shared

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {label} {required && <span className="text-rose-500">*</span>}
      </label>
      {children}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-up"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl ring-1 ring-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
          <div className="flex items-center gap-2 text-[14px] font-semibold text-slate-900">
            <Package className="size-4 text-primary" /> {title}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <div className="p-5 max-h-[70vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
