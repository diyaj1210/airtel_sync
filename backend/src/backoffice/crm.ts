import { readFileSync } from "node:fs";
import { parseCsv } from "../catalogue/csv.js";
import type { Segment } from "../catalogue/types.js";
import { DEFAULT_LEADS_PATH } from "../cities.js";

/**
 * Past-quarter leads that did not activate (smb_leads.csv, read-only): a call-back list for sales,
 * ranked by the propensity score. Only what a sales person needs to decide whom to call and how is
 * kept; no GSTIN or Udyam numbers (only whether the business has one), no outcome columns other
 * than the stage reached and the drop reason.
 */

export const SEGMENT_OF: Record<string, Segment> = {
  "Micro retail & services": "micro",
  "Professional offices": "prof",
  "Small multi-site businesses": "multi",
  "Small manufacturers": "mfg",
};

export interface CrmLead {
  leadId: string;
  createdOn: string;
  leadSource: string;
  businessName: string;
  businessType: string;
  segment: Segment;
  city: string;
  cityTier: 1 | 2;
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
}

export function parseCrmLeads(csvText: string): CrmLead[] {
  const out: CrmLead[] = [];
  for (const row of parseCsv(csvText)) {
    if (row.outcome !== "Dropped") continue;
    const segment = SEGMENT_OF[row.segment ?? ""];
    const tier = Number(row.city_tier);
    const employees = Number(row.employee_count);
    const sites = Number(row.num_sites);
    if (!segment || (tier !== 1 && tier !== 2) || !Number.isInteger(employees) || !Number.isInteger(sites) || !/^L\d{5}$/.test(row.lead_id ?? "")) {
      throw new Error(`smb_leads.csv: lead ${row.lead_id} has an unexpected segment, tier or size`);
    }
    out.push({
      leadId: row.lead_id!,
      createdOn: row.created_date!,
      leadSource: row.lead_source!,
      businessName: row.business_name!,
      businessType: row.business_type!,
      segment,
      city: row.city!,
      cityTier: tier,
      preferredLanguage: row.preferred_language!,
      employees,
      sites,
      hasGstin: row.has_gstin === "Y",
      hasUdyam: row.has_udyam === "Y",
      currentProvider: row.current_provider!,
      contactName: row.contact_name!,
      contactRole: row.contact_role!,
      stageReached: row.stage_reached!,
      dropReason: row.drop_reason!,
    });
  }
  return out;
}

export function loadCrmLeads(path: string = DEFAULT_LEADS_PATH): CrmLead[] {
  return parseCrmLeads(readFileSync(path, "utf8"));
}

/** Every business type in smb_leads.csv (the values the propensity model knows). */
export function loadBusinessTypes(path: string = DEFAULT_LEADS_PATH): Set<string> {
  return new Set(parseCsv(readFileSync(path, "utf8")).map((r) => (r.business_type ?? "").trim()).filter(Boolean));
}
