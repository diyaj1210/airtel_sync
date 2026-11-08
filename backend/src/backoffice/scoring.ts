import type { AdvisorLead } from "../advisor/leads.js";
import type { Segment } from "../catalogue/types.js";
import { dataLeadScores, scoreLeads, type PropensityApi, type PropensityScore } from "../propensity/client.js";
import { SEGMENT_OF } from "./crm.js";
import { leadSourceFor } from "./staff.js";

/**
 * Propensity scores for the back-office (model: ai-service, step 6). The score only ranks whom to
 * call first; it never changes what a customer can buy (that is the rules engine's job).
 */

export type Band = PropensityScore["band"];
/** Suggested next action per band (solution_outline_chat/04-propensity-upsell.md). */
export const NEXT_ACTION: Record<Band, "call_within_24h" | "whatsapp_nudge" | "nurture"> = {
  high: "call_within_24h",
  medium: "whatsapp_nudge",
  low: "nurture",
};

const SEGMENT_NAME = Object.fromEntries(Object.entries(SEGMENT_OF).map(([name, code]) => [code, name])) as Record<Segment, string>;

/** Advisor answer -> current_internet in smb_leads.csv. */
const INTERNET_NAME: Record<string, string> = {
  none: "None",
  mobile_hotspot: "Mobile hotspot",
  home_broadband: "Home broadband",
  business_broadband: "Business broadband",
  leased_line: "Leased line",
};

/**
 * Model inputs known for a lead the advisor saved. What the advisor does not ask (turnover, Udyam,
 * current provider, telecom spend, the products asked about in the CRM's sense) is left out and
 * counts as average. The business type is passed only when it is one the model knows.
 */
export function advisorLeadFeatures(lead: AdvisorLead, knownBusinessTypes: ReadonlySet<string>): Record<string, string | number> {
  const f: Record<string, string | number> = {};
  const b = lead.business;
  if (lead.segment) f.segment = SEGMENT_NAME[lead.segment];
  const type = typeof b.type === "string" ? [...knownBusinessTypes].find((t) => t.toLowerCase() === b.type!.toLowerCase()) : undefined;
  if (type) f.business_type = type;
  const source = leadSourceFor(lead.attributionCode);
  if (source) f.lead_source = source;
  if (b.cityTier === 1 || b.cityTier === 2) f.city_tier = String(b.cityTier);
  if (b.gstin) f.has_gstin = b.gstin === "none" ? "N" : "Y";
  if (typeof b.currentInternet === "string" && INTERNET_NAME[b.currentInternet]) f.current_internet = INTERNET_NAME[b.currentInternet]!;
  f.preferred_language = lead.lang === "hi" ? "Hindi" : "English";
  if (typeof b.employees === "number") f.employee_count = b.employees;
  if (typeof b.locations === "number") f.num_sites = b.locations;
  return f;
}

export class BackofficeScoring {
  private dataScores: Map<string, PropensityScore> | null = null;

  constructor(
    private readonly api: PropensityApi,
    private readonly knownBusinessTypes: ReadonlySet<string>,
  ) {}

  /** Scores of the advisor's leads, by lead id; null when the model is unavailable. */
  async advisorLeads(leads: AdvisorLead[]): Promise<Map<string, PropensityScore> | null> {
    if (leads.length === 0) return new Map();
    const scores = await scoreLeads(
      this.api,
      leads.map((l) => ({ id: l.leadId, lead: advisorLeadFeatures(l, this.knownBusinessTypes) })),
    );
    return scores && new Map(leads.map((l, i) => [l.leadId, scores[i]!]));
  }

  /** Scores of the past-quarter leads (smb_leads.csv); fetched once, then kept (data and model do not change). */
  async crmLeads(): Promise<Map<string, PropensityScore> | null> {
    if (!this.dataScores) this.dataScores = await dataLeadScores(this.api);
    return this.dataScores;
  }
}
