import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Download,
  Loader2,
  AlertTriangle,
  ArrowRight,
  Scale,
  Shield,
  Zap,
  Package,
  Clock,
  MonitorDown,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublicRelease, PublicReleaseCatalogue, api } from "@/api";

// Public landing-page /releases page. Anyone (even signed-out) can hit this
// URL to grab the desktop app. The .exe artefacts live in R2; downloads are
// served through /desktop/update/{filename} which 302-redirects to a
// short-lived presigned URL — so the R2 endpoint is never in the browser URL.

function fmtSize(n: number | null): string {
  if (!n) return "—";
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function apiBase(): string {
  // Same fallback as src/api.ts so download links resolve identically whether
  // the API is baked into the build or read from the current origin at
  // runtime (nginx-proxied deployments).
  return (import.meta.env.VITE_API_BASE_URL as string) || "";
}

export default function ReleasesLanding() {
  const [data, setData] = useState<PublicReleaseCatalogue | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.publicReleases().then(setData).catch((e) => setErr(e?.message ?? "load failed"));
  }, []);

  return (
    <div className="min-h-screen bg-slate-50">
      <TopBar />

      <main className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-10">
        {/* Intro / marketing text */}
        <section className="mb-8">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary ring-1 ring-primary/20 px-3 py-1 text-xs font-semibold">
            <Package className="size-3.5" /> Desktop app
          </div>
          <h1 className="mt-3 text-3xl sm:text-4xl font-semibold tracking-tight text-slate-900">
            BharatTax Appeal Order — for Windows
          </h1>
          <p className="mt-3 max-w-2xl text-[15px] text-slate-600 leading-relaxed">
            Draft CIT(A) / NFAC appeal orders on your own laptop. Sign in with your
            BharatTax account, activate a license, upload the case bundle, and get
            back a citation-grounded draft order in minutes — no browser required.
          </p>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-slate-600">
            <div className="inline-flex items-center gap-1.5"><Shield className="size-4 text-emerald-600" /> Nothing sensitive ships in the .exe</div>
            <div className="inline-flex items-center gap-1.5"><Zap className="size-4 text-amber-600" /> Auto-updates itself when we ship a new version</div>
            <div className="inline-flex items-center gap-1.5"><MonitorDown className="size-4 text-primary" /> Windows 10 &amp; 11 · x64</div>
          </div>
        </section>

        {err && (
          <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-800 px-3 py-2 mb-6 flex items-start gap-2">
            <AlertTriangle className="size-4 mt-0.5 shrink-0" /> {err}
          </div>
        )}

        {!data && !err && (
          <div className="text-sm text-slate-500 flex items-center gap-2 mb-6">
            <Loader2 className="size-4 animate-spin" /> Loading releases…
          </div>
        )}

        {data && data.current && (
          <LatestReleaseCard release={data.current} />
        )}
        {data && !data.current && (
          <div className="rounded-2xl bg-white border border-dashed border-slate-300 p-8 text-center">
            <div className="mx-auto size-12 rounded-2xl bg-slate-100 text-slate-500 ring-1 ring-slate-200 flex items-center justify-center mb-3">
              <Package className="size-5" />
            </div>
            <div className="text-[15px] font-semibold text-slate-900">No release published yet</div>
            <div className="text-[13px] text-slate-500 mt-1">
              We'll post the first Windows build here as soon as it's ready.
            </div>
          </div>
        )}

        {data && data.releases.length > 1 && (
          <PriorReleases releases={data.releases.filter((r) => !r.is_current)} />
        )}

        <NextStepsCard />
      </main>

      <Footer />
    </div>
  );
}

// ============================================================ latest card

function LatestReleaseCard({ release }: { release: PublicRelease }) {
  return (
    <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary via-sky-600 to-violet-600 text-white p-6 sm:p-8 shadow-xl shadow-primary/20">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.10]"
        style={{
          backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
          backgroundSize: "22px 22px",
        }}
      />
      <div className="pointer-events-none absolute -right-16 -top-16 size-72 rounded-full bg-white/15 blur-3xl" />

      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-white/15 ring-1 ring-white/25 px-2 py-0.5 text-[11px] font-semibold tracking-wide backdrop-blur">
            <Zap className="size-3" /> Latest release
          </div>
          <div className="mt-2 text-3xl sm:text-[34px] font-semibold tracking-tight leading-none">
            v{release.version}
          </div>
          {release.released_at && (
            <div className="mt-1.5 text-white/85 text-[13px] flex items-center gap-1.5">
              <Clock className="size-3.5" /> Released {fmtDate(release.released_at)}
            </div>
          )}
          {release.notes && (
            <div className="mt-3 max-w-xl text-white/90 text-[13.5px] whitespace-pre-wrap leading-relaxed">
              {release.notes}
            </div>
          )}
        </div>
      </div>

      <div className="relative mt-6 flex flex-wrap items-center gap-3">
        {release.installer_download_url && (
          <a
            href={apiBase() + release.installer_download_url}
            className="inline-flex items-center gap-2 h-11 px-5 rounded-lg bg-white text-primary font-semibold text-[14px] hover:bg-white/90 shadow-lg shadow-black/10 transition-colors"
            download
          >
            <Download className="size-4.5" />
            Download installer
            <span className="opacity-70 text-[12px] tabular-nums">
              ({fmtSize(release.installer_size)})
            </span>
          </a>
        )}
        {release.portable_download_url && (
          <a
            href={apiBase() + release.portable_download_url}
            className="inline-flex items-center gap-2 h-11 px-5 rounded-lg bg-white/10 ring-1 ring-white/30 text-white font-semibold text-[13.5px] hover:bg-white/15 backdrop-blur"
            download
          >
            <Download className="size-4" />
            Portable (.exe) · {fmtSize(release.portable_size)}
          </a>
        )}
      </div>

      <div className="relative mt-5 text-[11.5px] text-white/70 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span>Windows 10 &amp; 11 · x64</span>
        <span>Requires ~200 MB free disk</span>
        <span>Auto-updates from v{release.version} onwards</span>
      </div>
    </section>
  );
}

// ============================================================ prior versions

function PriorReleases({ releases }: { releases: PublicRelease[] }) {
  return (
    <section className="mt-8">
      <div className="flex items-center gap-2 mb-3">
        <FileText className="size-4 text-slate-500" />
        <h2 className="text-[14px] font-semibold tracking-wide uppercase text-slate-500">
          Previous versions
        </h2>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-slate-50 text-slate-700 text-[11px] font-semibold uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium">Version</th>
              <th className="text-left px-4 py-2.5 font-medium">Released</th>
              <th className="text-left px-4 py-2.5 font-medium">Notes</th>
              <th className="text-right px-4 py-2.5 font-medium">Setup</th>
              <th className="text-right px-4 py-2.5 font-medium">Portable</th>
            </tr>
          </thead>
          <tbody>
            {releases.map((r) => (
              <tr key={r.version} className="border-t border-slate-100">
                <td className="px-4 py-2.5 font-medium text-slate-900">v{r.version}</td>
                <td className="px-4 py-2.5 text-slate-600 text-[12.5px] whitespace-nowrap">
                  {fmtDate(r.released_at)}
                </td>
                <td className="px-4 py-2.5 text-slate-600 text-[12.5px] max-w-[260px] truncate">
                  {r.notes || <span className="text-slate-400">—</span>}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {r.installer_download_url ? (
                    <a href={apiBase() + r.installer_download_url}
                       className="inline-flex items-center gap-1 text-primary hover:text-primary/80 font-semibold text-[12.5px]" download>
                      <Download className="size-3.5" /> {fmtSize(r.installer_size)}
                    </a>
                  ) : (
                    <span className="text-slate-400 text-[12.5px]">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {r.portable_download_url ? (
                    <a href={apiBase() + r.portable_download_url}
                       className="inline-flex items-center gap-1 text-primary hover:text-primary/80 font-semibold text-[12.5px]" download>
                      <Download className="size-3.5" /> {fmtSize(r.portable_size)}
                    </a>
                  ) : (
                    <span className="text-slate-400 text-[12.5px]">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ============================================================ next steps

function NextStepsCard() {
  return (
    <section className="mt-10 grid md:grid-cols-3 gap-4">
      <StepCard n={1} title="Install and sign in"
        body="Run the installer, then sign in with your BharatTax account. If you don't have one, ask your administrator to register you." />
      <StepCard n={2} title="Activate license"
        body="Paste the license key your admin sent you. Your token allowance and expiry live on the server, so nothing sensitive ships in the .exe." />
      <StepCard n={3} title="Draft your first appeal"
        body="Create a case, upload the assessment order + evidence, and let the pipeline draft the CIT(A) order end-to-end. Review and download the .docx." />
    </section>
  );
}
function StepCard({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div className="rounded-xl bg-white ring-1 ring-slate-200 shadow-sm p-5">
      <div className="size-8 rounded-lg bg-primary/10 ring-1 ring-primary/20 text-primary font-semibold flex items-center justify-center mb-3">
        {n}
      </div>
      <div className="text-[14px] font-semibold text-slate-900">{title}</div>
      <div className="text-[12.5px] text-slate-600 mt-1 leading-relaxed">{body}</div>
    </div>
  );
}

// ============================================================ chrome

function TopBar() {
  return (
    <header className="sticky top-0 z-30 bg-white/85 backdrop-blur border-b border-slate-200">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 h-16 flex items-center gap-4">
        <Link to="/" className="flex items-center gap-2">
          <div className="size-9 rounded-lg bg-primary/10 ring-1 ring-primary/30 flex items-center justify-center">
            <Scale className="size-5 text-primary" />
          </div>
          <span className="text-lg font-semibold tracking-tight">BharathTax</span>
        </Link>
        <nav className="hidden md:flex items-center gap-1 ml-6 text-sm">
          <Link to="/" className="px-3 py-2 rounded-md text-slate-700 hover:bg-slate-100 hover:text-slate-900">Home</Link>
          <Link to="/releases" className="px-3 py-2 rounded-md text-primary bg-primary/10 font-medium">Releases</Link>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Link to="/login" className="hidden sm:inline-flex items-center text-sm font-medium text-slate-700 hover:text-slate-900 px-3 py-2 rounded-md hover:bg-slate-100">
            Sign in
          </Link>
          <Link to="/register">
            <Button size="sm" className="gap-1.5">
              Get started <ArrowRight className="size-3.5" />
            </Button>
          </Link>
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t border-slate-200 mt-16 py-8 text-center text-[12px] text-slate-500">
      © {new Date().getFullYear()} BharathTax · CIT(A) / NFAC appeal drafting
    </footer>
  );
}
