/**
 * Masking of personal identifiers for logs (and later the UI).
 * Privacy rule: never log a full GSTIN, Udyam number, ID number, Aadhaar, PAN, phone or email,
 * and never log raw documents. The same rules are implemented in ai-service/app/masking.py.
 */

const stars = (n: number) => "*".repeat(Math.max(n, 0));

/**
 * The one masking format, used in the UI, the API and the logs (privacy feature):
 * GSTIN first 4 + last 3 (27XU********1ZP), Udyam / ID numbers / phones the last 4 only.
 */
export function maskGstin(gstin: string): string {
  return gstin.length === 15 ? gstin.slice(0, 4) + stars(8) + gstin.slice(12) : stars(gstin.length);
}

/** UDYAM-MH-00-9516696 -> UDYAM-**-**-***6696 (the "UDYAM-" prefix and dashes stay). */
export function maskUdyam(udyam: string): string {
  if (udyam.length !== 19) return stars(udyam.length);
  return "UDYAM-" + udyam.slice(6, 15).replace(/[A-Za-z0-9]/g, "*") + udyam.slice(15);
}

/** Any ID or document number: only the last 4 characters stay visible (a known prefix such as "SYN-ID-" too). */
export function maskIdNumber(value: string): string {
  const prefix = /^SYN-ID-/i.exec(value)?.[0] ?? "";
  const rest = value.slice(prefix.length);
  return prefix + (rest.length <= 4 ? stars(rest.length) : stars(rest.length - 4) + rest.slice(-4));
}

/** Phone: last 4 digits. */
export function maskPhone(phone: string): string {
  return stars(phone.length - 4) + phone.slice(-4);
}

interface Rule {
  name: string;
  pattern: RegExp;
  mask: (match: string) => string;
}

// Order matters: longer / more specific identifiers first. Masked output contains '*',
// so it can never be matched again by a later rule.
const RULES: Rule[] = [
  {
    // 15-char GSTIN: 2-digit state + 10-char PAN + entity + 'Z' + checksum.
    // Deliberately loose (any alphanumerics in the PAN part) so invalid or OCR-garbled
    // GSTINs (e.g. a failed-checksum one from a document) are masked too.
    name: "gstin",
    pattern: /\b\d{2}[A-Z0-9]{10}[0-9A-Z]Z[0-9A-Z]\b/gi,
    mask: (m) => maskGstin(m),
  },
  {
    name: "udyam",
    pattern: /\bUDYAM-[A-Z]{2}-\d{2}-\d{7}\b/gi,
    mask: (m) => maskUdyam(m),
  },
  {
    name: "signatory_id",
    pattern: /\bSYN-ID-\d{4,}\b/gi,
    mask: (m) => maskIdNumber(m),
  },
  {
    name: "aadhaar",
    pattern: /(?<![\d*])\d{4}[ -]?\d{4}[ -]?\d{4}(?![\d*])/g,
    mask: (m) => stars(m.length - 4) + m.slice(-4),
  },
  {
    name: "phone",
    pattern: /(?<![\d*])(?:\+91[ -]?)?[6-9]\d{9}(?![\d*])/g,
    mask: (m) => maskPhone(m),
  },
  {
    name: "pan",
    pattern: /\b[A-Z]{5}\d{4}[A-Z]\b/g,
    mask: (m) => m.slice(0, 2) + stars(7) + m.slice(-1),
  },
  {
    name: "email",
    pattern: /\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})\b/g,
    mask: (m) => {
      const at = m.indexOf("@");
      return m[0] + stars(3) + m.slice(at);
    },
  },
];

/** Mask every identifier found in a piece of free text. */
export function maskIdentifiers(text: string): string {
  let out = text;
  for (const rule of RULES) {
    out = out.replace(rule.pattern, rule.mask);
  }
  return out;
}

/** Keys whose values are never logged (documents, images, secrets). Compared case-insensitively. */
export const REDACTED_KEYS = new Set([
  "document",
  "documents",
  "image",
  "images",
  "file",
  "files",
  "filedata",
  "content",
  "base64",
  "raw",
  "rawtext",
  "ocrtext",
  "password",
  "secret",
  "token",
  "apikey",
  "api_key",
  "authorization",
]);

export const MAX_LOGGED_STRING = 2000;
const MAX_DEPTH = 6;

/**
 * Deep-copy a value for logging: mask identifiers in strings, redact sensitive keys,
 * omit very long strings (raw documents / base64) and binary buffers.
 */
export function maskValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    if (value.length > MAX_LOGGED_STRING) return `[OMITTED ${value.length} chars]`;
    return maskIdentifiers(value);
  }
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[DEPTH LIMIT]";
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    return `[OMITTED ${value.byteLength} bytes]`;
  }
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: maskIdentifiers(value.message) };
  }
  if (Array.isArray(value)) return value.map((v) => maskValue(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = REDACTED_KEYS.has(key.toLowerCase()) ? "[REDACTED]" : maskValue(v, depth + 1);
  }
  return out;
}
