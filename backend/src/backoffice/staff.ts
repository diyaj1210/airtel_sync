/**
 * DEMO staff directory for the back-office (MOCK: in a real rollout these come from the staff
 * login system). Every partner and sales person has an attribution code; a customer who starts
 * from their link or QR (`/?ref=PTR-01`) keeps that code on the advisor lead, the quote, the KYC
 * case and the order, so the partner is credited even if the customer finishes on their own.
 *
 * Roles (solution_outline_chat/03-assisted-mode.md):
 *   admin    operations desk: everything, and the only role that sees and decides KYC exceptions
 *            (purpose limitation: KYC data is used for onboarding / compliance only)
 *   sales    field sales: all leads (live and past quarter), assigns and follows them up
 *   partner  channel partner: only the leads and orders attributed to their own code
 */

export const STAFF_ROLES = ["admin", "sales", "partner"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export interface StaffMember {
  code: string;
  name: string;
  role: StaffRole;
  /** Cities this person covers (shown only; the back-office does not restrict by city). */
  area: string;
}

export const STAFF: readonly StaffMember[] = [
  { code: "ADM-01", name: "Operations desk", role: "admin", area: "All cities" },
  { code: "SLS-01", name: "Ananya Rao (field sales)", role: "sales", area: "Tier 1 cities" },
  { code: "SLS-02", name: "Vikram Joshi (field sales)", role: "sales", area: "Tier 2 cities" },
  { code: "PTR-01", name: "Shree Mobile Point", role: "partner", area: "Pune" },
  { code: "PTR-02", name: "City Computers & Telecom", role: "partner", area: "Jaipur" },
];

export const STAFF_CODE_RE = /^(ADM|SLS|PTR)-\d{2}$/;

export function staffByCode(code: unknown): StaffMember | undefined {
  if (typeof code !== "string") return undefined;
  const clean = code.trim().toUpperCase();
  return STAFF_CODE_RE.test(clean) ? STAFF.find((s) => s.code === clean) : undefined;
}

/** A code customers can be referred with: a partner or a sales person (not the operations desk). */
export function attributionStaff(code: unknown): StaffMember | undefined {
  const staff = staffByCode(code);
  return staff && staff.role !== "admin" ? staff : undefined;
}

/**
 * Parse an optional attribution code from a request body.
 * undefined / null / "" -> { ok: true, code: null }; a known partner or sales code -> its code;
 * anything else -> { ok: false } (the app validates the code before sending it).
 */
export function parseAttribution(raw: unknown): { ok: true; code: string | null } | { ok: false } {
  if (raw === undefined || raw === null || raw === "") return { ok: true, code: null };
  const staff = attributionStaff(raw);
  return staff ? { ok: true, code: staff.code } : { ok: false };
}

/** Lead source as in smb_leads.csv, for the propensity model; null = not known (counts as average). */
export function leadSourceFor(code: string | null): "Channel partner" | "Field sales" | null {
  const staff = code ? attributionStaff(code) : undefined;
  return staff?.role === "partner" ? "Channel partner" : staff?.role === "sales" ? "Field sales" : null;
}
