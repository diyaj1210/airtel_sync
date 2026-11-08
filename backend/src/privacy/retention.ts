/**
 * How long each kind of KYC data is kept: the one place these periods are set.
 *
 * PROPOSED - to be confirmed by legal. The consent screen, the "My data" page, the retention job
 * and docs/privacy-note.md all read these values from here.
 */
export const RETENTION = {
  status: "proposed - to be confirmed by legal",
  /** Raw uploaded document photos: deleted this many days after the documents are verified (checked). */
  rawDocumentDaysAfterVerification: 30,
  /** ... and immediately when consent is withdrawn or the owner asks for deletion. */
  rawDocumentsOnWithdrawal: "immediately",
  /** The verification result (pass / issues, masked fields read from the documents). */
  verificationResultYearsAfterContract: 8,
  /** Proof that consent was given (notice version, purposes, language, channel, time). */
  consentRecordYearsAfterContract: 8,
  /** Masked identifiers (GSTIN, Udyam, ID numbers): only while the application or contract needs them. */
  maskedIdentifiers: "while the application or contract is active",
  /** An application left unfinished: everything is deleted after this many days without activity. */
  unfinishedApplicationDays: 30,
} as const;

export type Retention = typeof RETENTION;
