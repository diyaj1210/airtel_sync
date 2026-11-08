import { Router, type Request } from "express";
import { FOLLOW_UP_STATUSES, leadView, type AdvisorLead, type FollowUpStatus, type LeadStore } from "../advisor/leads.js";
import type { Catalogue } from "../catalogue/catalogue.js";
import type { Registries } from "../kyc/registry.js";
import { evaluateCase, issueKey, MAX_REVIEW_NOTE, REVIEW_DECISIONS, type ReviewDecision } from "../kyc/review.js";
import { CASE_ID_RE, type KycCase, type KycCaseStore } from "../kyc/store.js";
import { caseView } from "../kyc/view.js";
import type { Logger } from "../logger.js";
import { maskIdentifiers } from "../masking.js";
import type { OrderStore } from "../orders/store.js";
import type { PropensityScore } from "../propensity/client.js";
import type { QuoteStore } from "../quote/store.js";
import { requireStaff, staffOf, type StaffSessions } from "./auth.js";
import type { CrmLead } from "./crm.js";
import { NEXT_ACTION, type BackofficeScoring } from "./scoring.js";
import { attributionStaff, STAFF, type StaffMember } from "./staff.js";

/**
 * Back-office for sales, partners and the operations desk (step 7). Every endpoint except the
 * MOCK account list, the sign-in and the public referral check needs a staff sign-in.
 *
 *   GET    /api/partners/:code                     public: name of a partner / sales code (referral banner)
 *   GET    /api/backoffice/accounts                MOCK demo accounts to sign in with
 *   POST   /api/backoffice/session                 { staffCode } -> { token, staff, expiresAt }   (MOCK sign-in)
 *   GET    /api/backoffice/session                 who is signed in
 *   DELETE /api/backoffice/session                 sign out
 *   GET    /api/backoffice/leads                   leads the advisor could not close + reason + score    (all roles; partner: own)
 *   PATCH  /api/backoffice/leads/:leadId           { status?, assignedTo? } follow-up                      (partner: status of own leads)
 *   GET    /api/backoffice/crm-leads               past-quarter dropped leads (smb_leads.csv) + score       (admin, sales)
 *   GET    /api/backoffice/kyc                     KYC exceptions queue                                    (admin)
 *   POST   /api/backoffice/kyc/:caseId/review      { decision: approved | rejected, note? }                (admin)
 *   GET    /api/backoffice/attribution             leads, quotes, KYC cases and orders per partner / sales code (partner: own)
 *
 * Filters are query parameters; each list also returns the values it can be filtered by.
 * Phone numbers and identifiers are masked; the CRM list carries no GSTIN / Udyam numbers.
 */

export interface BackofficeDeps {
  sessions: StaffSessions;
  leadStore: LeadStore;
  quoteStore: QuoteStore;
  kycStore: KycCaseStore;
  orderStore: OrderStore;
  catalogue: Catalogue;
  registries: Registries;
  crmLeads: CrmLead[];
  scoring: BackofficeScoring;
  today: () => string;
  logger: Logger;
}

export const CRM_PAGE_SIZE = 25;

const staffCard = (s: StaffMember) => ({ code: s.code, name: s.name, role: s.role, area: s.area });
const attributionCard = (code: string | null) => {
  const s = code ? attributionStaff(code) : undefined;
  return s ? { code: s.code, name: s.name, role: s.role } : null;
};

/** One query parameter as a string ("" and arrays count as not given). */
function q(req: Request, name: string): string | undefined {
  const v = req.query[name];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

const distinct = <T>(rows: T[], pick: (r: T) => string | null | undefined): string[] =>
  [...new Set(rows.map(pick).filter((v): v is string => typeof v === "string" && v !== ""))].sort((a, b) => a.localeCompare(b));

/** Keep the rows that match every given filter. */
function applyFilters<T>(rows: T[], filters: Record<string, string | undefined>, fields: Record<string, (r: T) => string | null | undefined>): T[] {
  const active = Object.entries(filters).filter((e): e is [string, string] => e[1] !== undefined);
  return rows.filter((r) => active.every(([name, value]) => fields[name]!(r) === value));
}

const byScoreThenNewest = <T extends { score: PropensityScore | null; createdOn: string }>(a: T, b: T) =>
  (b.score?.score ?? -1) - (a.score?.score ?? -1) || b.createdOn.localeCompare(a.createdOn);

const scoreView = (s: PropensityScore | undefined | null) =>
  s ? { score: s.score, band: s.band, probability: s.probability, reasons: s.reasons, nextAction: NEXT_ACTION[s.band] } : null;

export function backofficeRouter(deps: BackofficeDeps): Router {
  const { sessions, leadStore, quoteStore, kycStore, orderStore, catalogue, registries, crmLeads, scoring, today, logger } = deps;
  const router = Router();
  const anyStaff = requireStaff(sessions, ["admin", "sales", "partner"]);
  const salesOrAdmin = requireStaff(sessions, ["admin", "sales"]);
  const adminOnly = requireStaff(sessions, ["admin"]);

  // ---- referral check (public) and MOCK sign-in ----
  router.get("/partners/:code", (req, res) => {
    const s = attributionStaff(req.params.code);
    if (!s) return void res.status(404).json({ error: "unknown_code" });
    res.json({ code: s.code, name: s.name, role: s.role });
  });

  router.get("/backoffice/accounts", (_req, res) => {
    res.json({ mock: true, accounts: STAFF.map(staffCard) });
  });

  router.post("/backoffice/session", (req, res) => {
    const signedIn = sessions.signIn((req.body as Record<string, unknown> | undefined)?.staffCode);
    if (!signedIn) return void res.status(401).json({ error: "unknown_account" });
    logger.info("staff signed in (MOCK)", { staff: signedIn.staff.code, role: signedIn.staff.role });
    res.status(201).json({ mock: true, token: signedIn.token, staff: staffCard(signedIn.staff), expiresAt: new Date(signedIn.expiresMs).toISOString() });
  });

  router.get("/backoffice/session", anyStaff, (_req, res) => {
    res.json({ staff: staffCard(staffOf(res)) });
  });

  router.delete("/backoffice/session", anyStaff, (req, res) => {
    sessions.signOut(req.headers.authorization!.trim().slice("Bearer ".length));
    res.json({ signedOut: true });
  });

  // ---- leads the advisor could not close ----
  const visibleLeads = (staff: StaffMember): AdvisorLead[] =>
    leadStore.list().filter((l) => staff.role !== "partner" || l.attributionCode === staff.code);

  const leadFields: Record<string, (r: ReturnType<typeof leadRow>) => string | null | undefined> = {
    reason: (r) => r.reason,
    segment: (r) => r.segment,
    city: (r) => r.business.city,
    attribution: (r) => r.attribution?.code ?? "none",
    band: (r) => r.score?.band,
    status: (r) => r.followUp.status,
    assignedTo: (r) => r.followUp.assignedTo ?? "none",
  };
  function leadRow(lead: AdvisorLead, score: PropensityScore | undefined | null) {
    return { ...leadView(lead), attribution: attributionCard(lead.attributionCode), score: scoreView(score) };
  }

  router.get("/backoffice/leads", anyStaff, async (req, res) => {
    const leads = visibleLeads(staffOf(res));
    const scores = await scoring.advisorLeads(leads);
    const rows = leads.map((l) => leadRow(l, scores?.get(l.leadId)));
    const filters = Object.fromEntries(Object.keys(leadFields).map((k) => [k, q(req, k)]));
    const shown = applyFilters(rows, filters, leadFields).sort(byScoreThenNewest);
    res.json({
      scoring: scores ? "ok" : "unavailable",
      total: rows.length,
      leads: shown,
      facets: Object.fromEntries(Object.entries(leadFields).map(([k, pick]) => [k, distinct(rows, pick)])),
      assignable: STAFF.filter((s) => s.role !== "admin").map(staffCard),
    });
  });

  router.patch("/backoffice/leads/:leadId", anyStaff, (req, res) => {
    const staff = staffOf(res);
    const lead = leadStore.get(String(req.params.leadId));
    if (!lead || (staff.role === "partner" && lead.attributionCode !== staff.code)) return void res.status(404).json({ error: "lead_not_found" });
    const b = (req.body ?? {}) as Record<string, unknown>;
    const errors: string[] = [];
    const change: { status?: FollowUpStatus; assignedTo?: string | null } = {};
    if (Object.keys(b).some((k) => k !== "status" && k !== "assignedTo")) errors.push("only status and assignedTo can be changed");
    if (b.status !== undefined) {
      if ((FOLLOW_UP_STATUSES as readonly unknown[]).includes(b.status)) change.status = b.status as FollowUpStatus;
      else errors.push(`status must be one of ${FOLLOW_UP_STATUSES.join(", ")}`);
    }
    if (b.assignedTo !== undefined) {
      if (staff.role === "partner") return void res.status(403).json({ error: "not_allowed_for_role" });
      const to = b.assignedTo === null ? null : attributionStaff(b.assignedTo);
      if (to === undefined) errors.push("assignedTo must be a sales or partner code, or null");
      else change.assignedTo = to && to.code;
    }
    if (errors.length === 0 && change.status === undefined && change.assignedTo === undefined) errors.push("nothing to change");
    if (errors.length > 0) return void res.status(400).json({ error: "invalid_request", details: errors });
    const updated = leadStore.setFollowUp(lead.leadId, change, staff.code)!;
    logger.info("lead follow-up updated", { leadId: lead.leadId, by: staff.code, status: updated.followUp.status, assignedTo: updated.followUp.assignedTo });
    res.json({ leadId: updated.leadId, followUp: updated.followUp });
  });

  // ---- past-quarter leads (smb_leads.csv) ----
  const crmFields: Record<string, (r: CrmLead) => string> = {
    segment: (r) => r.segment,
    city: (r) => r.city,
    source: (r) => r.leadSource,
    reason: (r) => r.dropReason,
    stage: (r) => r.stageReached,
  };
  const crmFacets = Object.fromEntries(Object.entries(crmFields).map(([k, pick]) => [k, distinct(crmLeads, pick)]));

  router.get("/backoffice/crm-leads", salesOrAdmin, async (req, res) => {
    const pageRaw = q(req, "page") ?? "1";
    const band = q(req, "band");
    if (!/^[1-9]\d{0,3}$/.test(pageRaw) || (band !== undefined && !(band in NEXT_ACTION))) {
      return void res.status(400).json({ error: "invalid_request", details: ["page must be a whole number from 1; band must be high, medium or low"] });
    }
    const scores = await scoring.crmLeads();
    const filtered = applyFilters(crmLeads, Object.fromEntries(Object.keys(crmFields).map((k) => [k, q(req, k)])), crmFields)
      .map((l) => ({ ...l, score: scoreView(scores?.get(l.leadId)) }))
      .filter((l) => band === undefined || l.score?.band === band)
      .sort(byScoreThenNewest);
    const page = Number(pageRaw);
    res.json({
      scoring: scores ? "ok" : "unavailable",
      source: "smb_leads.csv (Apr-Jun 2026, leads that did not activate)",
      total: filtered.length,
      page,
      pageSize: CRM_PAGE_SIZE,
      pages: Math.max(1, Math.ceil(filtered.length / CRM_PAGE_SIZE)),
      leads: filtered.slice((page - 1) * CRM_PAGE_SIZE, page * CRM_PAGE_SIZE),
      facets: { ...crmFacets, band: ["high", "medium", "low"] },
    });
  });

  // ---- KYC exceptions queue ----
  type QueueStatus = "needs_review" | "waiting_for_owner" | "approved" | "rejected";
  function queueItem(c: KycCase) {
    const evaluation = evaluateCase(c, registries, today());
    const queueStatus: QueueStatus | null =
      evaluation.review?.decision === "approved"
        ? "approved"
        : evaluation.review?.decision === "rejected"
          ? "rejected"
          : c.submitted && evaluation.status === "manual_review"
            ? "needs_review"
            : c.submitted && evaluation.status === "fix_needed"
              ? "waiting_for_owner"
              : null;
    if (!queueStatus) return null;
    const quote = c.quoteId ? quoteStore.get(c.quoteId) : undefined;
    return {
      caseId: c.caseId,
      queueStatus,
      startedOn: c.consent.acceptedOn,
      // A decision can be made, or changed, until the owner has signed.
      canDecide: queueStatus !== "waiting_for_owner" && !c.esign?.signed,
      attribution: attributionCard(c.attributionCode),
      quote: quote ? { quoteId: quote.quoteId, bundle: quote.quote.name, monthlyInr: quote.quote.totals.monthlyInr } : null,
      orderId: orderStore.forCase(c.caseId)?.orderId ?? null,
      case: caseView(c, evaluation, quote, catalogue),
    };
  }
  const QUEUE_ORDER: QueueStatus[] = ["needs_review", "waiting_for_owner", "rejected", "approved"];

  router.get("/backoffice/kyc", adminOnly, (req, res) => {
    const items = kycStore.list().map(queueItem).filter((i) => i !== null);
    const status = q(req, "status");
    const attribution = q(req, "attribution");
    const shown = items
      .filter((i) => (status === undefined || i.queueStatus === status) && (attribution === undefined || (i.attribution?.code ?? "none") === attribution))
      .sort((a, b) => QUEUE_ORDER.indexOf(a.queueStatus) - QUEUE_ORDER.indexOf(b.queueStatus) || a.startedOn.localeCompare(b.startedOn));
    res.json({
      total: items.length,
      counts: Object.fromEntries(QUEUE_ORDER.map((s) => [s, items.filter((i) => i.queueStatus === s).length])),
      items: shown,
      facets: { status: QUEUE_ORDER, attribution: distinct(items, (i) => i.attribution?.code ?? "none") },
    });
  });

  router.post("/backoffice/kyc/:caseId/review", adminOnly, (req, res) => {
    const caseId = String(req.params.caseId);
    const c = CASE_ID_RE.test(caseId) ? kycStore.get(caseId) : undefined;
    if (!c) return void res.status(404).json({ error: "case_not_found" });
    const b = (req.body ?? {}) as Record<string, unknown>;
    const decision = b.decision as ReviewDecision;
    const note = typeof b.note === "string" ? b.note.trim().replace(/\s+/g, " ") : b.note === undefined || b.note === null ? "" : null;
    if (!(REVIEW_DECISIONS as readonly string[]).includes(decision) || note === null || note.length > MAX_REVIEW_NOTE) {
      return void res.status(400).json({ error: "invalid_request", details: [`decision must be approved or rejected; note at most ${MAX_REVIEW_NOTE} characters`] });
    }
    if (decision === "rejected" && note === "") return void res.status(400).json({ error: "note_required", details: ["say why, the owner sees it"] });
    if (c.esign?.signed) return void res.status(409).json({ error: "case_signed" });
    const raw = evaluateCase({ ...c, review: null }, registries, today());
    if (!c.submitted || raw.status !== "manual_review") return void res.status(409).json({ error: "not_for_review", status: raw.status });
    const staff = staffOf(res);
    c.review = { decision, by: staff.code, on: today(), note: note === "" ? null : maskIdentifiers(note), issueKey: issueKey(raw.issues) };
    logger.info("kyc reviewed", { caseId: c.caseId, decision, by: staff.code, issues: raw.issues.map((i) => i.code) });
    res.json(queueItem(c));
  });

  // ---- partner / sales attribution ----
  router.get("/backoffice/attribution", anyStaff, (_req, res) => {
    const staff = staffOf(res);
    const people = STAFF.filter((s) => s.role !== "admin" && (staff.role !== "partner" || s.code === staff.code));
    const leads = leadStore.list();
    const quotes = quoteStore.list();
    const cases = kycStore.list();
    const orders = orderStore.list();
    const row = (code: string | null) => {
      const mine = orders.filter((o) => o.attributionCode === code);
      return {
        advisorLeads: leads.filter((l) => l.attributionCode === code).length,
        quotes: quotes.filter((x) => x.attributionCode === code).length,
        kycCases: cases.filter((c) => c.attributionCode === code).length,
        orders: mine.length,
        ordersMonthlyInr: mine.reduce((sum, o) => sum + o.bundle.monthlyInr, 0),
        orderIds: mine.map((o) => o.orderId),
      };
    };
    res.json({
      partners: people.map((s) => ({ ...staffCard(s), ...row(s.code) })),
      // Customers who came on their own (no code): shown to the operations desk and sales only.
      ...(staff.role === "partner" ? {} : { direct: row(null) }),
    });
  });

  return router;
}
