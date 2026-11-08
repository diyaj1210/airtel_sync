/**
 * One-Sitting Completion + No Dead Ends (add-on feature): types shared by the readiness check,
 * the KYC case (blockers are kept on it) and the API.
 */

export const READINESS_STATES = ["NOT_CURRENTLY_POSSIBLE", "PARTNER_ASSISTANCE_RECOMMENDED", "NEEDS_REVIEW", "ALMOST_READY", "READY"] as const;
export type ReadinessState = (typeof READINESS_STATES)[number];

export type BlockerCategory = "identity" | "registry" | "document" | "signatory" | "eligibility" | "feasibility" | "payment" | "installation";
export type ActionType = "upload" | "confirm" | "choose_alternative" | "send_esign_link" | "wait_review" | "contact_partner";
export type ResponsibleParty = "customer" | "accel_ops" | "partner" | "installer";
export type BlockerStatus = "open" | "in_progress" | "resolved" | "waived";
export type Bilingual = { en: string; hi: string };

export type AlternativeKind = "without_gstin_products" | "airfiber" | "requote";

export interface Blocker {
  /** Stable: the same problem keeps the same id across re-checks. */
  id: string;
  category: BlockerCategory;
  customerMessage: Bilingual;
  requiredAction: Bilingual;
  actionType: ActionType;
  responsibleParty: ResponsibleParty;
  status: BlockerStatus;
  expectedResolution: Bilingual;
  /** A completable alternative bundle, when there is one. */
  alternative?: { kind: AlternativeKind; bundle: string; monthlyInr: number; setupInr: number; removed: string[]; added: string[] };
  /** The document to upload again, for upload actions. */
  doc?: string;
  /** "Did you mean ...?" (K06): masked GSTIN of the owner's own registration and its name. */
  suggestion?: { gstinMasked: string; legalName: string };
  /** A specific question the owner can answer while the team reviews (K07). */
  question?: Bilingual;
  answer?: string | null;
  /** Hard blocks make the selected bundle not possible as it is. */
  hard: boolean;
  openedOn: string;
  resolvedOn: string | null;
  /** Who resolved it: the owner / the system (auto) or a person in the team (staff). */
  resolvedBy: "auto" | "staff" | null;
}

export type RequirementGroup = "business" | "gstin" | "signatory" | "address" | "feasibility";
