# Smart KYC – Validation Design (Key question 3)

## Flow (lookup first, upload only what's missing)
1. Owner enters **GSTIN** (format + checksum check) and **Udyam number** (optional) → mock registry
   lookups (public business registries, nothing stored) → "Business record found" + the documents
   still needed + the One-Sitting Completion preview (add-on, see 05-one-sitting-and-privacy.md).
2. **Consent screen** (DPDP Act 2023), five sections: what we collect (only what is still needed),
   why (five separate purposes), what is optional, how long we keep it, how to withdraw.
3. Owner gives their name (as on the ID).
4. Upload **signatory ID** and **address proof** (and certificates only if lookup failed).
5. OCR extracts fields → cross-checks below → result: **Pass / Fix needed / Manual review**.
6. e-sign (mocked, DigiLocker-style) → order released.

## Checks
| # | Check | Rule |
|---|---|---|
| 1 | GSTIN format | 15 chars: 2-digit state code + 10-char PAN (4th char `X` allowed per README) + entity digit + `Z` + checksum |
| 2 | GSTIN checksum | Standard mod-36 GSTIN checksum on first 14 characters |
| 3 | GSTIN status | Registry status must be **Active** (Cancelled/Suspended → block GSTIN-only products) |
| 4 | Name match | Trade/legal name on GST cert = registry = Udyam enterprise name = bill "Billed to" (fuzzy match) |
| 5 | Address match | Address on bill ≈ GST principal place of business |
| 6 | Address proof age | Bill date ≥ 2026-04-16 (≤ 90 days before "today" 2026-07-15) |
| 7 | Signatory match | Name on signatory ID = proprietor in GST legal name, or the applicant / lead contact name (for LLP / Pvt Ltd the legal name has no person, so the contact name decides) |
| 8 | ID validity | Signatory ID "valid till" > today |
| 9 | Udyam | Number format `UDYAM-XX-00-NNNNNNN`, exists in registry, name/state match; blank field = missing |
| 10 | Completeness | All required docs present |
| 11 | Image quality | Blurry / unreadable (low OCR confidence) → ask for re-upload |

OCR tips (all seen in this data):
- Normalise O↔0 and I↔1 **by position**, not globally: in a GSTIN, characters 3–7 and 12 are
  PAN letters, 8–11 are digits. Real registry GSTINs contain the letter O in digit-looking places
  (K02 `19EOGXH…`, K08 `24XORXG…`, K04 `…1936O1ZH`). Confirm via checksum + registry.
- Addresses wrap mid-word on the certificates ("Visakhapatnam, A / ndhra Pradesh",
  "Kochi, Kerala - 75 / 2083"): join wrapped lines **without** a space before comparing.
- K02's GST certificate is rotated: deskew before OCR.

## Our reading of the sample applicants (not the official answer key)
Verified by reading every image and cross-checking registries, checksum and `smb_leads.csv`.
"Expected result" is what our Smart KYC must output; each row gets an automated test.

| Applicant (lead) | Issue found | Expected result |
|---|---|---|
| K01 Vindhya Tours & Travels (L00045) | Registry GSTIN status **Cancelled**; Udyam certificate submitted with **blank** reg. number (lead has `has_udyam = N`) | **GSTIN-only products blocked** (checks pass; with such a product in the quote: "Not possible as chosen", one tap to the bundle without it); Udyam cert not used (optional, not blocking) |
| K02 Harmony Dental Care (L01287) | GST cert **rotated/skewed**; data matches registry after deskew | **Pass** (OCR robustness) |
| K03 Ganesh Woodcraft (L03571) | None | **Pass** |
| K04 Saffron Dental Care LLP (L01014) | GST cert **blurred**, GSTIN unreadable (registry: `27PZSXS1936O1ZH`) | **Fix needed:** re-upload |
| K05 Balaji Realty LLP (L04014) | **Udyam certificate missing** (lead has Udyam `UDYAM-KL-00-5521886`, which exists in the registry) | **Pass**: Udyam is optional (no product needs it); adding the number for lookup is offered |
| K06 Saffron Unisex Salon (L00115) | GSTIN on doc `08YKZXS8189L1ZO` **fails checksum** and is not in registry; registry has `08YKZXS5189L1ZO` (8 vs 5) | **Fix needed:** GSTIN mismatch → "Did you mean …?" (the near-miss record has the certificate's name) → one-tap confirm → Pass |
| K07 Neelgiri Physio Clinic (L03349) | GST cert legal name "Neha Banerjee (Prop. **Shri** Physio Clinic)" ≠ registry legal name "(Prop. **Neelgiri** Physio Clinic)" and ≠ trade name | **Manual review:** name mismatch (possible tampering) |
| K08 Green Leaf Legal Associates (L03473) | None | **Pass** |
| K09 Kaveri Insurance Advisors (L04779) | None | **Pass** |
| K10 Kaveri Stays LLP (L04525) | Signatory ID **Nisha Arora** ("Owner") ≠ lead owner **Fatima Menon**; LLP legal name has no person to match | **Manual review:** signatory not verified → MOCK signing link to the registered owner; once signed → Pass |
| K11 Trinity Bake House Pvt Ltd (L03485) | Electricity bill dated 2025-10-31 = **257 days old** (> 90) | **Fix needed:** recent address proof |
| K12 Star Electronics (L03558) | None blocking | **Pass** (soft warning only) |

Soft warnings (non-blocking, shown to the reviewer):
- Udyam **registration date** on the certificate differs from the registry on **all 10** certificates
  that have a number (K02–K04, K06–K12). Because it affects every applicant, including the clean
  ones, it must stay a soft warning; making it blocking would fail K03/K08/K09/K12.
- Udyam **major activity** differs from the registry for K06, K10, K11, K12 (cert says Services,
  registry says Trading).
- No other checks fail: all signatory IDs are valid well beyond 2026-07-15, and every bill
  address matches the GST principal place of business.

Udyam is optional everywhere (no catalogue product requires it): its problems are caught and
shown to the reviewer as warnings, never blocking.

## Privacy choices (implemented; see docs/privacy-note.md)
- Collect only what each step needs; no Aadhaar number asked for or stored.
- Mask identifiers in UI and logs with one format: GSTIN first 4 + last 3 (`27XU********1ZP`),
  Udyam / ID / phone the last 4.
- Encrypt documents at rest (AES-256-GCM); delete raw images 30 days after verification (or at
  once on request / withdrawal); keep the verification result + masked fields for the contract
  period plus 8 years (proposed, to be confirmed by legal).
- Purpose limitation: KYC data used only for onboarding/compliance, not marketing.
- Consent log with timestamp; withdraw/delete request option.
