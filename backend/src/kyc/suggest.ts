import type { DocumentReading } from "./documents.js";
import { checkGstin, fixOcrGstin, maskGstin } from "./identifiers.js";
import { anyNameMatches } from "./match.js";
import type { GstRecord, Registries } from "./registry.js";

/**
 * "Did you mean ...?" for a GSTIN that fails its checksum (K06, No Dead Ends).
 *
 * A suggestion is made only when exactly one registry GSTIN differs from the printed one in a
 * single character AND that record's legal or trade name matches the name on the uploaded
 * certificate: then the record is the owner's own business. Otherwise nothing is suggested and
 * nothing about any registry record is revealed (privacy: never show another business's data).
 * OCR slips (O/0, I/1 by position) are fixed first; the suggestion is confirmed by checksum + registry.
 */

export interface GstinSuggestion {
  /** The GSTIN as printed / read (after the OCR position fix). */
  printed: string;
  /** The registry GSTIN it most likely means. Server-side only: the API shows it masked. */
  gstin: string;
  legalName: string;
}

/** OCR look-alikes are the same character here (O/0, I/1, I/J), as the feature asks before failing an identifier. */
const LOOK_ALIKE: Record<string, string> = { O: "0", I: "1", J: "1" };
const plain = (c: string) => LOOK_ALIKE[c] ?? c;

/** At most one real difference, ignoring OCR look-alikes (and not the very same string). */
const oneCharApart = (a: string, b: string) => {
  if (a.length !== b.length || a === b) return false;
  let diff = 0;
  for (let i = 0; i < a.length && diff < 2; i++) if (plain(a[i]!) !== plain(b[i]!)) diff++;
  return diff <= 1;
};

export function suggestGstin(certificate: DocumentReading | undefined, registries: Registries): GstinSuggestion | null {
  if (!certificate?.readable) return null;
  const raw = certificate.fields.gstin?.value?.trim();
  if (!raw) return null;
  const printed = fixOcrGstin(raw);
  if (checkGstin(printed).ok && registries.gst.has(printed)) return null; // nothing to correct
  const names = [certificate.fields.legalName?.value ?? null, certificate.fields.tradeName?.value ?? null];
  if (names.every((n) => !n)) return null;
  const matches: GstRecord[] = [];
  for (const record of registries.gst.values()) {
    if (!oneCharApart(printed, record.gstin)) continue;
    if (names.some((n) => n && anyNameMatches(n, [record.legalName, record.tradeName]))) matches.push(record);
    if (matches.length > 1) return null; // ambiguous: say nothing
  }
  const [m] = matches;
  return m && checkGstin(m.gstin).ok ? { printed, gstin: m.gstin, legalName: m.legalName } : null;
}

/** What the owner may see of a suggestion. */
export const suggestionView = (s: GstinSuggestion) => ({ gstinMasked: maskGstin(s.gstin), legalName: s.legalName });
