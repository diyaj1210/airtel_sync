import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { EsignState } from "./store.js";

/**
 * MOCK e-sign, in the style of an Aadhaar-OTP / DigiLocker e-sign: the owner reviews the
 * agreement and confirms with a one-time password. No real signature is made and no SMS is sent:
 * the OTP is shown on screen, labelled MOCK. Wrong codes and expiry work as a real flow would.
 */

export const OTP_TTL_MS = 10 * 60 * 1000;
export const MAX_OTP_ATTEMPTS = 5;

export interface Agreement {
  caseId: string;
  business: string;
  gstin: string | null; // masked
  signatory: string;
  quote: { quoteId: string; bundle: string; monthlyInr: number; setupInr: number; contractMonths: number } | null;
  consentVersion: string;
  date: string;
}

export function startEsign(nowMs: number, otp: () => string = () => String(randomInt(0, 1_000_000)).padStart(6, "0")): EsignState {
  return { otp: otp(), issuedAtMs: nowMs, attempts: 0, signed: null };
}

export type VerifyOutcome =
  | { ok: true; state: EsignState }
  | { ok: false; error: "otp_expired" | "too_many_attempts" | "wrong_otp" | "already_signed"; attemptsLeft: number };

export function verifyEsign(
  state: EsignState,
  code: string,
  agreement: Agreement,
  nowMs: number,
  today: string,
  reference: () => string = () => `ES-${randomBytes(4).toString("hex").toUpperCase()}`,
): VerifyOutcome {
  if (state.signed) return { ok: false, error: "already_signed", attemptsLeft: 0 };
  if (state.attempts >= MAX_OTP_ATTEMPTS) return { ok: false, error: "too_many_attempts", attemptsLeft: 0 };
  if (nowMs - state.issuedAtMs > OTP_TTL_MS) return { ok: false, error: "otp_expired", attemptsLeft: MAX_OTP_ATTEMPTS - state.attempts };
  const given = Buffer.from(code.padEnd(6).slice(0, 6));
  const expected = Buffer.from(state.otp);
  if (!/^\d{6}$/.test(code) || !timingSafeEqual(given, expected)) {
    state.attempts += 1;
    const attemptsLeft = MAX_OTP_ATTEMPTS - state.attempts;
    return { ok: false, error: attemptsLeft > 0 ? "wrong_otp" : "too_many_attempts", attemptsLeft };
  }
  state.signed = { reference: reference(), signedOn: today, documentHash: agreementHash(agreement) };
  return { ok: true, state };
}

/** SHA-256 of the agreement as signed, so any later change to it is visible. */
export function agreementHash(agreement: Agreement): string {
  return createHash("sha256").update(JSON.stringify(agreement)).digest("hex");
}
