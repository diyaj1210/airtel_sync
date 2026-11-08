# Privacy and security note: Udyam Digital (prototype)

How the prototype handles personal data, following the DPDP Act 2023 principles (notice, specific
consent, purpose limitation, data minimisation, withdrawal, deletion). Every statement describes
the code as built; file names point to where it happens.

**Data collected per step**
| Step | Collected | Not collected |
|---|---|---|
| Advisor and quote | Business facts only: type, people, locations, city tier, has a GSTIN (yes/no), current internet and tools | GSTIN numbers typed in the chat are reduced to "has a GSTIN" |
| Call back (optional) | Mobile number, only with a tick-box consent for that call | Anything else about the person |
| KYC, before consent | GSTIN and Udyam number, looked up in the public business registries; **nothing stored** (`POST /api/kyc/lookup`) | The person's name, documents |
| KYC, after consent | Applicant name; photos of only the documents the lookup could not confirm (usually a signatory ID and a recent bill) | **Aadhaar number** (never asked); Udyam is optional (no product needs it) |
| Payment (MOCK) | Payment method type and amount | Card, UPI or bank details |

**Minimisation (lookup first).** The app first looks the GSTIN / Udyam number up in the registries,
shows what was found and asks only for the documents still needed. In the K03 sample, 2 of the 4
documents are not needed.

**Consent** (`frontend/src/components/kyc/KycPrivacy.tsx`, `backend/src/kyc/store.ts`). The notice
appears before anything personal is collected. It has five short sections, in Hindi and English:
1. **What:** the list is built from this journey's documents.
2. **Why:** five separate purposes: identity verification, product eligibility, order activation,
   electronic signing, and manual review only if needed. There is no generic "service improvement".
3. **What is optional:** Udyam, and marketing, which is a separate tick-box, off by default.
4. **How long.**
5. **How to withdraw.**

The record keeps the id, notice version, purposes, marketing yes/no, language, channel (app or
WhatsApp) and time. **The server enforces it:** after withdrawal, every KYC write, upload and
e-sign is refused with HTTP 403.

**Masking** (`backend/src/masking.ts`, the one utility for the UI, the API and the logs):
- GSTIN shows the first 4 and last 3 characters (`27XU********1ZP`).
- Udyam numbers, ID numbers and phone numbers show the last 4.
- The logger masks these patterns in every message and field and redacts document, image, OCR-text
  and token fields.
- Request bodies, OCR text and images are never logged. The WhatsApp number travels in a header,
  never in a URL.
- The ai-service uses the same rules (`ai-service/app/masking.py`).

**Encryption and access.** Document photos are stored with AES-256-GCM using a key from `.env`
(`DOCUMENT_ENCRYPTION_KEY`), in `backend/var/documents/`. That folder is outside any served folder
and git-ignored, and file names are random. Only the operations-desk role can view a photo; the
response is never cached and each view is logged with the staff code. Sales and partners never see
KYC data, and partners see only the leads they referred. Staff sign-in is a MOCK, with tokens kept
in memory for 8 hours.

**Retention** (`backend/src/privacy/retention.ts`, one file, marked *proposed, to be confirmed by
legal*):
| Data | Kept for |
|---|---|
| Raw document photos | 30 days after verification, or deleted at once on withdrawal or the owner's request |
| Verification result | The contract plus 8 years (audit) |
| Masked identifiers | Only while the application or contract needs them |
| Consent record | Kept as proof of consent |

A retention job runs every 6 hours and can be triggered from the back-office for the demo. It
deletes expired photos and writes a deletion log.

**Withdrawal and deletion.** The owner's **My data** page shows:
- what is held (masked), the purposes and the consent date;
- each photo's deletion date and the days left;
- the deletion log ("Deleted on ...").

From that page the owner can delete the photos now, cancel the unfinished application, or withdraw
consent. Withdrawal deletes all KYC data at once and **stops an order that is not yet activated**.
Records already completed (payment, an activated order) are kept, as the law requires.

**Secrets and data.** No secrets are in the repository (`.env` is git-ignored; `.env.example` lists
the keys). The Gemini key is used only by the ai-service; prompts carry masked business facts, never
names or identifiers. The files in `data/raw/` are read-only and treated as real customer data.

**Prototype limits.** Everything except the encrypted photos is held in memory and is gone when the
backend restarts. Registries, e-sign, payment, WhatsApp and the coverage check are labelled MOCKs. A
real rollout needs a database encrypted at rest, a key-management service and the company's staff
login.
