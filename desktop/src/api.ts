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

  const ct = res.headers.get("Content-Type") || "";
  if (ct.includes("application/json")) return (await res.json()) as T;
  // Callers that want binary use `requestBlob` instead — this branch is only
  // hit when a JSON endpoint returns an unexpected shape.
  return undefined as unknown as T;
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
}

export interface AppealDocument {
  id: number;
  filename: string;
  category: string;
  pages: number;
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

export const api = {
  login: (email: string, password: string) =>
    request<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  licenseStatus: (opts?: { silent?: boolean }) =>
    request<LicenseStatus>("/auth/license/status", { silent: opts?.silent }),
  activateLicense: (key: string) =>
    request<LicenseStatus>("/auth/license/activate", {
      method: "POST",
      body: JSON.stringify({ key }),
    }),
  me: (opts?: { silent?: boolean }) =>
    request<{ username: string; role: string; email: string | null }>("/auth/me", {
      silent: opts?.silent,
    }),

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

  startRun: (slug: string) =>
    request<AppealRun>(`/appeal/cases/${slug}/run`, { method: "POST" }),

  latest: (slug: string) => request<AppealLatest>(`/appeal/cases/${slug}/latest`),

  exportDocx: (slug: string) => requestBlob(`/appeal/cases/${slug}/export.docx`),
};
