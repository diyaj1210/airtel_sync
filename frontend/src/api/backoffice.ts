/** Types and calls for the staff back-office (backend/src/backoffice). Every call but the account list and sign-in sends the MOCK staff token. */
import type { KycCase } from "./kyc";
import type { Segment } from "./quote";

export type StaffRole = "admin" | "sales" | "partner";
export interface Staff {
  code: string;
  name: string;
  role: StaffRole;
  area: string;
}

export type Band = "high" | "medium" | "low";
export type NextAction = "call_within_24h" | "whatsapp_nudge" | "nurture";
export interface Score {
  score: number;
  band: Band;
  probability: number;
  reasons: { feature: string; value: string; effect: "up" | "down"; weight: number }[];
  nextAction: NextAction;
}

export const FOLLOW_UP_STATUSES = ["new", "contacted", "converted", "lost"] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];
export interface Attribution {
  code: string;
  name: string;
  role: StaffRole;
}

export interface AdvisorLead {
  leadId: string;
  createdOn: string;
  reason: string;
  note: string | null;
  phoneMasked: string | null;
  callbackConsent: boolean;
  lang: "en" | "hi";
  segment: Segment | null;
  business: { type: string | null; employees: number | null; locations: number | null; city: string | null; cityTier: number | null; gstin: string | null; currentInternet: string | null };
  recommendation: { name: string; monthlyInr: number } | null;
  askedAboutUnavailable: string[];
  attribution: Attribution | null;
  followUp: { status: FollowUpStatus; assignedTo: string | null; updatedOn: string | null; updatedBy: string | null };
  score: Score | null;
}

export interface LeadList {
  scoring: "ok" | "unavailable";
  total: number;
  leads: AdvisorLead[];
  facets: Record<"reason" | "segment" | "city" | "attribution" | "band" | "status" | "assignedTo", string[]>;
  assignable: Staff[];
}

export interface CrmLead {
  leadId: string;
  createdOn: string;
  leadSource: string;
  businessName: string;
  businessType: string;
  segment: Segment;
  city: string;
  cityTier: number;
  preferredLanguage: string;
  employees: number;
  sites: number;
  hasGstin: boolean;
  hasUdyam: boolean;
  currentProvider: string;
  contactName: string;
  contactRole: string;
  stageReached: string;
  dropReason: string;
  score: Score | null;
}

export interface CrmList {
  scoring: "ok" | "unavailable";
  source: string;
  total: number;
  page: number;
  pageSize: number;
  pages: number;
  leads: CrmLead[];
  facets: Record<"segment" | "city" | "source" | "reason" | "stage" | "band", string[]>;
}

export type QueueStatus = "needs_review" | "waiting_for_owner" | "approved" | "rejected";
export interface QueueItem {
  caseId: string;
  queueStatus: QueueStatus;
  startedOn: string;
  canDecide: boolean;
  attribution: Attribution | null;
  quote: { quoteId: string; bundle: string; monthlyInr: number } | null;
  orderId: string | null;
  case: KycCase;
}
export interface KycQueue {
  total: number;
  counts: Record<QueueStatus, number>;
  items: QueueItem[];
  facets: { status: QueueStatus[]; attribution: string[] };
}

export interface AttributionRow extends Staff {
  advisorLeads: number;
  quotes: number;
  kycCases: number;
  orders: number;
  ordersMonthlyInr: number;
  orderIds: string[];
}
export interface AttributionSummary {
  partners: AttributionRow[];
  direct?: Omit<AttributionRow, keyof Staff>;
}

export class BackofficeError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

type FetchFn = typeof fetch;

async function send<T>(fetchFn: FetchFn, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, token: string | null, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetchFn(url, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  } catch {
    throw new BackofficeError(0, "network");
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new BackofficeError(res.status, data.error ?? "error");
  return data as T;
}

/** Query string from filters; empty values are left out. */
export function query(filters: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v !== undefined && v !== "") params.set(k, String(v));
  const s = params.toString();
  return s ? `?${s}` : "";
}

export const listAccounts = (fetchFn: FetchFn = fetch) => send<{ mock: true; accounts: Staff[] }>(fetchFn, "GET", "/api/backoffice/accounts", null);
export const signIn = (staffCode: string, fetchFn: FetchFn = fetch) =>
  send<{ token: string; staff: Staff; expiresAt: string }>(fetchFn, "POST", "/api/backoffice/session", null, { staffCode });
export const signOut = (token: string, fetchFn: FetchFn = fetch) => send<{ signedOut: true }>(fetchFn, "DELETE", "/api/backoffice/session", token);

export const listLeads = (token: string, filters: Record<string, string>, fetchFn: FetchFn = fetch) =>
  send<LeadList>(fetchFn, "GET", `/api/backoffice/leads${query(filters)}`, token);
export const updateLead = (token: string, leadId: string, change: { status?: FollowUpStatus; assignedTo?: string | null }, fetchFn: FetchFn = fetch) =>
  send<{ leadId: string; followUp: AdvisorLead["followUp"] }>(fetchFn, "PATCH", `/api/backoffice/leads/${encodeURIComponent(leadId)}`, token, change);
export const listCrmLeads = (token: string, filters: Record<string, string | number>, fetchFn: FetchFn = fetch) =>
  send<CrmList>(fetchFn, "GET", `/api/backoffice/crm-leads${query(filters)}`, token);
export const kycQueue = (token: string, filters: Record<string, string>, fetchFn: FetchFn = fetch) =>
  send<KycQueue>(fetchFn, "GET", `/api/backoffice/kyc${query(filters)}`, token);
export const reviewCase = (token: string, caseId: string, decision: "approved" | "rejected", note: string, fetchFn: FetchFn = fetch) =>
  send<QueueItem>(fetchFn, "POST", `/api/backoffice/kyc/${encodeURIComponent(caseId)}/review`, token, { decision, ...(note.trim() ? { note: note.trim() } : {}) });
export const attribution = (token: string, fetchFn: FetchFn = fetch) => send<AttributionSummary>(fetchFn, "GET", "/api/backoffice/attribution", token);
