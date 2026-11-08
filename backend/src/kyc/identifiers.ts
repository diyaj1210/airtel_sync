/**
 * GSTIN and Udyam number rules (kyc-validation.md checks 1, 2 and 9).
 *
 * GSTIN: 2-digit state code + 10-character PAN + entity number + 'Z' + check character.
 * - The PAN's 4th character is the holder type. Real PANs use A B C F G H J L P T; every GSTIN in
 *   this data has 'X' there (data/raw/README.md), so 'X' is accepted as well.
 * - The check character is the standard GSTIN mod-36 checksum over the first 14 characters.
 * Udyam: UDYAM-<2-letter state>-<2-digit district>-<7 digits>. District 00 is in every record of
 * this data and is accepted.
 */

export const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const PAN_HOLDER_TYPES = "ABCFGHJLPTX";
// Shape only: state digits, PAN (5 letters, 4 digits, 1 letter), entity number, Z, check character.
const GSTIN_SHAPE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const UDYAM_SHAPE = /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/;

/** State / UT codes used in GSTINs: 01-38, plus 97 (other territory). */
function validStateCode(code: number): boolean {
  return (code >= 1 && code <= 38) || code === 97;
}

/** The mod-36 check character for the first 14 characters of a GSTIN. */
export function gstinCheckChar(first14: string): string {
  if (!/^[0-9A-Z]{14}$/.test(first14)) throw new Error("gstinCheckChar needs 14 characters 0-9 / A-Z");
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = GSTIN_CHARS.indexOf(first14[i]!) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36]!;
}

export type GstinProblem = "format" | "state_code" | "pan_type" | "checksum";
export type Checked<P> = { ok: true; value: string } | { ok: false; problem: P };

/** Upper case, without spaces or dashes (how people type it). */
export function cleanGstin(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]+/g, "");
}

export function checkGstin(raw: string): Checked<GstinProblem> {
  const gstin = cleanGstin(raw);
  if (!GSTIN_SHAPE.test(gstin)) return { ok: false, problem: "format" };
  if (!validStateCode(Number(gstin.slice(0, 2)))) return { ok: false, problem: "state_code" };
  if (!PAN_HOLDER_TYPES.includes(gstin[5]!)) return { ok: false, problem: "pan_type" };
  if (gstinCheckChar(gstin.slice(0, 14)) !== gstin[14]) return { ok: false, problem: "checksum" };
  return { ok: true, value: gstin };
}

const TO_DIGIT: Record<string, string> = { O: "0", Q: "0", D: "0", I: "1", L: "1" };
const TO_LETTER: Record<string, string> = { "0": "O", "1": "I", "5": "S", "8": "B" };

/**
 * Undo the usual OCR confusions (O/0, I/1) by position, never globally: in a GSTIN, characters
 * 3-7 and 12 are PAN letters and 8-11 are digits (state code 1-2 digits too). Real registry
 * GSTINs contain the letter O where a digit looks likely (K02 19EOGXH..., K08 24XORXG...), which is
 * why this is positional; the checksum and the registry then confirm the result.
 */
export function fixOcrGstin(raw: string): string {
  const s = cleanGstin(raw);
  if (s.length !== 15) return s;
  return [...s]
    .map((ch, i) => {
      if (i <= 1 || (i >= 7 && i <= 10)) return TO_DIGIT[ch] ?? ch;
      if ((i >= 2 && i <= 6) || i === 11) return TO_LETTER[ch] ?? ch;
      return ch;
    })
    .join("");
}

export type UdyamProblem = "format";

export function cleanUdyam(raw: string): string {
  return raw.toUpperCase().replace(/\s+/g, "").replace(/[–—]/g, "-");
}

export function checkUdyam(raw: string): Checked<UdyamProblem> {
  const value = cleanUdyam(raw);
  return UDYAM_SHAPE.test(value) ? { ok: true, value } : { ok: false, problem: "format" };
}

/** OCR fix for a Udyam number: letters read in the digit groups (O -> 0, I -> 1). */
export function fixOcrUdyam(raw: string): string {
  const s = cleanUdyam(raw);
  const m = /^(UDYAM)-([A-Z0-9]{2})-([A-Z0-9]{2})-([A-Z0-9]{7})$/.exec(s);
  if (!m) return s;
  const digits = (part: string) => [...part].map((c) => TO_DIGIT[c] ?? c).join("");
  return `${m[1]}-${m[2]}-${digits(m[3]!)}-${digits(m[4]!)}`;
}

/** Display masks (same as the log masking): 27XUIX******1ZP, UDYAM-MH-00-****696, SYN-ID-***889. */
export function maskGstin(gstin: string): string {
  return gstin.length === 15 ? gstin.slice(0, 6) + "******" + gstin.slice(12) : "*".repeat(gstin.length);
}

export function maskUdyam(udyam: string): string {
  return udyam.length === 19 ? udyam.slice(0, 12) + "****" + udyam.slice(16) : "*".repeat(udyam.length);
}

/** Any other document number: only the last 3 characters stay visible. */
export function maskNumber(value: string): string {
  return value.length <= 3 ? "*".repeat(value.length) : "*".repeat(value.length - 3) + value.slice(-3);
}
