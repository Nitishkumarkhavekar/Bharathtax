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
};
