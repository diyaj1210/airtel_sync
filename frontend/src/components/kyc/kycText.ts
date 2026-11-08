import type { KycIssue } from "../../api/kyc";
import { formatDate } from "../../format";
import { en, type MessageKey } from "../../i18n/en";
import type { Lang, Translate, TranslateVars } from "../../i18n/I18nProvider";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isKey = (key: string): key is MessageKey => key in en;
const optional = (t: Translate, key: string, fallback: string) => (isKey(key) ? t(key) : fallback);

/** The sentence for one KYC issue, from its code and params (server sends no text, only codes). */
export function issueText(issue: KycIssue, t: Translate, lang: Lang): string {
  const vars: TranslateVars = {};
  if (issue.doc) vars.doc = t(`kyc.doc.${issue.doc}` as MessageKey);
  for (const [name, value] of Object.entries(issue.params)) {
    if (typeof value === "number") vars[name] = value;
    else if (typeof value === "string") {
      if (name === "detected") vars.detected = optional(t, `kyc.doc.${value}`, value);
      else if (name === "field") vars.field = optional(t, `kyc.fieldName.${value}`, value);
      else if (name === "status") vars.status = optional(t, `kyc.gstStatus.${value}`, value);
      else vars[name] = ISO_DATE.test(value) ? formatDate(value, lang) : value;
    }
  }
  let key = `kyc.issue.${issue.code}`;
  if (issue.code === "DOC_MISSING" && issue.params.orNumber === true) key += ".orNumber";
  if (issue.code === "CERT_GSTIN_MISMATCH" && issue.params.checksumValid === false) key += ".invalid";
  return isKey(key) ? t(key, vars) : t("kyc.error");
}
