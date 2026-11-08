import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCsv } from "../../src/catalogue/csv.js";
import type { BundleLine, BusinessProfile } from "../../src/catalogue/types.js";
import { REPO_ROOT } from "../../src/config.js";

export interface ActivatedLead {
  leadId: string;
  /** GSTIN treated as active when the lead has one (same as scripts/verify_outline.py). */
  profile: BusinessProfile;
  lines: BundleLine[];
  monthlyValueInr: number;
  setupInr: number;
  contractMonths: number;
}

/** Activated leads from data/raw/smb_leads.csv (read-only), for cross-checks against real sales. */
export function loadActivatedLeads(): ActivatedLead[] {
  const rows = parseCsv(readFileSync(resolve(REPO_ROOT, "data", "raw", "smb_leads.csv"), "utf8"));
  return rows
    .filter((r) => r.outcome === "Activated")
    .map((r) => ({
      leadId: r.lead_id!,
      profile: {
        cityTier: Number(r.city_tier) as 1 | 2,
        employees: Number(r.employee_count),
        sites: Number(r.num_sites),
        gstin: r.has_gstin === "Y" ? "active" : "none",
      },
      lines: r.bundle_products!.split(";").map((item) => {
        const [productId, qty] = item.split("x");
        return { productId: productId!, qty: Number(qty) };
      }),
      monthlyValueInr: Number(r.monthly_bundle_value_inr),
      setupInr: Number(r.one_time_setup_inr),
      contractMonths: Number(r.contract_months),
    }));
}
