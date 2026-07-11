// Typed API client. Token is injected from localStorage; any 401 / expired
// token clears the local session and bounces the user to /login so they never
// see a stale "Signature has expired" error in the middle of the app.
const BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

const TOKEN_KEY = "bharathtax_token";
const SESSION_KEY = "bharathtax_session";

function clearSessionAndRedirect() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
  // Avoid a redirect loop if we're already on the login page.
  if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
    window.location.assign("/login");
  }
}

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

export interface LicenseStatus {
  required: boolean;
  licensed: boolean;
  license_key: string | null;
  pending_key?: string | null;
  assigned_to: string | null;
  valid_until: string | null;
  message: string | null;
}
export interface DocumentOut {
  id: number;
  filename: string;
  status: string;
  created_at: string;
}
export type HistoryKind = "all" | "query" | "appeal" | "document" | "session";
export interface HistoryItem {
  id: string;
  kind: Exclude<HistoryKind, "all">;
  action: string;
  label: string;
  scope: string | null;
  title: string;
  detail: string | null;
  resource_type?: string | null;
  resource_id?: string | null;
  created_at: string;
}
export type HistoryCounts = Record<HistoryKind, number>;
export interface SeatUsage {
  wing_id: number;
  used: number;
  limit: number;
  available: number;
}

// ---- admin console types ----
export type AdminRole = "super_admin" | "wing_admin" | "officer" | "auditor";

export interface AdminUser {
  id: number;
  username: string;
  full_name: string | null;
  email: string | null;
  role: AdminRole;
  designation: string | null;
  wing_id: number;
  office_id: number | null;
  is_active: boolean;
  approval_status: "pending" | "approved" | "rejected";
  approved_at: string | null;
  created_at: string | null;
  features: string[] | null;   // allowed modules; null = all
}

export interface PublicWing {
  id: number;
  name: string;
  code: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  full_name?: string;
  organisation?: string;
}

export interface RegisterResponse {
  id: number;
  email: string;
  full_name: string | null;
  approval_status: string;
  message: string;
  license_key: string | null;
  trial_tokens: number | null;
}

export interface Profile {
  id: number;
  username: string;
  email: string | null;
  full_name: string | null;
  organisation: string | null;
  role: string;
  wing_id: number;
  is_active: boolean;
  approval_status: string;
  created_at: string | null;
}

export interface ProfileUpdate {
  full_name?: string;
  organisation?: string;
  current_password?: string;
  new_password?: string;
}
export interface AdminUserCreate {
  username: string;
  password: string;
  full_name?: string;
  email?: string;
  role: AdminRole;
  designation?: string | null;
  wing_id: number;
  office_id?: number;
  features?: string[] | null;   // allowed modules; null/omitted = all
}
export interface AdminUserUpdate {
  full_name?: string;
  email?: string;
  role?: AdminRole;
  designation?: string | null;
  wing_id?: number;
  office_id?: number;
  is_active?: boolean;
  password?: string;
  features?: string[] | null;   // allowed modules; null = all
}

export interface License {
  id: number;
  key: string;
  status: "active" | "expired" | "deactivated";
  valid_from: string;
  valid_until: string;
  assigned_to: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
export interface LicenseCreate {
  valid_until: string;
  assigned_to?: string;
  notes?: string;
  valid_from?: string;
}
export interface LicenseUpdate {
  valid_until?: string;
  assigned_to?: string;
  notes?: string;
  status?: "active" | "expired" | "deactivated";
}

export interface Revenue {
  id: number;
  entry_date: string;
  source: string;
  description: string | null;
  amount: number;
  currency: string;
  license_key_id: number | null;
  created_at: string;
  updated_at: string;
}
export interface RevenueCreate {
  entry_date?: string;
  source: string;
  description?: string;
  amount: number;
  currency?: string;
  license_key_id?: number;
}
export interface RevenueUpdate {
  entry_date?: string;
  source?: string;
  description?: string;
  amount?: number;
  currency?: string;
  license_key_id?: number;
}

export interface AdminDashboard {
  users_total: number;
  users_active: number;
  pending_approvals: number;
  admins: number;
  queries_24h: number;
  queries_7d: number;
  queries_total: number;
  avg_latency_ms: number | null;
  revenue_month: number;
  revenue_total: number;
  licenses_active: number;
  licenses_expired: number;
  licenses_deactivated: number;
  seats_used: number;
  seats_total: number;
  queries_per_day: { day: string; count: number }[];
  top_questions: { question: string; count: number }[];
}

export interface AdminModelInfo {
  id: string;
  queries_total: number;
  queries_24h: number;
  queries_7d: number;
  avg_latency_ms: number | null;
  success_rate: number;
  is_primary: boolean;
  is_fallback: boolean;
}
export interface AdminModel {
  backend: string;
  base_url: string;
  primary_model: string;
  fallback_model: string | null;
  models: AdminModelInfo[];
  queries_per_day: { day: string; count: number }[];
  latency_per_day: { day: string; latency_ms: number }[];
  last_error: string | null;
  healthy: boolean;
}

export interface TokenActionRow {
  action: string;
  calls: number;
  tokens: number;
}
export interface TokenModelRow {
  model: string;
  calls: number;
  tokens: number;
}
export interface TokenDayRow {
  day: string;
  tokens: number;
  calls: number;
}
export interface TokenRecentRow {
  id: number;
  action: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  latency_ms: number | null;
  created_at: string | null;
}
export interface UserTokenUsage {
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  calls: number;
  tokens_24h: number;
  tokens_7d: number;
  tokens_30d: number;
  by_action: TokenActionRow[];
  per_day: TokenDayRow[];
  recent: TokenRecentRow[];
}
export interface TokenPerUserRow {
  user_id: number;
  username: string;
  full_name: string | null;
  email: string | null;
  calls: number;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
}
export interface AdminTokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  calls: number;
  active_users: number;
  tokens_24h: number;
  tokens_7d: number;
  tokens_window: number;
  window_days: number;
  per_user: TokenPerUserRow[];
  per_action: TokenActionRow[];
  per_model: TokenModelRow[];
  per_day: TokenDayRow[];
}
export interface AdminGeminiRecentRow {
  id: number;
  user_id: number | null;
  username: string | null;
  full_name: string | null;
  action: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  latency_ms: number | null;
  created_at: string;
}
export interface AdminGeminiPerUserRow extends TokenPerUserRow {
  avg_latency_ms: number;
}
export interface AdminGeminiStats {
  configured: boolean;
  web_search_enabled: boolean;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  calls: number;
  active_users: number;
  avg_latency_ms: number;
  calls_24h: number;
  tokens_24h: number;
  tokens_7d: number;
  tokens_window: number;
  window_days: number;
  per_day: TokenDayRow[];
  per_model: TokenModelRow[];
  per_user: AdminGeminiPerUserRow[];
  per_action: TokenActionRow[];
  recent: AdminGeminiRecentRow[];
}

// ---- billing / subscription types ----
export interface SubscriptionPlan {
  id: number;
  name: string;
  description: string | null;
  monthly_price_inr: number;
  monthly_token_allowance: number;
  is_active: boolean;
  sort_order: number;
  created_at?: string | null;
  updated_at?: string | null;
}
export interface TokenRate {
  id: number;
  model_slug: string;
  provider: string | null;
  input_price_per_1k_inr: number;
  output_price_per_1k_inr: number;
  is_active: boolean;
  effective_from?: string | null;
  notes?: string | null;
  updated_at?: string | null;
}
export interface CurrentSubscription {
  id: number;
  plan_id: number;
  plan_name: string | null;
  monthly_price_inr: number;
  started_at: string | null;
  expires_at: string | null;
  is_free_trial: boolean;
  status: string;
  notes: string | null;
  is_expired: boolean;
  tokens_allowed: number;
  tokens_used: number;
  tokens_left: number;
  pct_used: number;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    calls: number;
    grounded_calls?: number;
    grounding_cost_est_inr?: number;
  };
}
export interface AdminBillingUser {
  user_id: number;
  username: string;
  full_name: string | null;
  email: string | null;
  wing_id: number;
  is_active: boolean;
  current_subscription: CurrentSubscription | null;
}
export interface AdminBillingUsers {
  users: AdminBillingUser[];
  count: number;
}
export interface MyBillingBreakdown {
  action: string;
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}
export interface MyBillingHistoryRow {
  id: number;
  plan_name: string | null;
  monthly_price_inr: number;
  started_at: string | null;
  expires_at: string | null;
  is_free_trial: boolean;
  status: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    calls: number;
    grounded_calls?: number;
    grounding_cost_est_inr?: number;
  };
}
export interface MyBilling {
  current_subscription: CurrentSubscription | null;
  spend_breakdown: MyBillingBreakdown[];
  estimated_period_cost_inr: number;
  token_cost_inr?: number;
  grounding_cost_inr?: number;
  history: MyBillingHistoryRow[];
}

export interface AdminUserTokenUsage {
  user: { id: number; username: string; full_name: string | null; email: string | null; role: string };
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  calls: number;
  tokens_24h: number;
  tokens_7d: number;
  by_action: TokenActionRow[];
  by_model: TokenModelRow[];
  per_day: TokenDayRow[];
}

export interface AdminModelService {
  key: string;
  name: string;
  role: string;
  status: "ok" | "degraded" | "down";
  detail: string | null;
  latency_ms: number | null;
  endpoint: string | null;
  models: string[];
  meta: Record<string, unknown>;
}

export interface AdminModelHealth {
  checked_at: string;
  services: AdminModelService[];
  active_generation: "gemini" | "local" | "none";
  all_healthy: boolean;
  any_down: boolean;
}

export interface AdminServer {
  healthy: boolean;
  cpu_percent: number;
  cpu_count: number;
  load_avg: number[];
  mem_total_mb: number;
  mem_used_mb: number;
  mem_percent: number;
  swap_used_mb: number;
  swap_percent: number;
  disk_total_gb: number;
  disk_used_gb: number;
  disk_percent: number;
  uptime_seconds: number;
  process_count: number;
  network_bytes_sent: number;
  network_bytes_recv: number;
  containers: { name: string; status: string; image: string }[];
  llm_endpoint_healthy: boolean;
  llm_endpoint_latency_ms: number | null;
}

function token(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string>) };
  if (!(opts.body instanceof FormData)) headers["Content-Type"] = "application/json";
  const t = token();
  if (t) headers["Authorization"] = `Bearer ${t}`;
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  if (!res.ok) {
    let detail: string = res.statusText;
    let rawDetail: unknown = null;
    try {
      const body = await res.json();
      rawDetail = body?.detail ?? null;
      // FastAPI HTTPException can carry a str OR a dict/JSON payload as
      // `detail`. We keep the human-readable message on `.message`, and hand
      // the structured version to callers via `.detail`.
      if (typeof rawDetail === "string") detail = rawDetail;
      else if (rawDetail && typeof rawDetail === "object" && typeof (rawDetail as any).message === "string")
        detail = (rawDetail as any).message;
    } catch {
      /* ignore */
    }
    // The login call itself returning 401 is "wrong username/password" — let
    // that surface to the login form. Any OTHER 401 means the session is gone
    // (expired signature, revoked seat lease, etc.) — bounce to /login.
    if (res.status === 401 && !path.startsWith("/auth/login")) {
      clearSessionAndRedirect();
    }
    throw new ApiError(res.status, detail, rawDetail);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public detail: unknown = null) {
    super(message);
  }
}

export const api = {
  login: (email: string, password: string) =>
    req<TokenResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  register: (b: RegisterRequest) =>
    req<RegisterResponse>("/auth/register", { method: "POST", body: JSON.stringify(b) }),
  publicWings: () => req<PublicWing[]>("/auth/wings"),
  profile: () => req<Profile>("/auth/profile"),
  myTokenUsage: () => req<UserTokenUsage>("/auth/token-usage"),
  updateProfile: (b: ProfileUpdate) =>
    req<Profile>("/auth/profile", { method: "PUT", body: JSON.stringify(b) }),
  logout: () => req<{ ok: boolean }>("/auth/logout", { method: "POST" }),
  me: () => req<{ id: number; username: string; role: string; designation: string | null; wing_id: number; features: string[] | null }>("/auth/me"),

  // --- license activation (gates the chat for non-admin users) ---
  licenseStatus: () => req<LicenseStatus>("/auth/license/status"),
  activateLicense: (key: string) =>
    req<LicenseStatus>("/auth/license/activate", {
      method: "POST",
      body: JSON.stringify({ key }),
    }),
  ask: (question: string, domain?: string, style?: string) =>
    req<AnswerResponse>("/ask", { method: "POST", body: JSON.stringify({ question, domain, style }) }),
  feedback: (b: { question?: string; answer?: string; rating?: string; correction?: string }) =>
    req<{ ok: boolean }>("/assist/feedback", { method: "POST", body: JSON.stringify(b) }),
  rate: (b: { target_type: "appeal" | "chat"; target_id?: string | number; stars: number; question?: string; answer?: string; comment?: string }) =>
    req<{ ok: boolean; stars: number }>("/ratings", { method: "POST", body: JSON.stringify({ ...b, target_id: b.target_id == null ? undefined : String(b.target_id) }) }),
  getRating: (target_type: string, target_id: string | number) =>
    req<{ stars: number | null; comment: string | null }>(`/ratings/${target_type}/${String(target_id)}`),
  documents: () => req<DocumentOut[]>("/documents"),
  uploadDocument: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return req<DocumentOut>("/documents", { method: "POST", body: fd });
  },
  askDocument: (id: number, question: string) =>
    req<AnswerResponse>(`/documents/${id}/ask`, { method: "POST", body: JSON.stringify({ question }) }),
  history: (kind: HistoryKind = "all", limit = 100) =>
    req<HistoryItem[]>(`/history?kind=${kind}&limit=${limit}`),
  historyCounts: () => req<HistoryCounts>("/history/counts"),
  historyDelete: (id: string) =>
    req<void>(`/history/${encodeURIComponent(id)}`, { method: "DELETE" }),
  historyClear: (kind: HistoryKind = "all") =>
    req<void>(`/history?kind=${kind}`, { method: "DELETE" }),
  seatUsage: (wingId: number) => req<SeatUsage>(`/admin/wings/${wingId}/seats`),
  wings: () => req<{ id: number; name: string; code: string; seat_limit: number }[]>("/admin/wings"),
  adminCreateWing: (body: { name: string; code?: string; seat_limit?: number }) =>
    req<{ id: number; name: string; code: string; seat_limit: number }>("/admin/wings", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // --- authoring helpers ---
  improvePrompt: (text: string, context: "ask" | "document" = "ask") =>
    req<{ original: string; improved: string; changed: boolean }>("/assist/improve-prompt", {
      method: "POST",
      body: JSON.stringify({ text, context }),
    }),

  // --- rulings (case-law search) ---
  rulings: (q: string) => req<any>(`/rulings?q=${encodeURIComponent(q)}`),
  // section hub (#11): statute + circulars + leading cases (with headnotes) for a section
  crossref: (section: string) => req<any>(`/crossref?section=${encodeURIComponent(section)}`),

  // --- admin corpus ---
  corpusStats: () => req<{ chunks: number; by_domain: Record<string, number> }>("/admin/corpus/stats"),
  ingestCaseLaw: () => req<any>("/admin/corpus/ingest-case-law", { method: "POST" }),

  // --- admin: dashboard / model / server ---
  adminDashboard: () => req<AdminDashboard>("/admin/dashboard"),
  adminModel: () => req<AdminModel>("/admin/model"),
  adminModelHealth: () => req<AdminModelHealth>("/admin/model/health"),
  adminServer: () => req<AdminServer>("/admin/model/server"),

  // --- admin: users / admins ---
  adminListUsers: (filters?: { wing_id?: number; role?: string; q?: string; approval_status?: string }) => {
    const p = new URLSearchParams();
    if (filters?.wing_id != null) p.set("wing_id", String(filters.wing_id));
    if (filters?.role) p.set("role", filters.role);
    if (filters?.q) p.set("q", filters.q);
    if (filters?.approval_status) p.set("approval_status", filters.approval_status);
    const qs = p.toString();
    return req<AdminUser[]>(`/admin/users${qs ? `?${qs}` : ""}`);
  },
  adminCreateUser: (b: AdminUserCreate) =>
    req<AdminUser>("/admin/users", { method: "POST", body: JSON.stringify(b) }),
  adminUpdateUser: (id: number, b: AdminUserUpdate) =>
    req<AdminUser>(`/admin/users/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  adminApproveUser: (id: number) =>
    req<AdminUser>(`/admin/users/${id}/approve`, { method: "POST" }),
  adminRejectUser: (id: number) =>
    req<AdminUser>(`/admin/users/${id}/reject`, { method: "POST" }),
  adminDeleteUser: (id: number) =>
    req<void>(`/admin/users/${id}`, { method: "DELETE" }),

  // --- admin: licenses ---
  adminLicenses: () => req<License[]>("/admin/licenses"),
  adminCreateLicense: (b: LicenseCreate) =>
    req<License>("/admin/licenses", { method: "POST", body: JSON.stringify(b) }),
  adminUpdateLicense: (id: number, b: LicenseUpdate) =>
    req<License>(`/admin/licenses/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  adminDeactivateLicense: (id: number) =>
    req<License>(`/admin/licenses/${id}/deactivate`, { method: "POST" }),
  adminDeleteLicense: (id: number) =>
    req<void>(`/admin/licenses/${id}`, { method: "DELETE" }),

  // --- admin: revenue ---
  adminRevenue: () => req<Revenue[]>("/admin/revenue"),
  adminCreateRevenue: (b: RevenueCreate) =>
    req<Revenue>("/admin/revenue", { method: "POST", body: JSON.stringify(b) }),
  adminUpdateRevenue: (id: number, b: RevenueUpdate) =>
    req<Revenue>(`/admin/revenue/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  adminDeleteRevenue: (id: number) =>
    req<void>(`/admin/revenue/${id}`, { method: "DELETE" }),
  adminRevenueSummary: () =>
    req<{ by_month: { month: string; amount: number }[]; currency: string }>(
      "/admin/revenue/summary",
    ),

  // --- admin: token usage ---
  adminTokenUsage: (days = 30) =>
    req<AdminTokenUsage>(`/admin/token-usage?days=${days}`),
  // ---- billing (admin + user) ----
  adminBillingPlans: () => req<SubscriptionPlan[]>("/admin/billing/plans"),
  adminBillingCreatePlan: (body: Partial<SubscriptionPlan>) =>
    req<SubscriptionPlan>("/admin/billing/plans", { method: "POST", body: JSON.stringify(body) }),
  adminBillingPatchPlan: (id: number, body: Partial<SubscriptionPlan>) =>
    req<SubscriptionPlan>(`/admin/billing/plans/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  adminBillingDeletePlan: (id: number) =>
    req<void>(`/admin/billing/plans/${id}`, { method: "DELETE" }),
  adminBillingRates: () => req<TokenRate[]>("/admin/billing/token-rates"),
  adminBillingCreateRate: (body: Partial<TokenRate>) =>
    req<TokenRate>("/admin/billing/token-rates", { method: "POST", body: JSON.stringify(body) }),
  adminBillingPatchRate: (id: number, body: Partial<TokenRate>) =>
    req<TokenRate>(`/admin/billing/token-rates/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  adminBillingDeleteRate: (id: number) =>
    req<void>(`/admin/billing/token-rates/${id}`, { method: "DELETE" }),
  adminBillingUsers: () => req<AdminBillingUsers>("/admin/billing/users"),
  adminBillingAssign: (userId: number, body: {
    plan_id: number;
    is_free_trial?: boolean;
    duration_days?: number | null;
    tokens_allowed_override?: number | null;
    notes?: string | null;
  }) => req<CurrentSubscription>(`/admin/billing/users/${userId}/assign`,
                                { method: "POST", body: JSON.stringify(body) }),
  adminBillingPatchSubscription: (subId: number, body: {
    started_at?: string | null;
    expires_at?: string | null;
    tokens_allowed_override?: number | null;
    status?: string;
    notes?: string | null;
    is_free_trial?: boolean;
  }) => req<CurrentSubscription>(`/admin/billing/subscriptions/${subId}`,
                                 { method: "PATCH", body: JSON.stringify(body) }),
  myBilling: () => req<MyBilling>("/billing/me"),
  publicPlans: () => req<SubscriptionPlan[]>("/billing/plans"),

  adminGemini: (days = 30) =>
    req<AdminGeminiStats>(`/admin/gemini?days=${days}`),
  adminUserTokenUsage: (userId: number) =>
    req<AdminUserTokenUsage>(`/admin/users/${userId}/token-usage`),

  // --- appeal drafting ---
  appealCases: () => req<any[]>("/appeal/cases"),
  appealCreateCase: (b: any) => req<any>("/appeal/cases", { method: "POST", body: JSON.stringify(b) }),
  appealCase: (id: string | number) => req<any>(`/appeal/cases/${id}`),
  appealUpload: (id: string | number, files: FileList) => {
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append("files", f));
    return req<any>(`/appeal/cases/${id}/documents`, { method: "POST", body: fd });
  },
  appealUpdateDocCategory: (cid: string | number, did: number, category: string) =>
    req<any>(`/appeal/cases/${cid}/documents/${did}`, {
      method: "PUT",
      body: JSON.stringify({ category }),
    }),
  appealRun: (id: string | number) => req<any>(`/appeal/cases/${id}/run`, { method: "POST" }),
  appealRunStatus: (rid: number) => req<any>(`/appeal/runs/${rid}`),
  appealStopCase: (id: string | number) => req<any>(`/appeal/cases/${id}/stop`, { method: "POST" }),
  appealCancelRun: (rid: number) => req<any>(`/appeal/runs/${rid}/cancel`, { method: "POST" }),
  appealPatchCase: (
    id: string | number,
    body: { title?: string; assessment_year?: string | null; pan?: string | null; section?: string | null },
  ) =>
    req<any>(`/appeal/cases/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  appealDeleteCase: (id: string | number) =>
    req<void>(`/appeal/cases/${id}`, { method: "DELETE" }),
  appealDeleteDoc: (cid: string | number, did: number) =>
    req<{ deleted_id: number; filename: string; missing: string[] }>(
      `/appeal/cases/${cid}/documents/${did}`,
      { method: "DELETE" },
    ),
  appealLatest: (id: string | number) => req<any>(`/appeal/cases/${id}/latest`),
  appealEditOutput: (oid: number, content: string) =>
    req<any>(`/appeal/outputs/${oid}`, { method: "PUT", body: JSON.stringify({ content }) }),
  appealRegenerate: (id: string | number, seq: number) => req<any>(`/appeal/cases/${id}/issues/${seq}/regenerate`, { method: "POST" }),
  appealReassemble: (id: string | number) => req<any>(`/appeal/cases/${id}/reassemble`, { method: "POST" }),
  appealInstructDraft: (
    id: string | number,
    instruction: string,
    selection?: string,
    base_version?: number,
  ) =>
    req<{
      id: number; version: number; edited: boolean; instruction: string; chars: number;
      content?: string; change_start?: number | null; change_end?: number | null;
    }>(
      `/appeal/cases/${id}/draft/instruct`,
      { method: "POST", body: JSON.stringify({ instruction, selection, base_version }) },
    ),
  appealDraftVersions: (id: string | number) => req<any[]>(`/appeal/cases/${id}/draft-versions`),
  async appealDownload(path: string, filename: string) {
    const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token()}` } });
    if (!res.ok) throw new ApiError(res.status, "Download failed");
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
  },
  // Fetch the rendered PDF preview of the draft, returning a blob URL the
  // caller drops into an <iframe src>. Caller is responsible for revoking
  // the URL when done.
  appealOnlyOfficeConfig: (cid: string | number) =>
    req<{ editor_url: string; config: Record<string, unknown> }>(
      `/appeal/cases/${cid}/oo/config`,
    ),
  appealForcesaveDraft: (cid: string | number) =>
    req<{ ok: boolean; detail: string | null }>(
      `/appeal/cases/${cid}/oo/forcesave`,
      { method: "POST", body: JSON.stringify({}) },
    ),
  async appealPreviewPdfUrl(cid: string | number): Promise<string> {
    const res = await fetch(`${BASE}/appeal/cases/${cid}/preview.pdf`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    if (!res.ok) {
      let detail = res.statusText;
      try { detail = (await res.text()) || detail; } catch { /* ignore */ }
      throw new ApiError(res.status, detail.slice(0, 240));
    }
    return URL.createObjectURL(await res.blob());
  },
  async appealOpenDoc(cid: string | number, did: number) {
    const res = await fetch(`${BASE}/appeal/cases/${cid}/documents/${did}/file`, { headers: { Authorization: `Bearer ${token()}` } });
    if (!res.ok) throw new ApiError(res.status, "Open failed");
    window.open(URL.createObjectURL(await res.blob()), "_blank");
  },
};
