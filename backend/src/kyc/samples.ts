import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCsv } from "../catalogue/csv.js";
import { REPO_ROOT } from "../config.js";
import { DOC_TYPES, type DocType } from "./documents.js";

/**
 * DEMO: the 12 sample applicants of the hackathon pack (data/raw/kyc_documents, K01-K12), each
 * linked to its lead in smb_leads.csv (the mapping is in solution_outline_chat/kyc-validation.md).
 * Used by the "try a sample applicant" button and by the K01-K12 tests. Read-only.
 */

export const DEFAULT_DOCUMENTS_DIR = resolve(REPO_ROOT, "data", "raw", "kyc_documents");
export const DEFAULT_LEADS_CSV = resolve(REPO_ROOT, "data", "raw", "smb_leads.csv");

export const SAMPLE_LEADS: Readonly<Record<string, string>> = {
  K01: "L00045",
  K02: "L01287",
  K03: "L03571",
  K04: "L01014",
  K05: "L04014",
  K06: "L00115",
  K07: "L03349",
  K08: "L03473",
  K09: "L04779",
  K10: "L04525",
  K11: "L03485",
  K12: "L03558",
};
export const SAMPLE_ID_RE = /^K(0[1-9]|1[0-2])$/;

export interface SampleApplicant {
  id: string;
  leadId: string;
  businessName: string;
  /** The lead's contact person: they apply and give consent. */
  applicantName: string;
  /** What the owner would type: the lead's GSTIN (null if none) and whether they have Udyam. */
  gstin: string | null;
  hasUdyam: boolean;
  /** Documents this applicant submitted (K05 has no Udyam certificate). */
  documents: DocType[];
}

export function loadSamples(leadsCsv: string = DEFAULT_LEADS_CSV, documentsDir: string = DEFAULT_DOCUMENTS_DIR): SampleApplicant[] {
  const wanted = new Set(Object.values(SAMPLE_LEADS));
  const leads = new Map(parseCsv(readFileSync(leadsCsv, "utf8")).filter((r) => wanted.has(r.lead_id ?? "")).map((r) => [r.lead_id!, r]));
  return Object.entries(SAMPLE_LEADS).map(([id, leadId]) => {
    const lead = leads.get(leadId);
    if (!lead) throw new Error(`smb_leads.csv has no lead ${leadId} (sample applicant ${id})`);
    return {
      id,
      leadId,
      businessName: lead.business_name!,
      applicantName: lead.contact_name!,
      gstin: lead.has_gstin === "Y" && lead.gstin ? lead.gstin : null,
      hasUdyam: lead.has_udyam === "Y",
      documents: DOC_TYPES.filter((d) => existsSync(sampleImagePath(id, d, documentsDir))),
    };
  });
}

export function sampleImagePath(id: string, doc: DocType, documentsDir: string = DEFAULT_DOCUMENTS_DIR): string {
  if (!SAMPLE_ID_RE.test(id)) throw new Error(`not a sample applicant: ${id}`);
  return resolve(documentsDir, `${id}_${doc}.png`);
}
