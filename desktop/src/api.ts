// Thin fetch wrapper that talks to the BharatTax server. Gemini calls, license
// validation and token accounting all happen on the server — this file never
// sees an API key. Every 401 / 402 / 403 flips a global state flag so the UI
// can drop the user onto the "session expired" / "token completed" screen.

let cachedServerUrl: string | null = null;
let cachedJwt: string | null = null;

// Broadcast channel — App.tsx subscribes and paints the appropriate lockout
// screen. Kept dead simple (no external state library) because the whole app
// has ~5 screens.
type SessionState =
  | { kind: "ok" }
  | { kind: "expired"; reason: "unauthorised" | "quota" | "license" | "network"; message: string };

type Listener = (s: SessionState) => void;
const listeners = new Set<Listener>();
let currentState: SessionState = { kind: "ok" };

export function subscribeSession(fn: Listener): () => void {
  listeners.add(fn);
  fn(currentState);
  return () => {
    listeners.delete(fn);
  };
}

function pushSession(s: SessionState): void {
  currentState = s;
  for (const l of listeners) l(s);
}

export function resetSessionState(): void {
  pushSession({ kind: "ok" });
}

// Called by the shell poller when the backend says the session must end
// (license deactivated / account disabled). Wipes the token and drops the UI
// into the "session expired" locked screen with an admin-supplied message.
export async function forceLogoutWithReason(
  reason: "unauthorised" | "quota" | "license",
  message: string,
): Promise<void> {
  await clearSession();
  pushSession({ kind: "expired", reason, message });
}

async function loadConfig(): Promise<void> {
  const c = await window.bharat.config.get();
  cachedServerUrl = c.serverUrl;
  cachedJwt = c.jwt;
}

export async function setJwt(jwt: string | null, expiresAt: string | null): Promise<void> {
  cachedJwt = jwt;
  await window.bharat.config.set({ jwt, jwtExpiresAt: expiresAt });
}

export async function setServerUrl(url: string): Promise<void> {
  const c = await window.bharat.config.set({ serverUrl: url });
  cachedServerUrl = c.serverUrl;
}

export async function getServerUrl(): Promise<string> {
  if (cachedServerUrl == null) await loadConfig();
  return cachedServerUrl!;
}

export async function clearSession(): Promise<void> {
  cachedJwt = null;
  await window.bharat.config.clearSession();
}

// --- core request ---------------------------------------------------------
interface RequestOpts {
  method?: string;
  body?: BodyInit | null;
  headers?: Record<string, string>;
  // When true, a 401/403 does NOT flip the session-expired banner — used for
  // "am I still valid?" polling so the check itself doesn't cause a lockout.
  silent?: boolean;
}

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  if (cachedServerUrl == null || cachedJwt == null) await loadConfig();
  const url = `${cachedServerUrl}${path}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(opts.headers || {}),
  };
  if (cachedJwt) headers.Authorization = `Bearer ${cachedJwt}`;
  if (!headers["Content-Type"] && opts.body && !(opts.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method || "GET",
      headers,
      body: opts.body ?? null,
    });
  } catch (e: any) {
    if (!opts.silent) {
      pushSession({
        kind: "expired",
        reason: "network",
        message:
          "Cannot reach the BharatTax server. Check your internet connection " +
          "or ask your administrator to verify the server URL in Settings.",
      });
    }
    throw new Error(`Network error: ${e?.message || e}`);
  }

  if (res.status === 401) {
    if (!opts.silent) {
      await clearSession();
      pushSession({
        kind: "expired",
        reason: "unauthorised",
        message:
          "Your session has expired. Please sign in again to continue.",
      });
    }
    throw new ApiError(401, "Session expired");
  }
  if (res.status === 402) {
    // /appeal/run uses a quota-guard dependency; 402 means the token budget
    // for this user / wing is exhausted. This is the "token completed"
    // state the user asked for.
    if (!opts.silent) {
      pushSession({
        kind: "expired",
        reason: "quota",
        message:
          "Your token quota is exhausted. Please contact your administrator " +
          "to allocate more tokens or renew your license.",
      });
    }
    throw new ApiError(402, "Token quota exhausted");
  }
  if (res.status === 403) {
    // Could be either "license expired" or a generic authorisation refusal.
    // The server sends a hint in `detail`; if it mentions license/expired,
    // treat as license-expired. Otherwise show the generic quota screen.
    let msg = "Access denied.";
    try {
      const j = await res.clone().json();
      if (typeof j?.detail === "string") msg = j.detail;
    } catch {
      /* body may not be JSON */
    }
    const lower = msg.toLowerCase();
    if (!opts.silent && (lower.includes("expired") || lower.includes("license"))) {
      pushSession({
        kind: "expired",
        reason: "license",
        message:
          "Your license has expired or is no longer valid. Please contact " +
          "your administrator to renew it.",
      });
    }
    throw new ApiError(403, msg);
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j?.detail) detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
  }

  // 204 / 205 mean "success, no body". FastAPI's DELETE endpoints often
  // return 204 while still advertising Content-Type: application/json — if
  // we blindly call res.json() on an empty body we'd throw "Unexpected end
  // of JSON input" and the caller would see it as a delete failure.
  if (res.status === 204 || res.status === 205) return undefined as unknown as T;
  const ct = res.headers.get("Content-Type") || "";
  if (!ct.includes("application/json")) return undefined as unknown as T;
  // Some proxies strip the body but keep the JSON content-type; guard here
  // too so a "content-length: 0" JSON response doesn't blow up.
  const text = await res.text();
  if (!text) return undefined as unknown as T;
  return JSON.parse(text) as T;
}

export async function requestBlob(path: string): Promise<ArrayBuffer> {
  if (cachedServerUrl == null || cachedJwt == null) await loadConfig();
  const headers: Record<string, string> = {};
  if (cachedJwt) headers.Authorization = `Bearer ${cachedJwt}`;
  const res = await fetch(`${cachedServerUrl}${path}`, { headers });
  if (res.status === 401 || res.status === 403 || res.status === 402) {
    // Route through the shared handler so the banner flips consistently.
    await request(path); // will throw
  }
  if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}`);
  return await res.arrayBuffer();
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// --- typed endpoints ------------------------------------------------------
export interface LoginResponse {
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

export interface AppealCase {
  id: number;
  slug: string;
  title: string;
  assessment_year: string | null;
  pan: string | null;
  section: string | null;
  status: string;
  documents?: AppealDocument[];
  created_at?: string | null;
  updated_at?: string | null;
}

export interface AppealDocument {
  id: number;
  filename: string;
  category: string;
  pages: number;
  size_bytes?: number | null;
}

export interface AppealRun {
  id: number;
  case_id: number;
  status: string;
  progress: number | null;
  provider: string | null;
  model: string | null;
  error: string | null;
}

export interface AppealOutput {
  id: number;
  kind: string;
  seq: number | null;
  label: string | null;
  content: string;
  citations: unknown[];
  edited: boolean;
  version: number;
}

export interface AppealLatest {
  run: AppealRun | null;
  outputs: AppealOutput[];
  findings: AppealOutput[];
}

export interface DraftVersion {
  id: number;
  version: number;
  edited: boolean;
  content: string;
}

export const api = {
  login: (email: string, password: string) =>
    request<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  licenseStatus: (opts?: { silent?: boolean }) =>
    request<LicenseStatus>("/auth/license/status", { silent: opts?.silent }),
  me: (opts?: { silent?: boolean }) =>
    request<{
      id: number;
      username: string;
      role: string;
      email: string | null;
      full_name: string | null;
      organisation: string | null;
      designation: string | null;
      wing_id: number;
    }>("/auth/me", { silent: opts?.silent }),
  // Settings screen: update the officer's profile / change password.
  updateProfile: (b: {
    full_name?: string;
    organisation?: string;
    designation?: string;
    current_password?: string;
    new_password?: string;
  }) =>
    request<{ id: number; username: string; full_name: string | null; organisation: string | null }>(
      "/auth/profile",
      { method: "PUT", body: JSON.stringify(b) },
    ),
  // Revoke every other session so the officer can kick a stolen desktop
  // install without changing their password.
  logoutOthers: () =>
    request<{ ok: boolean; revoked: number }>("/auth/logout-others", { method: "POST" }),
  // Lightweight probe the shell polls to react to admin actions -- license
  // deactivation kicks the user out immediately; quota / expired-license
  // return state="blocked" and the user stays signed in.
  sessionStatus: (opts?: { silent?: boolean }) =>
    request<{ state: "ok" | "logout" | "blocked"; reason: string; message: string | null }>(
      "/auth/session/status",
      { silent: opts?.silent },
    ),

  createCase: (b: {
    title: string;
    assessment_year?: string | null;
    pan?: string | null;
    section?: string | null;
  }) =>
    request<AppealCase>("/appeal/cases", {
      method: "POST",
      body: JSON.stringify(b),
    }),

  listCases: () => request<AppealCase[]>("/appeal/cases"),

  getCase: (slug: string) => request<AppealCase>(`/appeal/cases/${slug}`),

  patchCase: (
    slug: string,
    b: { title?: string; assessment_year?: string | null; pan?: string | null; section?: string | null },
  ) =>
    request<AppealCase>(`/appeal/cases/${slug}`, {
      method: "PATCH",
      body: JSON.stringify(b),
    }),

  deleteCase: (slug: string) =>
    request<void>(`/appeal/cases/${slug}`, { method: "DELETE" }),

  uploadDocuments: (slug: string, files: Array<{ name: string; bytes: ArrayBuffer }>) => {
    const fd = new FormData();
    for (const f of files) {
      fd.append("files", new Blob([f.bytes]), f.name);
    }
    return request<{ documents: AppealDocument[]; missing: string[]; skipped: string[] }>(
      `/appeal/cases/${slug}/documents`,
      { method: "POST", body: fd },
    );
  },

  updateDocCategory: (slug: string, did: number, category: string) =>
    request<AppealDocument>(`/appeal/cases/${slug}/documents/${did}`, {
      method: "PUT",
      body: JSON.stringify({ category }),
    }),

  deleteDoc: (slug: string, did: number) =>
    request<{ deleted_id: number; filename: string }>(
      `/appeal/cases/${slug}/documents/${did}`,
      { method: "DELETE" },
    ),

  downloadDoc: (slug: string, did: number) =>
    requestBlob(`/appeal/cases/${slug}/documents/${did}/file`),

  startRun: (slug: string) =>
    request<AppealRun>(`/appeal/cases/${slug}/run`, { method: "POST" }),

  stopCase: (slug: string) =>
    request<{ status: string }>(`/appeal/cases/${slug}/stop`, { method: "POST" }),

  latest: (slug: string) => request<AppealLatest>(`/appeal/cases/${slug}/latest`),

  reassemble: (slug: string) =>
    request<AppealOutput>(`/appeal/cases/${slug}/reassemble`, { method: "POST" }),

  instructDraft: (
    slug: string,
    instruction: string,
    opts?: { selection?: string | null; base_version?: number | null },
  ) =>
    request<{
      id: number; version: number; edited: boolean;
      instruction: string; scope?: string; chars: number;
      content?: string;
      change_start?: number | null; change_end?: number | null;
    }>(`/appeal/cases/${slug}/draft/instruct`, {
      method: "POST",
      body: JSON.stringify({
        instruction,
        selection: opts?.selection ?? null,
        base_version: opts?.base_version ?? null,
      }),
    }),

  draftVersions: (slug: string) =>
    request<DraftVersion[]>(`/appeal/cases/${slug}/draft-versions`),

  exportDocx: (slug: string) => requestBlob(`/appeal/cases/${slug}/export.docx`),

  // Fetch the LibreOffice-rendered PDF preview of the latest draft.  Returns
  // an ArrayBuffer the caller wraps in a Blob + object URL for an <iframe>.
  previewPdf: (slug: string) => requestBlob(`/appeal/cases/${slug}/preview.pdf`),

  uploadEditedDraft: (slug: string, bytes: ArrayBuffer, filename: string) => {
    const fd = new FormData();
    fd.append("docx", new Blob([bytes]), filename);
    return request<{ id: number; version: number; size: number; edited: boolean }>(
      `/appeal/cases/${slug}/draft/upload`,
      { method: "POST", body: fd },
    );
  },

  // ----- Desktop session tracking -----
  sessionStart: (clientVersion: string) =>
    request<{ session_token: string; id: number }>("/desktop/session/start", {
      method: "POST", body: JSON.stringify({ client_version: clientVersion }),
    }),
  sessionHeartbeat: (session_token: string, last_action?: string, action_count_delta = 0) =>
    request<{ ok: boolean }>("/desktop/session/heartbeat", {
      method: "POST", body: JSON.stringify({ session_token, last_action, action_count_delta }),
      silent: true,
    }),
  sessionEnd: (session_token: string) =>
    request<{ ok: boolean }>("/desktop/session/end", {
      method: "POST", body: JSON.stringify({ session_token }), silent: true,
    }),

  // ----- Report Issue (support) -----
  supportListTickets: () =>
    request<SupportTicket[]>("/support/tickets"),
  supportGetTicket: (id: number) =>
    request<SupportTicket & { messages: SupportMessage[] }>(`/support/tickets/${id}`),
  // The support endpoints are multipart because they accept optional file
  // attachments alongside the message body. Even when no files are attached
  // we send FormData -- the backend uses Form(...) fields and rejects JSON.
  supportCreateTicket: (body: {
    subject: string; body: string; client_version?: string; files?: File[];
  }) => {
    const fd = new FormData();
    fd.append("subject", body.subject);
    fd.append("body", body.body);
    if (body.client_version) fd.append("client_version", body.client_version);
    (body.files || []).forEach((f) => fd.append("files", f, f.name));
    return request<SupportTicket & { messages: SupportMessage[] }>("/support/tickets", {
      method: "POST", body: fd,
    });
  },
  supportAddMessage: (ticket_id: number, body: string, files?: File[]) => {
    const fd = new FormData();
    fd.append("body", body);
    (files || []).forEach((f) => fd.append("files", f, f.name));
    return request<SupportMessage>(`/support/tickets/${ticket_id}/messages`, {
      method: "POST", body: fd,
    });
  },
  // Fetches an attachment as a Blob URL so <img>/<video> tags can render it
  // through the auth-protected download endpoint (no R2 credentials leave
  // the server).
  supportAttachmentBlobUrl: async (attId: number, mime: string): Promise<string> => {
    const buf = await requestBlob(`/support/attachments/${attId}`);
    const blob = new Blob([buf], { type: mime || "application/octet-stream" });
    return URL.createObjectURL(blob);
  },
  supportUnreadCount: () =>
    request<{ unread: number }>("/support/unread-count", { silent: true }),

  // ----- Password reset (public) -----
  passwordResetRequest: (email: string) =>
    request<{ ok: boolean; message: string }>("/auth/password-reset/request", {
      method: "POST", body: JSON.stringify({ email }), silent: true,
    }),
};

export interface SupportTicket {
  id: number;
  officer_user_id: number;
  subject: string;
  status: string;
  client_version: string | null;
  last_message_at: string | null;
  created_at: string | null;
  unread: number;
  viewer_role: string;
}
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
