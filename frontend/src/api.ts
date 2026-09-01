// Typed API client. Token is injected from localStorage; any 401 / expired
// token clears the local session and bounces the user to /login so they never
// see a stale "Signature has expired" error in the middle of the app.

// Base URL resolution (first match wins):
//   1. Dev tunnel (*.devtunnels.ms) → same origin (Vite proxies the API).
//   2. RUNTIME config — `window.__BHARATTAX_CONFIG__` set by /config.js, which
//      the container serves and a deployment edits WITHOUT rebuilding. This is
//      the on-prem / sovereign-instance hook: point the same build at the
//      department's own backend (`{ apiBase: "https://itd.internal" }`) or the
//      same host it's served from (`{ sameOrigin: true }`).
//   3. Build-time VITE_API_BASE_URL (our SaaS build).
//   4. localhost:8000 for direct dev.
function _resolveApiBase(): string {
  try {
    if (typeof window !== "undefined") {
      const host = window.location.hostname || "";
      if (host.endsWith(".devtunnels.ms")) return window.location.origin;
      const cfg = (window as any).__BHARATTAX_CONFIG__;
      if (cfg && typeof cfg === "object") {
        if (cfg.sameOrigin === true) return window.location.origin;
        if (typeof cfg.apiBase === "string" && cfg.apiBase.trim()) {
          return cfg.apiBase.trim().replace(/\/+$/, "");
        }
      }
    }
  } catch { /* SSR / non-browser envs */ }
  return import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
}
import { saveBlob, type SaveResult } from "./lib/saveFile";

const BASE = _resolveApiBase();
// Exported so other modules (auth heartbeat) resolve the SAME base — including
// any runtime on-prem override — instead of re-reading the build env.
export const API_BASE = BASE;

// Local-first mode is a DEPLOYMENT posture, set per-instance in /config.js
// (window.__BHARATTAX_CONFIG__.localFirst = true) — no rebuild. When on, the
// finished work-product is saved to the officer's own machine and then removed
// from this server, so nothing is retained on our cloud. Off by default (the
// managed SaaS keeps the workspace persistent).
export function isLocalFirst(): boolean {
  try {
    return !!(window as unknown as { __BHARATTAX_CONFIG__?: { localFirst?: boolean } })
      .__BHARATTAX_CONFIG__?.localFirst;
  } catch { return false; }
}

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
export interface ServerChat {
  id: number;
  title: string;
  archived: boolean;
  pinned: boolean;
  share_id?: string | null;
  created_at: string | null;
  updated_at: string | null;
  message_count: number | null;
}
export interface ContactMessage {
  id: number;
  name: string;
  email: string;
  mobile: string | null;
  organisation: string | null;
  topic: string | null;
  message: string;
  handled: boolean;
  created_at: string | null;
}
export interface ContactMessagePage {
  items: ContactMessage[];
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
}
// The public/marketing view of a SubscriptionPlan — everything the landing
// page needs to render a pricing tile driven from the admin panel.
export interface PublicPricingPlan {
  id: number;
  name: string;
  description: string | null;
  monthly_price_inr: number;
  yearly_price_inr: number;
  annual_discount_pct: number;
  monthly_token_allowance: number;
  is_active: boolean;
  sort_order: number;
  features: string[];
  is_featured: boolean;
  badge: string | null;
  savings_note: string | null;
}
export interface ServerChatMessage {
  id: number;
  role: string;
  content: string;
  citations: Citation[];
  meta: Record<string, unknown>;
  created_at: string | null;
}
export interface ServerChatFull extends ServerChat {
  messages: ServerChatMessage[];
  /** Set on the /chats/shared/{share_id} response. */
  shared?: boolean;
  /** True on the shared-view when the current user owns the source chat. */
  owned?: boolean;
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
  /** For query rows: id of the chat thread this question belongs to
   *  (resolved by matching content + timestamp to ChatMessage). Null
   *  when the underlying chat has been deleted. */
  chat_id?: number | null;
  /** For query rows: docs the user attached to the turn. Slim shape —
   *  enough to render a Preview/Download chip via api.documentFile. */
  attachments?: Array<{
    docId: number;
    filename: string | null;
    contentType?: string | null;
    size?: number | null;
  }>;
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
  workspace_profile: string | null;
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
  designation: string | null;
  workspace_profile: string | null;
  workspace_wings: string[] | null;
  wing_id: number;
  is_active: boolean;
  approval_status: string;
  created_at: string | null;
}

export interface ProfileUpdate {
  full_name?: string;
  organisation?: string;
  designation?: string;
  workspace_profile?: string;
  workspace_wings?: string[] | null;
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
  workspace_profile?: string | null;
  wing_id: number;
  office_id?: number;
  features?: string[] | null;   // allowed modules; null/omitted = all
}
export interface AdminUserUpdate {
  full_name?: string;
  email?: string;
  role?: AdminRole;
  designation?: string | null;
  workspace_profile?: string | null;
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
  window_mode?: "days" | "month";
  window_start?: string;
  window_end?: string;
  window_year?: number | null;
  window_month?: number | null;
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
  window_mode?: "days" | "month";
  window_start?: string;
  window_end?: string;
  window_year?: number | null;
  window_month?: number | null;
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
  // Explicit yearly price (admin override). When the backend auto-computes
  // from monthly × discount, this still comes back populated with the derived
  // value; `yearly_price_is_override` tells you which case you're in.
  yearly_price_inr?: number;
  yearly_price_is_override?: boolean;
  monthly_token_allowance: number;
  is_active: boolean;
  sort_order: number;
  // Marketing / landing-page controls (all optional so PATCH bodies can omit).
  features?: string[] | null;
  is_featured?: boolean;
  badge?: string | null;
  savings_note?: string | null;
  annual_discount_pct?: number;
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
  alert?: {
    level: string;
    code: string;
    message: string;
    spend_24h_tokens?: number;
    at?: string;
  } | null;
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

// --- Daily workspace: matters, limitation calendar, reminders ---------------
export interface WsMatter {
  id: number;
  title: string;
  pan: string | null;
  assessment_year: string | null;
  appeal_no: string | null;
  category: string | null;
  status: string;
  notes: string | null;
  owned?: boolean;
  shared?: boolean;
  created_at: string | null;
  updated_at: string | null;
}
export interface WsDeadline {
  id: number;
  matter_id: number;
  kind: string;
  label: string;
  section_ref: string | null;
  trigger_event: string | null;
  trigger_date: string | null;
  due_date: string;
  is_auto: boolean;
  status: string;
  notes: string | null;
}
export interface WsDemand {
  id: number;
  matter_id: number;
  assessment_year: string | null;
  section: string | null;
  amount: number;
  paid: number;
  outstanding: number;
  default_date: string | null;
  raised_date: string | null;
  status: string;
  notes: string | null;
  interest_220_2: number;
  interest_months: number;
  total_due: number;
}
export interface WsReminder {
  id: number;
  matter_id: number | null;
  deadline_id: number | null;
  title: string;
  due_at: string | null;
  channels: string[];
  status: string;
  notes: string | null;
}
export interface WsRuleCatalogue {
  triggers: { id: string; label: string }[];
  rules: { id: string; trigger: string; label: string; section: string }[];
}
export interface WsWorkloadRow {
  id: number; title: string; pan: string | null; assessment_year: string | null;
  category: string | null; status: string; owned: boolean;
  open_count: number; overdue_count: number; urgent_count: number; due30_count: number;
  demand_due: number;
  next_due_date: string | null; next_label: string | null; next_section: string | null;
  updated_at: string | null;
}
export interface WsWorkload {
  summary: { total_matters: number; open_deadlines: number; overdue: number; due_7: number; due_30: number };
  matters: WsWorkloadRow[];
}
export interface RulingAlert {
  id: number; title: string; digest: string; source_url: string | null;
  matched: string[]; date: string | null; fresh: boolean;
}
export interface RulingAlerts {
  sections: string[];
  source: "usage" | "function" | "none";
  items: RulingAlert[];
  fresh_count: number;
}
export type SavedKind = "answer" | "ruling" | "draft" | "note";
export interface LibraryItem {
  id: number;
  kind: SavedKind;
  title: string;
  content: string;
  source_url: string | null;
  sections: string[];
  ref_id: string | null;
  created_at: string | null;
}
export interface SaveItemBody {
  kind: SavedKind;
  title?: string;
  content?: string;
  source_url?: string | null;
  sections?: string[];
  ref_id?: string | null;
  meta?: Record<string, unknown>;
}
export interface WsNote {
  id: number;
  matter_id: number | null;
  body: string;
  color: string;
  section_ref: string | null;
  source: string | null;
  pinned: boolean;
  created_at: string | null;
  updated_at: string | null;
}
export interface WsInterestResult {
  section: string;
  principal: number;
  from_date: string;
  to_date: string;
  rate_pct_per_month: number;
  months: number;
  interest: number;
  total_payable: number;
  workings: string;
}
export interface WsBBEResult {
  income: number;
  base_rate_pct: number;
  base_tax: number;
  surcharge_pct: number;
  surcharge: number;
  cess_pct: number;
  cess: number;
  total_tax: number;
  effective_rate_pct: number;
  workings: string;
}
export interface WsTemplate {
  id: number;
  name: string;
  category: string;
  body: string;
  created_at: string | null;
  updated_at: string | null;
}
export interface WsWatchlist {
  id: number;
  label: string;
  query: string;
  kind: string;
  created_at: string | null;
}
export interface WsLibraryTemplate {
  id: string;
  name: string;
  category: string;
  side: string;
  group?: string;
  body: string;
}
export interface WsShare {
  id: number;
  email: string | null;
  name: string | null;
  permission: string;
}
export interface WsReconResult {
  matched: { key: string; name: string; amount_a: number; amount_b: number; diff: number }[];
  amount_mismatch: { key: string; name: string; amount_a: number; amount_b: number; diff: number }[];
  only_in_a: { key: string; name: string; amount: number }[];
  only_in_b: { key: string; name: string; amount: number }[];
  summary: {
    total_a: number; total_b: number; matched_count: number;
    mismatch_count: number; only_a_count: number; only_b_count: number;
  };
}
export interface WsSftThreshold { key: string; label: string; threshold: number }
export interface WsSftFlag { category: string; label: string; amount: number; threshold: number }
export interface WsSftPerson { pan: string; name: string; total: number; count: number; flagged: boolean; flags: WsSftFlag[] }
export interface WsSftResult {
  people: WsSftPerson[];
  summary: { persons: number; flagged: number; transactions: number; grand_total: number };
  note: string;
}
export interface Ws234CResult {
  section: string;
  tax_liability: number;
  installments: { installment: string; required: number; paid: number; shortfall: number; months: number; interest: number }[];
  interest: number;
}
export interface WsSlabResult {
  income: number; regime: string; tax_before_rebate: number;
  rebate_87a: number; surcharge_pct: number; surcharge: number;
  cess: number; total_tax: number; effective_rate_pct: number;
}
export interface WsCapGainsResult {
  kind: string; label: string; gain: number; exemption: number;
  taxable: number; rate_pct: number; tax: number; cess: number; total_tax: number;
}
export interface WsPenaltyResult {
  kind: string; label: string; base_tax: number; rate_pct: number; penalty: number; note: string;
}
export interface WsTdsResult {
  amount: number; rate_pct: number; tds: number; interest_201_1a: number;
  interest_deduction_leg: { months: number; rate_pct_per_month: number; interest: number };
  interest_deposit_leg: { months: number; rate_pct_per_month: number; interest: number };
  fee_234e: number; fee_234e_days: number; total_payable: number; workings: string; note: string;
}
export interface WsTdsSection {
  section: string; nature: string; rate: number | null; note: string;
}
export interface WsInstallmentRow {
  n: number; due_date: string; opening_balance: number; principal: number;
  interest_220_2: number; total_due: number; closing_balance: number;
}
export interface WsInstallmentResult {
  section: string; demand: number; installments: number; monthly_rate_pct: number;
  total_principal: number; total_interest: number; total_payable: number;
  schedule: WsInstallmentRow[]; note: string;
}
export interface WsTrust11Result {
  gross_income: number; permitted_accumulation_15pct: number; required_application_85pct: number;
  amount_applied: number; accumulated_11_2_form10: number; shortfall_taxable: number;
  workings: string; note: string;
}
export interface Ws115BBCResult {
  anonymous_donations: number; total_donations: number; exempt_threshold: number;
  taxable_at_115bbc: number; rate_pct: number; tax: number; cess: number; total_tax: number;
  workings: string; note: string;
}
export interface WsPeakRow { date: string; kind: string; amount: number; running_balance: number }
export interface WsPeakCreditResult {
  peak_credit: number; peak_date: string | null; total_credits: number; total_debits: number;
  entries: number; schedule: WsPeakRow[]; note: string;
}
export interface WsTpMethod { key: string; name: string; use: string }
export interface WsAlpResult {
  method: string; count: number; at_arms_length: boolean | null;
  lower_p35?: number; upper_p65?: number; median?: number; mean?: number;
  tested_margin?: number; alp_margin?: number; adjustment?: number; note: string;
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

// Public shape returned by GET /desktop/releases (landing-page consumer).
export interface PublicRelease {
  version: string;
  channel: string;
  notes: string | null;
  is_current: boolean;
  installer_size: number | null;
  portable_size: number | null;
  installer_download_url: string | null;
  portable_download_url: string | null;
  installer_filename: string | null;
  portable_filename: string | null;
  released_at: string | null;
}
export interface PublicReleaseCatalogue {
  current: PublicRelease | null;
  releases: PublicRelease[];
}

// Admin CRUD shape (private).
export interface DesktopRelease {
  id: number;
  version: string;
  channel: string;
  notes: string | null;
  installer_key: string | null;
  portable_key: string | null;
  blockmap_key: string | null;
  installer_size: number | null;
  portable_size: number | null;
  installer_sha512: string | null;
  is_current: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface Personalization {
  charge: string | null;
  preferred_language: string;
  role: string;
  designation: string | null;
  custom_instructions: string;
  about_me: string;
  style: Record<string, unknown>;
  memory_enabled: boolean;
}
export interface MemoryItem {
  id: number;
  content: string;
  kind: string;
  source: string;
  pinned: boolean;
  created_at: string | null;
}

export interface DraftField {
  key: string;
  label: string;
  textarea: boolean;
  required: boolean;
  placeholder: string;
}
export interface DraftTemplate {
  kind: string;
  label: string;
  category: string;
  section: string;
  group?: string;
  wings?: string[];
  fields: DraftField[];
}
export interface DraftReviewEvent {
  status: string;              // pending | approved | returned
  drafter: string | null;
  reviewer: string | null;
  request_note: string;
  review_remarks: string;
  created_at: string | null;
  resolved_at: string | null;
}
export interface DraftReviewInfo {
  reviewer_user_id: number | null;
  reviewer_name: string | null;
  is_reviewer: boolean;        // viewer is the assigned reviewer, while in review
  is_owner: boolean;
  can_edit: boolean;
  history: DraftReviewEvent[];
}
export interface DraftDoc {
  id: number;
  kind: string;
  title: string;
  inputs: Record<string, string>;
  content: string;
  status: string;              // draft | in_review | approved | returned | final
  created_at: string | null;
  updated_at: string | null;
  review?: DraftReviewInfo;
}
export interface Reviewer {
  id: number;
  full_name: string;
  designation: string | null;
  tier: string;                // field | range | commissioner | ""
  is_senior: boolean;
  same_office: boolean;
}
export interface ReviewInboxItem {
  id: number;
  kind: string;
  title: string;
  status: string;
  drafter: string | null;
  updated_at: string | null;
}
export interface DraftListItem {
  id: number;
  kind: string;
  title: string;
  status: string;
  updated_at: string | null;
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
  me: () => req<{ id: number; username: string; full_name: string | null; role: string; designation: string | null; workspace_profile: string | null; workspace_wings: string[] | null; wing_id: number; features: string[] | null }>("/auth/me"),
  workspaceProfiles: () => req<{ key: string; label: string }[]>("/auth/workspace-profiles"),

  // --- personalization / memory ---
  personalization: () => req<Personalization>("/me/personalization"),
  updatePersonalization: (b: Partial<Personalization>) =>
    req<Personalization>("/me/personalization", { method: "PUT", body: JSON.stringify(b) }),
  listMemory: () => req<MemoryItem[]>("/me/memory"),
  addMemory: (b: { content: string; kind?: string; pinned?: boolean }) =>
    req<MemoryItem>("/me/memory", { method: "POST", body: JSON.stringify(b) }),
  updateMemory: (id: number, b: { content?: string; kind?: string; pinned?: boolean }) =>
    req<MemoryItem>(`/me/memory/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  deleteMemory: (id: number) => req<void>(`/me/memory/${id}`, { method: "DELETE" }),

  // --- drafting suite (notices / orders) ---
  draftTemplates: () => req<DraftTemplate[]>("/drafts/templates"),
  listDrafts: () => req<DraftListItem[]>("/drafts"),
  getDraft: (id: number) => req<DraftDoc>(`/drafts/${id}`),
  createDraft: (b: { kind: string; inputs: Record<string, string>; title?: string }) =>
    req<DraftDoc>("/drafts", { method: "POST", body: JSON.stringify(b) }),
  updateDraft: (id: number, b: { content?: string; title?: string; status?: string }) =>
    req<DraftDoc>(`/drafts/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  regenerateDraft: (id: number) => req<DraftDoc>(`/drafts/${id}/regenerate`, { method: "POST" }),
  deleteDraft: (id: number) => req<void>(`/drafts/${id}`, { method: "DELETE" }),
  // Draft review & approval
  draftReviewers: () => req<Reviewer[]>("/drafts/reviewers"),
  draftReviewInbox: () => req<ReviewInboxItem[]>("/drafts/review-inbox"),
  draftReviewInboxCount: () => req<{ count: number }>("/drafts/review-inbox/count"),
  draftSendReview: (id: number, b: { reviewer_user_id: number; note?: string }) =>
    req<DraftDoc>(`/drafts/${id}/send-review`, { method: "POST", body: JSON.stringify(b) }),
  draftApprove: (id: number, remarks?: string) =>
    req<DraftDoc>(`/drafts/${id}/approve`, { method: "POST", body: JSON.stringify({ remarks }) }),
  draftReturn: (id: number, remarks?: string) =>
    req<DraftDoc>(`/drafts/${id}/return`, { method: "POST", body: JSON.stringify({ remarks }) }),

  // --- license status (read-only; users no longer activate their own key) ---
  licenseStatus: () => req<LicenseStatus>("/auth/license/status"),
  sessionStatus: () =>
    req<{ state: "ok" | "logout" | "blocked"; reason: string; message: string | null }>(
      "/auth/session/status",
    ),
  ask: (
    question: string,
    domain?: string,
    style?: string,
    chat_id?: number,
    attached_document_ids?: number[],
    attachments_meta?: Array<Record<string, unknown>>,
  ) =>
    req<AnswerResponse>("/ask", {
      method: "POST",
      body: JSON.stringify({
        question, domain, style, chat_id,
        attached_document_ids, attachments_meta,
      }),
    }),
  // Streamed answer over Server-Sent Events. Same agent/citations as `ask`, but
  // emits live tool status + token deltas. Uses fetch (not EventSource) so we can
  // send the bearer token. Handlers fire as events arrive; resolves when done.
  async askStream(
    question: string,
    opts: {
      domain?: string;
      style?: string;
      chatId?: number;
      attachedDocumentIds?: number[];
      attachmentsMeta?: Array<Record<string, unknown>>;
    },
    handlers: {
      onStatus?: (s: string) => void;
      onDelta: (d: string) => void;
      onReset?: () => void;
      /** Fired the INSTANT the backend emits a clarify event — before
       *  the DB persist and terminal `done`. Lets the option buttons
       *  render as soon as the question text finishes streaming. */
      onClarify?: (c: { question: string; options: string[] }) => void;
      onDone: (d: { grounded: boolean; citations: Citation[]; meta: Record<string, unknown> }) => void;
      onError?: (msg: string) => void;
    },
    signal?: AbortSignal,
  ): Promise<void> {
    const res = await fetch(`${BASE}/ask/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
      body: JSON.stringify({
        question,
        domain: opts.domain,
        style: opts.style,
        chat_id: opts.chatId,
        attached_document_ids: opts.attachedDocumentIds,
        attachments_meta: opts.attachmentsMeta,
      }),
      signal,
    });
    if (!res.ok || !res.body) throw new ApiError(res.status, "Stream failed");
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      // SSE frames are separated by a blank line.
      while ((nl = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
        if (!dataLine) continue;
        const payload = dataLine.slice(5).trim();
        if (!payload) continue;
        let ev: Record<string, unknown>;
        try {
          ev = JSON.parse(payload);
        } catch {
          continue;
        }
        if (typeof ev.delta === "string") handlers.onDelta(ev.delta);
        else if (typeof ev.status === "string") handlers.onStatus?.(ev.status);
        else if (ev.reset) handlers.onReset?.();
        else if (ev.clarify) {
          const c = ev.clarify as { question: string; options: string[] };
          handlers.onClarify?.(c);
        }
        else if (ev.error) handlers.onError?.(String(ev.error));
        else if (ev.done) {
          handlers.onDone({
            grounded: ev.grounded !== false,
            citations: (ev.citations as Citation[]) || [],
            meta: (ev.meta as Record<string, unknown>) || {},
          });
        }
      }
    }
  },
  askStarters: () =>
    req<{ starters: { category: string; text: string }[] }>("/ask/starters").then((r) => r.starters),
  askFollowups: (question: string, answer: string, domain?: string) =>
    req<{ suggestions: string[] }>("/ask/followups", { method: "POST", body: JSON.stringify({ question, answer, domain }) }),
  translate: (text: string, lang: string) =>
    req<{ translated: string }>("/ask/translate", { method: "POST", body: JSON.stringify({ text, lang }) }).then((r) => r.translated),
  contact: (b: { name: string; email: string; mobile?: string; organisation?: string; topic?: string; message: string }) =>
    req<{ ok: boolean; message: string }>("/contact", { method: "POST", body: JSON.stringify(b) }),
  // admin: contact-form enquiries
  adminContactList: (opts: { page?: number; per_page?: number; filter?: "all" | "open" | "handled" } = {}) => {
    const qs = new URLSearchParams();
    qs.set("page", String(opts.page ?? 1));
    qs.set("per_page", String(opts.per_page ?? 20));
    qs.set("filter", opts.filter ?? "all");
    return req<ContactMessagePage>(`/contact?${qs.toString()}`);
  },
  adminContactSetHandled: (id: number, handled: boolean) =>
    req<ContactMessage>(`/contact/${id}`, { method: "PATCH", body: JSON.stringify({ handled }) }),
  adminContactDelete: (id: number) => req<void>(`/contact/${id}`, { method: "DELETE" }),
  // Server-owned chat conversations (per-user isolated).
  chatList: (archived = false) =>
    req<ServerChat[]>(`/chats${archived ? "?archived=true" : ""}`),
  chatCreate: (title?: string) =>
    req<ServerChat>("/chats", { method: "POST", body: JSON.stringify({ title }) }),
  chatGet: (id: number) => req<ServerChatFull>(`/chats/${id}`),
  chatPatch: (id: number, b: { title?: string; archived?: boolean; pinned?: boolean }) =>
    req<ServerChat>(`/chats/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  chatDelete: (id: number) => req<void>(`/chats/${id}`, { method: "DELETE" }),
  chatShare: (id: number) =>
    req<{ share_id: string }>(`/chats/${id}/share`, { method: "POST" }),
  chatUnshare: (id: number) => req<void>(`/chats/${id}/share`, { method: "DELETE" }),
  getSharedChat: (shareId: string) => req<ServerChatFull>(`/chats/shared/${shareId}`),
  forkSharedChat: (shareId: string) =>
    req<ServerChat>(`/chats/shared/${shareId}/fork`, { method: "POST" }),
  feedback: (b: { question?: string; answer?: string; rating?: string; correction?: string }) =>
    req<{ ok: boolean }>("/assist/feedback", { method: "POST", body: JSON.stringify(b) }),
  rate: (b: { target_type: "appeal" | "chat"; target_id?: string | number; stars: number; question?: string; answer?: string; comment?: string }) =>
    req<{ ok: boolean; stars: number }>("/ratings", { method: "POST", body: JSON.stringify({ ...b, target_id: b.target_id == null ? undefined : String(b.target_id) }) }),
  getRating: (target_type: string, target_id: string | number) =>
    req<{ stars: number | null; comment: string | null }>(`/ratings/${target_type}/${String(target_id)}`),
  // Chat composer attachment upload — the standalone Documents page is
  // gone, but chat messages still support attaching files via the same
  // /documents endpoint. Returns the created row so the composer can
  // reference the doc id when the user hits Send.
  //
  // Uses XMLHttpRequest instead of fetch() because fetch's Request body
  // stream does not emit upload-progress events — the composer needs a
  // real 0–100 progress signal to render the % bar on the chip.
  uploadDocument: (
    file: File,
    onProgress?: (pct: number) => void,
    signal?: AbortSignal,
  ) =>
    new Promise<DocumentOut>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const fd = new FormData();
      fd.append("file", file);
      xhr.upload.onprogress = (e) => {
        if (onProgress && e.lengthComputable) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText) as DocumentOut);
          } catch (e) {
            reject(new ApiError(xhr.status, `Malformed upload response: ${(e as Error).message}`));
          }
        } else {
          // Match the fetch-based req() error shape so callers can rely on ApiError.
          let msg = xhr.statusText || `Upload failed (HTTP ${xhr.status})`;
          try {
            const body = JSON.parse(xhr.responseText);
            msg = body?.detail || body?.message || msg;
          } catch { /* non-JSON body */ }
          reject(new ApiError(xhr.status, msg));
        }
      };
      xhr.onerror = () => reject(new ApiError(0, "Network error"));
      xhr.onabort = () => reject(new ApiError(0, "Upload aborted"));
      if (signal) {
        if (signal.aborted) return reject(new ApiError(0, "Upload aborted"));
        signal.addEventListener("abort", () => xhr.abort(), { once: true });
      }
      xhr.open("POST", `${BASE}/documents`);
      const t = token();
      if (t) xhr.setRequestHeader("Authorization", `Bearer ${t}`);
      xhr.send(fd);
    }),
  /** Fetch an owned document's raw bytes for download or in-browser
   * preview. Uses the bearer token so the URL itself can't leak. We
   * download into a Blob and mint a local object-URL so the browser
   * can either save it (`<a download>`) or render it in a new tab. */
  async documentFile(id: number, opts: { inline?: boolean } = {}): Promise<Blob> {
    const q = opts.inline ? "?inline=1" : "";
    const res = await fetch(`${BASE}/documents/${id}/file${q}`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    if (!res.ok) throw new ApiError(res.status, `document fetch failed (${res.status})`);
    return await res.blob();
  },
  history: (kind: HistoryKind = "all", limit = 100) =>
    req<HistoryItem[]>(`/history?kind=${kind}&limit=${limit}`),
  historyCounts: () => req<HistoryCounts>("/history/counts"),
  historyDelete: (id: string) =>
    req<void>(`/history/${encodeURIComponent(id)}`, { method: "DELETE" }),
  historyClear: (kind: HistoryKind = "all") =>
    req<void>(`/history?kind=${kind}`, { method: "DELETE" }),
  seatUsage: (wingId: number) => req<SeatUsage>(`/admin/wings/${wingId}/seats`),

  // --- Daily workspace ------------------------------------------------------
  wsLimitationRules: () => req<WsRuleCatalogue>("/workspace/limitation-rules"),
  wsMatters: () => req<WsMatter[]>("/workspace/matters"),
  wsMatter: (id: number) => req<WsMatter & { deadlines: WsDeadline[]; demands: WsDemand[] }>(`/workspace/matters/${id}`),
  wsAddDemand: (matterId: number, body: { amount: number; assessment_year?: string; section?: string; paid?: number; default_date?: string; raised_date?: string; notes?: string }) =>
    req<WsDemand>(`/workspace/matters/${matterId}/demands`, { method: "POST", body: JSON.stringify(body) }),
  wsUpdateDemand: (id: number, body: { amount?: number; paid?: number; status?: string; section?: string; assessment_year?: string; default_date?: string; raised_date?: string; notes?: string }) =>
    req<WsDemand>(`/workspace/demands/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  wsDeleteDemand: (id: number) =>
    req<void>(`/workspace/demands/${id}`, { method: "DELETE" }),
  wsCreateMatter: (body: Partial<WsMatter>) =>
    req<WsMatter>("/workspace/matters", { method: "POST", body: JSON.stringify(body) }),
  wsUpdateMatter: (id: number, body: Partial<WsMatter>) =>
    req<WsMatter>(`/workspace/matters/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  wsDeleteMatter: (id: number) =>
    req<void>(`/workspace/matters/${id}`, { method: "DELETE" }),
  wsComputeDeadlines: (id: number, trigger_event: string, trigger_date: string) =>
    req<{ created: WsDeadline[] }>(`/workspace/matters/${id}/deadlines/compute`, {
      method: "POST",
      body: JSON.stringify({ trigger_event, trigger_date }),
    }),
  wsAddDeadline: (id: number, body: { label: string; due_date: string; section_ref?: string; notes?: string }) =>
    req<WsDeadline>(`/workspace/matters/${id}/deadlines`, { method: "POST", body: JSON.stringify(body) }),
  wsUpdateDeadline: (id: number, body: { status?: string; label?: string; due_date?: string; notes?: string }) =>
    req<WsDeadline>(`/workspace/deadlines/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  wsDeleteDeadline: (id: number) =>
    req<void>(`/workspace/deadlines/${id}`, { method: "DELETE" }),
  wsCalendar: (start: string, end: string, includeDone = false) =>
    req<WsDeadline[]>(`/workspace/calendar?start=${start}&end=${end}&include_done=${includeDone}`),
  wsReminders: (pendingOnly = true) =>
    req<WsReminder[]>(`/workspace/reminders?pending_only=${pendingOnly}`),
  wsWorkload: () => req<WsWorkload>("/workspace/workload"),
  rulingAlerts: () => req<RulingAlerts>("/workspace/ruling-alerts"),
  // My Library — saved answers / rulings / drafts.
  libraryList: (kind?: SavedKind) =>
    req<LibraryItem[]>(`/library${kind ? `?kind=${kind}` : ""}`),
  librarySavedRefs: (kind?: SavedKind) =>
    req<string[]>(`/library/refs${kind ? `?kind=${kind}` : ""}`),
  librarySave: (body: SaveItemBody) =>
    req<LibraryItem>("/library", { method: "POST", body: JSON.stringify(body) }),
  libraryDelete: (id: number) => req<void>(`/library/${id}`, { method: "DELETE" }),
  libraryUnsaveRef: (kind: SavedKind, refId: string) =>
    req<void>(`/library/by-ref/${kind}/${encodeURIComponent(refId)}`, { method: "DELETE" }),
  wsDueReminders: () => req<WsReminder[]>("/workspace/reminders/due"),
  wsUpdateReminder: (id: number, body: { status?: string; title?: string; due_at?: string; notes?: string }) =>
    req<WsReminder>(`/workspace/reminders/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  wsNotes: (matterId?: number) =>
    req<WsNote[]>(`/workspace/notes${matterId != null ? `?matter_id=${matterId}` : ""}`),
  wsCreateNote: (body: { body: string; matter_id?: number | null; color?: string; section_ref?: string; source?: string }) =>
    req<WsNote>("/workspace/notes", { method: "POST", body: JSON.stringify(body) }),
  wsUpdateNote: (id: number, body: { body?: string; color?: string; pinned?: boolean; section_ref?: string }) =>
    req<WsNote>(`/workspace/notes/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  wsDeleteNote: (id: number) =>
    req<void>(`/workspace/notes/${id}`, { method: "DELETE" }),
  wsCalcInterest: (body: { section: string; principal: number; from_date: string; to_date: string }) =>
    req<WsInterestResult>("/workspace/calc/interest", { method: "POST", body: JSON.stringify(body) }),
  wsCalc115bbe: (income: number) =>
    req<WsBBEResult>("/workspace/calc/115bbe", { method: "POST", body: JSON.stringify({ income }) }),
  wsCalc234c: (tax_liability: number, cum_paid: number[]) =>
    req<Ws234CResult>("/workspace/calc/234c", { method: "POST", body: JSON.stringify({ tax_liability, cum_paid }) }),
  wsCalcSlab: (income: number, regime: string) =>
    req<WsSlabResult>("/workspace/calc/slab", { method: "POST", body: JSON.stringify({ income, regime }) }),
  wsCalcCapitalGains: (amount: number, kind: string) =>
    req<WsCapGainsResult>("/workspace/calc/capital-gains", { method: "POST", body: JSON.stringify({ amount, kind }) }),
  wsCalcPenalty: (kind: string, base_tax: number, pct?: number) =>
    req<WsPenaltyResult>("/workspace/calc/penalty", { method: "POST", body: JSON.stringify({ kind, base_tax, pct }) }),
  wsCalcTds: (b: { amount: number; rate_pct: number; deduction_due: string; deducted_on?: string | null; deposited_on?: string | null; statement_due?: string | null }) =>
    req<WsTdsResult>("/workspace/calc/tds", { method: "POST", body: JSON.stringify(b) }),
  wsTdsSections: () => req<WsTdsSection[]>("/workspace/tds-sections"),
  wsCalcInstallments: (b: { demand: number; installments: number; first_due: string }) =>
    req<WsInstallmentResult>("/workspace/calc/installments", { method: "POST", body: JSON.stringify(b) }),
  wsCalcTrust11: (b: { gross_income: number; amount_applied: number; accumulated_11_2: number }) =>
    req<WsTrust11Result>("/workspace/calc/trust-11", { method: "POST", body: JSON.stringify(b) }),
  wsCalc115bbc: (b: { anonymous_donations: number; total_donations: number }) =>
    req<Ws115BBCResult>("/workspace/calc/115bbc", { method: "POST", body: JSON.stringify(b) }),
  wsCalcPeakCredit: (entries: { date: string; amount: number; kind: string }[]) =>
    req<WsPeakCreditResult>("/workspace/calc/peak-credit", { method: "POST", body: JSON.stringify({ entries }) }),
  wsCalcAlp: (b: { comparables: number[]; tested_margin: number; base_amount: number }) =>
    req<WsAlpResult>("/workspace/calc/alp", { method: "POST", body: JSON.stringify(b) }),
  wsTpMethods: () => req<WsTpMethod[]>("/workspace/tp-methods"),
  // templates
  wsTemplates: () => req<WsTemplate[]>("/workspace/templates"),
  wsTemplateLibrary: () => req<WsLibraryTemplate[]>("/workspace/templates/library"),
  wsCreateTemplate: (body: { name: string; body: string; category?: string }) =>
    req<WsTemplate>("/workspace/templates", { method: "POST", body: JSON.stringify(body) }),
  wsUpdateTemplate: (id: number, body: { name?: string; body?: string; category?: string }) =>
    req<WsTemplate>(`/workspace/templates/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  wsDeleteTemplate: (id: number) => req<void>(`/workspace/templates/${id}`, { method: "DELETE" }),
  // watchlists
  wsWatchlists: () => req<WsWatchlist[]>("/workspace/watchlists"),
  wsCreateWatchlist: (body: { label: string; query: string; kind?: string }) =>
    req<WsWatchlist>("/workspace/watchlists", { method: "POST", body: JSON.stringify(body) }),
  wsUpdateWatchlist: (id: number, body: { label?: string; query?: string; kind?: string }) =>
    req<WsWatchlist>(`/workspace/watchlists/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  wsDeleteWatchlist: (id: number) => req<void>(`/workspace/watchlists/${id}`, { method: "DELETE" }),
  // collaboration
  wsShares: (matterId: number) => req<WsShare[]>(`/workspace/matters/${matterId}/shares`),
  wsAddShare: (matterId: number, email: string) =>
    req<WsShare>(`/workspace/matters/${matterId}/shares`, { method: "POST", body: JSON.stringify({ email }) }),
  wsRemoveShare: (shareId: number) => req<void>(`/workspace/shares/${shareId}`, { method: "DELETE" }),
  // reconciliation
  wsReconcile: (rows_a: { key: string; name?: string; amount: number }[], rows_b: { key: string; name?: string; amount: number }[], tolerance?: number) =>
    req<WsReconResult>("/workspace/reconcile", { method: "POST", body: JSON.stringify({ rows_a, rows_b, tolerance }) }),
  wsSftAnalyze: (rows: { pan?: string; name?: string; category?: string; amount: number }[]) =>
    req<WsSftResult>("/workspace/sft-analyze", { method: "POST", body: JSON.stringify({ rows }) }),
  wsSftThresholds: () => req<WsSftThreshold[]>("/workspace/sft-thresholds"),
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
  rulings: (q: string) => req<{
    grounded: boolean;
    results: Array<{
      breadcrumb: string;
      snippet: string;
      source_url: string | null;
      score: number;
      chunk_id: number;
      digest?: string | null;
      sections_cited?: string[] | null;
    }>;
    meta?: Record<string, unknown>;
    ecourts: {
      items: Array<{
        cnr: string | null;
        title: string;
        digest: string | null;
        source_url: string | null;
        decision_date: string | null;
        court: string | null;
        sections_cited: string[];
        status?: string;
      }>;
      total: number;
    };
  }>(`/rulings?q=${encodeURIComponent(q)}`),
  // section hub (#11): statute + circulars + leading cases (with headnotes) for a section
  crossref: (section: string) => req<any>(`/crossref?section=${encodeURIComponent(section)}`),
  // ITAT bench list (Delhi / Mumbai / Pune / …) — feeds the Browse-tab dropdown.
  rulingsBenches: () => req<{ benches: string[] }>("/rulings/benches"),
  // Headline numbers for the four boxes above the Case Law search bar.
  // `source` says whether the numbers came from live eCourts data or the
  // local ingested corpus fallback; `corpus` always exposes the fallback
  // in case the UI wants to show a "of which N in your corpus" line.
  rulingsStats: () => req<{
    judgments: number;
    appeals: number;
    benches: number;
    coverage_min_year: number | null;
    coverage_max_year: number | null;
    coverage_label: string;
    source: "ecourts" | "corpus";
    corpus: {
      judgments: number;
      appeals: number;
      benches: number;
      coverage_min_year: number | null;
      coverage_max_year: number | null;
    };
  }>("/rulings/stats"),
  // Trending research topics — real citation frequency when available, else
  // a curated weekly-rotating fallback so the list looks fresh.
  rulingsPopularTopics: (limit = 12) => req<{
    items: {
      topic: string;
      section: string | null;
      q: string;
      count?: number;
      source: "corpus" | "curated";
    }[];
    source: string;
    week?: number;
  }>(`/rulings/popular-topics?limit=${limit}`),
  // Dates on which judgments were pronounced, newest first, with counts.
  rulingsRecentDates: (limit = 11) => req<{
    source: "published_date" | "fetched_at" | "none";
    items: { date: string | null; count: number }[];
  }>(`/rulings/recent-dates?limit=${limit}`),
  // Latest N judgments — pulled from eCourts India when the integration is
  // wired up, else from the local ingested corpus. `source` says which.
  rulingsRecent: (limit = 6) => req<{
    items: {
      id: number | string;
      title: string | null;
      digest: string | null;
      source_url: string | null;
      sections_cited: string[];
      published_date: string | null;
      status?: string;
    }[];
    source: "ecourts" | "corpus";
  }>(`/rulings/recent?limit=${limit}`),

  // --- news feed (Google Alerts + Google News + PIB / CBDT) ---
  news: (opts: {
    q?: string;
    category?: string;
    sort?: "latest" | "trending";
    limit?: number;
    offset?: number;
    sinceDays?: number;     // 1 = today only, 7 = last week, 30 = last month
    fromDate?: string;      // YYYY-MM-DD (overrides sinceDays)
    toDate?: string;        // YYYY-MM-DD
  } = {}) => {
    const params = new URLSearchParams();
    if (opts.q) params.set("q", opts.q);
    if (opts.category) params.set("category", opts.category);
    if (opts.sort) params.set("sort", opts.sort);
    if (opts.limit) params.set("limit", String(opts.limit));
    if (opts.offset) params.set("offset", String(opts.offset));
    if (opts.sinceDays) params.set("since_days", String(opts.sinceDays));
    if (opts.fromDate) params.set("from_date", opts.fromDate);
    if (opts.toDate) params.set("to_date", opts.toDate);
    const qs = params.toString();
    return req<{
      items: {
        id: number;
        title: string;
        url: string;
        snippet: string | null;
        source_name: string;
        source_category: string | null;
        image_url: string | null;
        published_at: string;
        first_seen_at: string;
      }[];
      total: number;
      latest_first_seen_at: string | null;
    }>(`/news${qs ? "?" + qs : ""}`);
  },
  newsCategories: () => req<{
    categories: { name: string; count: number }[];
  }>("/news/categories"),
  newsRefresh: () => req<{
    sources: number; inserted: number; failed: number;
  }>("/news/refresh", { method: "POST" }),
  // Unauthenticated snapshot for the landing page — the newest 6 items,
  // capped at 20 server-side so it can't be scraped as a free news API.
  publicNews: (limit = 6) => req<{
    items: {
      id: number;
      title: string;
      url: string;
      snippet: string | null;
      source_name: string;
      source_category: string | null;
      image_url: string | null;
      published_at: string;
      first_seen_at: string;
    }[];
    total: number;
    latest_first_seen_at: string | null;
  }>(`/news/public?limit=${limit}`),

  // --- eCourts India integration (live court-tracking API) ---
  // Independent of the IndianKanoon-backed /rulings search — additive only.
  ecourtsStatus: () => req<{ enabled: boolean; base_url: string | null }>("/rulings/ecourts/status"),
  ecourtsStates: () => req<{ items: { state: string; stateName: string }[] }>("/rulings/ecourts/states"),
  ecourtsDistricts: (state: string) => req<{
    items: { districtCode: string; districtName: string }[];
  }>(`/rulings/ecourts/states/${encodeURIComponent(state)}/districts`),
  ecourtsEnums: () => req<{ enums: Record<string, { code: string; description: string }[]> }>(
    "/rulings/ecourts/enums",
  ),
  ecourtsCase: (cnr: string) => req<any>(`/rulings/ecourts/case/${encodeURIComponent(cnr)}`),
  // Web-search fallback for the case-detail dialog. Fires when the eCourts
  // partner API returns no structured data — Gemini + Google Search
  // grounding returns a summary with reputable-source citations.
  rulingsWebsearch: (q: string) => req<{
    text: string;
    sources: { title: string; url: string }[];
  }>(`/rulings/websearch?q=${encodeURIComponent(q)}`),
  ecourtsSearch: (opts: {
    state?: string;
    district_code?: string;
    court_level?: "SC" | "HC" | "DC" | "TRIBUNAL";
    court_code?: string;
    case_type?: string;
    case_status?: string;
    judge_name?: string;
    party_name?: string;
    date_from?: string;   // YYYY-MM-DD (decisionDate lower bound)
    date_to?: string;     // YYYY-MM-DD (decisionDate upper bound)
    filing_year?: number;
    decision_year?: number;
    has_judgments?: boolean;
    has_orders?: boolean;
    sort?: string;
    order?: "asc" | "desc";
    page?: number;
    limit?: number;
  } = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(opts)) {
      if (v === undefined || v === null || v === "") continue;
      qs.set(k, String(v));
    }
    return req<{
      items: Array<{
        cnr: string;
        caseType: string;
        caseStatus: string;
        courtName: string | null;
        courtCode: string;
        stateCode: string | null;
        districtCode: string | null;
        filingDate: string | null;
        decisionDate: string | null;
        petitioners: string[];
        respondents: string[];
        judges: string[];
        hasJudgments: boolean;
        hasOrders: boolean;
        judgmentCount: number;
        orderCount: number;
        aiKeywords: string[];
      }>;
      page: number;
      limit: number;
      total: number;
      total_pages?: number;
      facets?: Record<string, unknown>;
    }>(`/rulings/ecourts/search?${qs.toString()}`);
  },
  // Filtered browse of the case-law corpus. Any filter can be null/omitted.
  rulingsBrowse: (opts: {
    bench?: string | null;
    judge?: string | null;
    date_from?: string | null;   // YYYY-MM-DD
    date_to?: string | null;     // YYYY-MM-DD
    page?: number;
    per_page?: number;
  } = {}) => {
    const qs = new URLSearchParams();
    if (opts.bench && opts.bench !== "All") qs.set("bench", opts.bench);
    if (opts.judge) qs.set("judge", opts.judge);
    if (opts.date_from) qs.set("date_from", opts.date_from);
    if (opts.date_to) qs.set("date_to", opts.date_to);
    qs.set("page", String(opts.page ?? 1));
    qs.set("per_page", String(opts.per_page ?? 20));
    return req<{
      items: {
        id: number;
        title: string | null;
        digest: string | null;
        source_url: string | null;
        sections_cited: string[];
        published_date: string | null;
      }[];
      page: number;
      per_page: number;
      total: number;
      total_pages: number;
      filters: Record<string, string | null>;
    }>(`/rulings/browse?${qs.toString()}`);
  },

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
  //
  // Two mutually-exclusive modes on the backend:
  //   * default — rolling window of `days` days
  //   * month view — pass { year, month } to get the whole calendar month
  adminTokenUsage: (opts: { days?: number; year?: number; month?: number } = {}) => {
    const p = new URLSearchParams();
    if (opts.year != null && opts.month != null) {
      p.set("year", String(opts.year));
      p.set("month", String(opts.month));
    } else {
      p.set("days", String(opts.days ?? 30));
    }
    return req<AdminTokenUsage>(`/admin/token-usage?${p.toString()}`);
  },
  // ---- billing (admin + user) ----
  adminBillingPlans: () => req<SubscriptionPlan[]>("/admin/billing/plans"),
  adminBillingCreatePlan: (body: Partial<SubscriptionPlan>) =>
    req<SubscriptionPlan>("/admin/billing/plans", { method: "POST", body: JSON.stringify(body) }),
  adminBillingPatchPlan: (id: number, body: Partial<SubscriptionPlan>) =>
    req<SubscriptionPlan>(`/admin/billing/plans/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  adminBillingDeletePlan: (id: number, force?: boolean) =>
    req<void>(`/admin/billing/plans/${id}${force ? "?force=true" : ""}`, { method: "DELETE" }),
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

  adminGemini: (opts: { days?: number; year?: number; month?: number } | number = {}) => {
    // Back-compat: an older signature took just `days`.
    const o = typeof opts === "number" ? { days: opts } : opts;
    const p = new URLSearchParams();
    if (o.year != null && o.month != null) {
      p.set("year", String(o.year));
      p.set("month", String(o.month));
    } else {
      p.set("days", String(o.days ?? 30));
    }
    return req<AdminGeminiStats>(`/admin/gemini?${p.toString()}`);
  },
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
  async appealDownload(path: string, filename: string): Promise<SaveResult> {
    const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token()}` } });
    if (!res.ok) throw new ApiError(res.status, "Download failed");
    // Save straight to the officer's own machine (Chromium) or download (else).
    return saveBlob(await res.blob(), filename);
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

  // --- assessment-order drafting (AO side) ---
  asmtCases: () => req<any[]>("/assessment/cases"),
  asmtCreateCase: (b: any) => req<any>("/assessment/cases", { method: "POST", body: JSON.stringify(b) }),
  asmtCase: (id: string | number) => req<any>(`/assessment/cases/${id}`),
  asmtUpload: (id: string | number, files: FileList) => {
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append("files", f));
    return req<any>(`/assessment/cases/${id}/documents`, { method: "POST", body: fd });
  },
  asmtUpdateDocCategory: (cid: string | number, did: number, category: string) =>
    req<any>(`/assessment/cases/${cid}/documents/${did}`, {
      method: "PUT", body: JSON.stringify({ category }),
    }),
  asmtRun: (id: string | number) => req<any>(`/assessment/cases/${id}/run`, { method: "POST" }),
  asmtRunStatus: (rid: number) => req<any>(`/assessment/runs/${rid}`),
  asmtStopCase: (id: string | number) => req<any>(`/assessment/cases/${id}/stop`, { method: "POST" }),
  asmtCancelRun: (rid: number) => req<any>(`/assessment/runs/${rid}/cancel`, { method: "POST" }),
  asmtPatchCase: (
    id: string | number,
    b: { title?: string; assessment_year?: string | null; pan?: string | null; section?: string | null },
  ) => req<any>(`/assessment/cases/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  asmtDeleteCase: (id: string | number) => req<void>(`/assessment/cases/${id}`, { method: "DELETE" }),
  asmtDeleteDoc: (cid: string | number, did: number) =>
    req<any>(`/assessment/cases/${cid}/documents/${did}`, { method: "DELETE" }),
  asmtLatest: (id: string | number) => req<any>(`/assessment/cases/${id}/latest`),
  asmtEditOutput: (oid: number, content: string) =>
    req<any>(`/assessment/outputs/${oid}`, { method: "PUT", body: JSON.stringify({ content }) }),
  asmtRegenerate: (id: string | number, seq: number) =>
    req<any>(`/assessment/cases/${id}/issues/${seq}/regenerate`, { method: "POST" }),
  asmtReassemble: (id: string | number) =>
    req<any>(`/assessment/cases/${id}/reassemble`, { method: "POST" }),
  async asmtDownload(path: string, filename: string): Promise<SaveResult> {
    const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token()}` } });
    if (!res.ok) throw new ApiError(res.status, "Download failed");
    return saveBlob(await res.blob(), filename);
  },
  async asmtOpenDoc(cid: string | number, did: number) {
    const res = await fetch(`${BASE}/assessment/cases/${cid}/documents/${did}/file`, { headers: { Authorization: `Bearer ${token()}` } });
    if (!res.ok) throw new ApiError(res.status, "Open failed");
    window.open(URL.createObjectURL(await res.blob()), "_blank");
  },
  asmtCassReasons: () => req<{ key: string; label: string }[]>("/assessment/cass-reasons"),
  asmtCassQuestionnaire: (b: { selection_reasons: string; assessee?: string | null; pan?: string | null; assessment_year?: string | null }) =>
    req<{ content: string }>("/assessment/cass-questionnaire", { method: "POST", body: JSON.stringify(b) }),

  // ----- Public releases catalogue (landing page) -----
  publicReleases: () => req<PublicReleaseCatalogue>("/desktop/releases"),

  // ----- Desktop release management (admin) -----
  adminListReleases: () => req<DesktopRelease[]>("/admin/desktop-releases"),
  async adminCreateRelease(input: {
    version: string;
    channel?: string;
    notes?: string;
    publish?: boolean;
    installer: File;
    portable?: File | null;
    blockmap?: File | null;
  }): Promise<DesktopRelease> {
    const fd = new FormData();
    fd.append("version", input.version);
    if (input.channel) fd.append("channel", input.channel);
    if (input.notes) fd.append("notes", input.notes);
    fd.append("publish", input.publish === false ? "false" : "true");
    fd.append("installer", input.installer);
    if (input.portable) fd.append("portable", input.portable);
    if (input.blockmap) fd.append("blockmap", input.blockmap);
    return req<DesktopRelease>("/admin/desktop-releases", { method: "POST", body: fd });
  },
  adminPatchRelease: (id: number, body: { notes?: string | null; channel?: string | null }) =>
    req<DesktopRelease>(`/admin/desktop-releases/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  adminPublishRelease: (id: number) =>
    req<DesktopRelease>(`/admin/desktop-releases/${id}/publish`, { method: "POST" }),
  adminDeleteRelease: (id: number) =>
    req<void>(`/admin/desktop-releases/${id}`, { method: "DELETE" }),

  // ----- Password reset (public) -----
  passwordResetRequest: (email: string) =>
    req<{ ok: boolean; message: string }>("/auth/password-reset/request", {
      method: "POST", body: JSON.stringify({ email }),
    }),
  passwordResetConfirm: (token: string, new_password: string) =>
    req<{ ok: boolean; email: string; username: string }>("/auth/password-reset/confirm", {
      method: "POST", body: JSON.stringify({ token, new_password }),
    }),

  // ----- Admin support -----
  adminSupportListTickets: (status?: "open" | "closed") =>
    req<AdminSupportTicket[]>("/admin/support/tickets" + (status ? `?status=${status}` : "")),
  adminSupportGetTicket: (id: number) =>
    req<AdminSupportTicket & { messages: SupportMessage[] }>(`/admin/support/tickets/${id}`),
  adminSupportAddMessage: (id: number, body: string, files?: File[]) => {
    // The backend accepts multipart on this endpoint (for optional file
    // attachments), so we send FormData -- Form(...) fields reject JSON.
    const fd = new FormData();
    fd.append("body", body);
    (files || []).forEach((f) => fd.append("files", f, f.name));
    return req<SupportMessage>(`/admin/support/tickets/${id}/messages`, {
      method: "POST", body: fd,
    });
  },
  // Stream an attachment through the authenticated download endpoint and
  // return a Blob URL that an <img>/<video> tag can render.
  adminSupportAttachmentBlobUrl: async (attId: number, mime: string): Promise<string> => {
    // Use the shared BASE resolver so tunnel origins route through the
    // Vite proxy the same way normal /support/* fetches do.
    const tok = localStorage.getItem("bharathtax_token");
    const res = await fetch(`${BASE}/support/attachments/${attId}`, {
      headers: tok ? { Authorization: `Bearer ${tok}` } : {},
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    return URL.createObjectURL(new Blob([buf], { type: mime || "application/octet-stream" }));
  },
  adminSupportPatchTicket: (id: number, status: "open" | "closed") =>
    req<AdminSupportTicket>(`/admin/support/tickets/${id}`, {
      method: "PATCH", body: JSON.stringify({ status }),
    }),
  adminSupportUnread: () => req<{ unread: number }>("/admin/support/unread-count"),

  // ----- Admin desktop sessions -----
  adminDesktopSessions: (opts?: { user_id?: number; limit?: number }) => {
    const q = new URLSearchParams();
    if (opts?.user_id) q.set("user_id", String(opts.user_id));
    if (opts?.limit) q.set("limit", String(opts.limit));
    const s = q.toString();
    return req<{ sessions: DesktopSessionRow[] }>("/admin/desktop-sessions" + (s ? "?" + s : ""));
  },
  adminDesktopSessionsSummary: () =>
    req<{ users: DesktopUserRollup[] }>("/admin/desktop-sessions/summary"),
};

export interface SupportAttachment {
  id: number;
  filename: string;
  mime_type: string;
  size_bytes: number;
  download_url: string;
}
export interface SupportMessage {
  id: number;
  sender_role: string;
  sender_user_id: number | null;
  body: string;
  created_at: string | null;
  attachments?: SupportAttachment[];
}
export interface AdminSupportTicket {
  id: number;
  officer_user_id: number;
  subject: string;
  status: string;
  client_version: string | null;
  last_message_at: string | null;
  created_at: string | null;
  unread: number;
  officer?: { id: number; username: string | null; full_name: string | null; email: string | null } | null;
}
export interface DesktopSessionRow {
  id: number; user_id: number | null;
  username: string | null; full_name: string | null; email: string | null;
  client_version: string | null; ip_address: string | null;
  started_at: string | null; ended_at: string | null;
  duration_seconds: number | null; still_open: boolean;
  last_action: string | null; last_action_at: string | null;
  action_count: number;
}
export interface DesktopUserRollup {
  user_id: number; username: string | null; full_name: string | null; email: string | null; role: string | null;
  sessions: number; seconds: number; actions: number;
  last_started_at: string | null; last_ended_at: string | null;
  open_sessions: number; last_action: string | null; last_action_at: string | null;
}
