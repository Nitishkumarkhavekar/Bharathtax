// Typed API client. Token is injected from localStorage; 401s bubble up so the
// auth layer can log the user out.
const BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

export interface Citation {
  n: number;
  chunk_id: number;
  breadcrumb: string;
  source_url: string | null;
  section_number: string | null;
}
export interface AnswerResponse {
  query_id: number | null;
  scope: "corpus" | "document";
  grounded: boolean;
  answer: string;
  citations: Citation[];
  meta: Record<string, unknown>;
  latency_ms: number | null;
}
export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_at: string;
  role: string;
  wing_id: number;
  username: string;
}
export interface DocumentOut {
  id: number;
  filename: string;
  status: string;
  created_at: string;
}
export interface HistoryItem {
  id: number;
  scope: "corpus" | "document";
  question: string;
  answer: string | null;
  created_at: string;
}
export interface SeatUsage {
  wing_id: number;
  used: number;
  limit: number;
  available: number;
}

function token(): string | null {
  return localStorage.getItem("bharathtax_token");
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string>) };
  if (!(opts.body instanceof FormData)) headers["Content-Type"] = "application/json";
  const t = token();
  if (t) headers["Authorization"] = `Bearer ${t}`;
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const api = {
  login: (username: string, password: string) =>
    req<TokenResponse>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: () => req<{ ok: boolean }>("/auth/logout", { method: "POST" }),
  me: () => req<{ id: number; username: string; role: string; wing_id: number }>("/auth/me"),
  ask: (question: string, domain?: string, style?: string) =>
    req<AnswerResponse>("/ask", { method: "POST", body: JSON.stringify({ question, domain, style }) }),
  documents: () => req<DocumentOut[]>("/documents"),
  uploadDocument: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return req<DocumentOut>("/documents", { method: "POST", body: fd });
  },
  askDocument: (id: number, question: string) =>
    req<AnswerResponse>(`/documents/${id}/ask`, { method: "POST", body: JSON.stringify({ question }) }),
  history: () => req<HistoryItem[]>("/history"),
  seatUsage: (wingId: number) => req<SeatUsage>(`/admin/wings/${wingId}/seats`),
  wings: () => req<{ id: number; name: string; code: string; seat_limit: number }[]>("/admin/wings"),

  // --- authoring helpers ---
  improvePrompt: (text: string, context: "ask" | "document" = "ask") =>
    req<{ original: string; improved: string; changed: boolean }>("/assist/improve-prompt", {
      method: "POST",
      body: JSON.stringify({ text, context }),
    }),

  // --- rulings (case-law search) ---
  rulings: (q: string) => req<any>(`/rulings?q=${encodeURIComponent(q)}`),

  // --- admin corpus ---
  corpusStats: () => req<{ chunks: number; by_domain: Record<string, number> }>("/admin/corpus/stats"),
  ingestCaseLaw: () => req<any>("/admin/corpus/ingest-case-law", { method: "POST" }),

  // --- appeal drafting ---
  appealCases: () => req<any[]>("/appeal/cases"),
  appealCreateCase: (b: any) => req<any>("/appeal/cases", { method: "POST", body: JSON.stringify(b) }),
  appealCase: (id: number) => req<any>(`/appeal/cases/${id}`),
  appealUpload: (id: number, files: FileList) => {
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append("files", f));
    return req<any>(`/appeal/cases/${id}/documents`, { method: "POST", body: fd });
  },
  appealRun: (id: number) => req<any>(`/appeal/cases/${id}/run`, { method: "POST" }),
  appealRunStatus: (rid: number) => req<any>(`/appeal/runs/${rid}`),
  appealLatest: (id: number) => req<any>(`/appeal/cases/${id}/latest`),
  appealEditOutput: (oid: number, content: string) =>
    req<any>(`/appeal/outputs/${oid}`, { method: "PUT", body: JSON.stringify({ content }) }),
  appealRegenerate: (id: number, seq: number) => req<any>(`/appeal/cases/${id}/issues/${seq}/regenerate`, { method: "POST" }),
  appealReassemble: (id: number) => req<any>(`/appeal/cases/${id}/reassemble`, { method: "POST" }),
  appealDraftVersions: (id: number) => req<any[]>(`/appeal/cases/${id}/draft-versions`),
  async appealDownload(path: string, filename: string) {
    const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token()}` } });
    if (!res.ok) throw new ApiError(res.status, "Download failed");
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
  },
  async appealOpenDoc(cid: number, did: number) {
    const res = await fetch(`${BASE}/appeal/cases/${cid}/documents/${did}/file`, { headers: { Authorization: `Bearer ${token()}` } });
    if (!res.ok) throw new ApiError(res.status, "Open failed");
    window.open(URL.createObjectURL(await res.blob()), "_blank");
  },
};
