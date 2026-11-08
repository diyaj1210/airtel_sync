/**
 * Partner / sales referral (back-office attribution, step 7). A partner's link or QR opens the app
 * as /?ref=PTR-01; the code is checked with the backend, shown on Home, and sent with the advisor
 * chat, the accepted quote and the KYC case so the partner is credited even if the owner finishes
 * on their own. Remembered on this device only (a convenience; the backend keeps the credit).
 */

export interface Referral {
  code: string;
  name: string;
  role: "partner" | "sales";
}

const STORAGE_KEY = "udyam.ref";
const CODE_RE = /^(PTR|SLS)-\d{2}$/;

let current: Referral | null = null;

/** The code to send with the chat, the quote and the KYC case, or null. */
export const referralCode = (): string | null => current?.code ?? null;

export function setReferral(referral: Referral | null): void {
  current = referral;
  try {
    if (referral) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(referral));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked: the referral still applies until the page is closed.
  }
}

export function cleanReferralCode(raw: string | null | undefined): string | null {
  const code = (raw ?? "").trim().toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

/** The code in the page address (?ref=...), else the one remembered on this device. */
export function pendingReferralCode(search: string): string | null {
  const fromUrl = cleanReferralCode(new URLSearchParams(search).get("ref"));
  if (fromUrl) return fromUrl;
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as { code?: unknown } | null;
    return cleanReferralCode(typeof saved?.code === "string" ? saved.code : null);
  } catch {
    return null;
  }
}

/** Ask the backend whose code it is; null when it is not a partner or sales code (or offline). */
export async function checkReferral(code: string, fetchFn: typeof fetch = fetch): Promise<Referral | null> {
  try {
    const res = await fetchFn(`/api/partners/${encodeURIComponent(code)}`, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<Referral>;
    return typeof body.code === "string" && typeof body.name === "string" && (body.role === "partner" || body.role === "sales")
      ? { code: body.code, name: body.name, role: body.role }
      : null;
  } catch {
    return null;
  }
}

/** Adds { attributionCode } to a request body when the owner was referred. */
export const withReferral = <T extends object>(body: T): T & { attributionCode?: string } => {
  const code = referralCode();
  return code ? { ...body, attributionCode: code } : body;
};
