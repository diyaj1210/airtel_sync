import { CONSENT_PURPOSES, CONSENT_VERSION } from "../src/kyc/store.js";

/** A valid consent from the app: the current notice, every KYC purpose named, marketing not ticked. */
export const CONSENT = { accepted: true, version: CONSENT_VERSION, purposes: [...CONSENT_PURPOSES], marketing: false };
