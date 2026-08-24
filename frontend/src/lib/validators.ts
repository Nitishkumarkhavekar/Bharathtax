// Shared input validators for Indian tax identifiers and common fields.
// Keep the regexes strict but forgiving of surrounding whitespace/case — the
// UI normalises (uppercases PAN/TAN, trims) before validating.

export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;                 // ABCDE1234E
export const TAN_RE = /^[A-Z]{4}[0-9]{5}[A-Z]$/;                 // BLRA12345C
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/; // 15 chars
export const AY_RE = /^20\d{2}-\d{2}$/;                          // 2023-24
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MOBILE_RE = /^[6-9]\d{9}$/;                         // Indian 10-digit
export const PIN_RE = /^[1-9]\d{5}$/;                            // 6-digit PIN code

const up = (v: string) => (v || "").trim().toUpperCase();

export const isPan = (v: string) => PAN_RE.test(up(v));
export const isTan = (v: string) => TAN_RE.test(up(v));
export const isGstin = (v: string) => GSTIN_RE.test(up(v));
export const isEmail = (v: string) => EMAIL_RE.test((v || "").trim());
export const isMobile = (v: string) => MOBILE_RE.test((v || "").replace(/\s|-/g, ""));
export const isPin = (v: string) => PIN_RE.test((v || "").trim());

/** AY must be "20YY-YY" with the second year one more than the first. */
export function isAy(v: string): boolean {
  const s = (v || "").trim();
  if (!AY_RE.test(s)) return false;
  const [y1, y2] = s.split("-");
  const next = (parseInt(y1, 10) + 1) % 100;
  return y2 === String(next).padStart(2, "0");
}

// --- input formatters (call on change to keep the field clean) ---
export const formatPan = (v: string) => up(v).replace(/[^A-Z0-9]/g, "").slice(0, 10);
export const formatTan = formatPan;
export const formatMobile = (v: string) => (v || "").replace(/\D/g, "").slice(0, 10);

/** Auto-format an AY as the user types: "202324" → "2023-24", clamps length. */
export function formatAy(v: string): string {
  const d = (v || "").replace(/[^\d]/g, "").slice(0, 6);
  if (d.length <= 4) return d;
  return `${d.slice(0, 4)}-${d.slice(4)}`;
}

/** Validate a value only when non-empty (for optional fields). Returns an
 *  error string or "" when valid/empty. */
export function optional(value: string, test: (v: string) => boolean, msg: string): string {
  const s = (value || "").trim();
  if (!s) return "";
  return test(s) ? "" : msg;
}
