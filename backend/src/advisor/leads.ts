import { randomBytes } from "node:crypto";
import type { ProductId, Segment } from "../catalogue/types.js";
import { maskIdentifiers, maskPhone } from "../masking.js";
import { segmentFor, type Answers } from "./answers.js";
import { businessFacts } from "./explain.js";
import { selectedItems } from "./recommend.js";
import type { AdvisorSession } from "./sessions.js";
import type { Lang } from "./text.js";

/**
 * Leads the advisor could not close, with the reason, for the sales / partner back-office
 * (shown in step 7). Kept in memory for the prototype. The mobile number is stored only when the
 * owner gives it with consent for a call back; every API response and log shows it masked.
 */

export const LEAD_REASONS = [
  "asked_for_human",
  "advisor_could_not_understand",
  "price_too_high",
  "decided_to_wait",
  "only_mobile_plan",
  "locked_in_provider",
  "needs_unavailable_product",
  "other",
] as const;
export type LeadReason = (typeof LEAD_REASONS)[number];

/** Follow-up by sales / partners in the back-office (step 7). */
export const FOLLOW_UP_STATUSES = ["new", "contacted", "converted", "lost"] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

export interface FollowUp {
  status: FollowUpStatus;
  /** Staff code of the sales person or partner who owns the follow-up, or null. */
  assignedTo: string | null;
  updatedOn: string | null;
  updatedBy: string | null;
}

export interface AdvisorLead {
  leadId: string;
  sessionId: string;
  createdOn: string;
  updatedOn: string;
  reason: LeadReason;
  note: string | null;
  /** 10-digit Indian mobile, only with callbackConsent. */
  phone: string | null;
  callbackConsent: boolean;
  lang: Lang;
  segment: Segment | null;
  business: ReturnType<typeof businessFacts>;
  recommendation: { templateId: string; name: string; monthlyInr: number; productIds: ProductId[] } | null;
  askedAboutUnavailable: ProductId[];
  advisorTurns: number;
  /** Partner / sales code the owner was referred by, or null. */
  attributionCode: string | null;
  followUp: FollowUp;
}

export type AdvisorLeadView = Omit<AdvisorLead, "phone" | "sessionId"> & { phoneMasked: string | null };

export const MAX_NOTE = 300;

/** Accepts 98765 43210, +91 98765-43210, 098765 43210. Returns the 10 digits, or null. */
export function parseIndianMobile(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/[\s()-]/g, "").replace(/^(?:\+91|0091|91(?=\d{10}$)|0(?=\d{10}$))/, "");
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

export { maskPhone };

function segmentOf(answers: Answers): Segment | null {
  return answers.businessKind && answers.sites !== undefined ? segmentFor(answers.businessKind, answers.sites) : null;
}

export class LeadStore {
  private readonly leads = new Map<string, AdvisorLead>();

  constructor(
    private readonly today: () => string,
    private readonly newId: () => string = () => `AL-${randomBytes(4).toString("hex").toUpperCase()}`,
  ) {}

  /** Create the session's lead, or update it if the owner already left one. */
  save(
    session: AdvisorSession,
    input: { reason: LeadReason; note: string | null; phone: string | null; callbackConsent: boolean },
  ): { lead: AdvisorLead; created: boolean } {
    const existing = session.leadId ? this.leads.get(session.leadId) : undefined;
    const rec = session.recommendation;
    const lead: AdvisorLead = {
      leadId: existing?.leadId ?? this.uniqueId(),
      sessionId: session.id,
      createdOn: existing?.createdOn ?? this.today(),
      updatedOn: this.today(),
      // Asking for a person after the advisor said it could not understand is recorded as such.
      reason: input.reason === "asked_for_human" && session.stuck ? "advisor_could_not_understand" : input.reason,
      note: input.note === null ? null : maskIdentifiers(input.note),
      phone: input.callbackConsent ? input.phone : null,
      callbackConsent: input.callbackConsent && input.phone !== null,
      lang: session.lang,
      segment: segmentOf(session.answers),
      business: businessFacts(session.answers),
      recommendation: rec
        ? {
            templateId: rec.quote.templateId,
            name: rec.quote.name,
            monthlyInr: rec.quote.totals.monthlyInr,
            productIds: selectedItems(rec).map((i) => i.productId),
          }
        : null,
      askedAboutUnavailable: [...session.askedUnavailable],
      advisorTurns: session.turns,
      attributionCode: session.attributionCode,
      // A referred lead starts with the partner / sales person who referred it.
      followUp: existing?.followUp ?? { status: "new", assignedTo: session.attributionCode, updatedOn: null, updatedBy: null },
    };
    this.leads.set(lead.leadId, lead);
    session.leadId = lead.leadId;
    return { lead, created: !existing };
  }

  list(): AdvisorLead[] {
    return [...this.leads.values()];
  }

  get(leadId: string): AdvisorLead | undefined {
    return this.leads.get(leadId);
  }

  /** Back-office follow-up (status and/or who owns it). */
  setFollowUp(leadId: string, change: { status?: FollowUpStatus; assignedTo?: string | null }, by: string): AdvisorLead | undefined {
    const lead = this.leads.get(leadId);
    if (!lead) return undefined;
    lead.followUp = {
      status: change.status ?? lead.followUp.status,
      assignedTo: change.assignedTo !== undefined ? change.assignedTo : lead.followUp.assignedTo,
      updatedOn: this.today(),
      updatedBy: by,
    };
    return lead;
  }

  private uniqueId(): string {
    let id = this.newId();
    for (let tries = 0; this.leads.has(id); tries++) {
      if (tries > 10) throw new Error("Could not generate a unique lead id");
      id = this.newId();
    }
    return id;
  }
}

export function leadView(lead: AdvisorLead): AdvisorLeadView {
  const { phone, sessionId: _sessionId, ...rest } = lead;
  return { ...rest, phoneMasked: phone ? maskPhone(phone) : null };
}
