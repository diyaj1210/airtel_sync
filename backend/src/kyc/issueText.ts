import type { Lang } from "../advisor/text.js";
import { formatDate, hasText, wa, type ChannelKey } from "../channels/text.js";
import type { KycIssue } from "./checks.js";

/**
 * A KYC problem as a sentence, in English or Hindi, with the app's own wording (the same logic as
 * frontend/src/components/kyc/kycText.ts; the strings are generated from the app's).
 */
export function docName(lang: Lang, doc: string): string {
  const key = `kyc.doc.${doc}`;
  return hasText(lang, key) ? wa(lang, key) : doc;
}

export function issueSentence(lang: Lang, issue: KycIssue): string {
  const vars: Record<string, string | number> = {};
  const opt = (key: string, fallback: string) => (hasText(lang, key) ? wa(lang, key) : fallback);
  if (issue.doc) vars.doc = docName(lang, issue.doc);
  for (const [name, value] of Object.entries(issue.params)) {
    if (typeof value === "number") vars[name] = value;
    else if (typeof value === "string") {
      if (name === "detected") vars.detected = opt(`kyc.doc.${value}`, value);
      else if (name === "field") vars.field = opt(`kyc.fieldName.${value}`, value);
      else if (name === "status") vars.status = opt(`kyc.gstStatus.${value}`, value);
      else vars[name] = /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatDate(value, lang) : value;
    }
  }
  let key = `kyc.issue.${issue.code}`;
  if (issue.code === "DOC_MISSING" && issue.params.orNumber === true) key += ".orNumber";
  if (issue.code === "CERT_GSTIN_MISMATCH" && issue.params.checksumValid === false) key += ".invalid";
  return hasText(lang, key) ? wa(lang, key as ChannelKey, vars) : issue.code;
}
