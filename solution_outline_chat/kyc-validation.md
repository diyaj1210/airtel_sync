# Smart KYC – Validation Design (Key question 3)

## Flow (lookup first, upload only what's missing)
1. **Consent screen** (DPDP Act 2023): what we collect, why, how long we keep it, how to withdraw.
2. Owner enters **GSTIN** → format + checksum check → mock registry lookup → legal name, trade name,
   address, constitution, status auto-filled.
3. Owner enters **Udyam number** (optional) → mock Udyam lookup.
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
| 7 | Signatory match | Name on signatory ID = proprietor in GST legal name or lead's contact/owner |
| 8 | ID validity | Signatory ID "valid till" > today |
| 9 | Udyam | Number format `UDYAM-XX-00-NNNNNNN`, exists in registry, name/state match; blank field = missing |
| 10 | Completeness | All required docs present |
| 11 | Image quality | Blurry / unreadable (low OCR confidence) → ask for re-upload |

OCR tip: normalise common confusions (O↔0, I↔1/J) before rejecting; confirm via registry + checksum.

## Our reading of the sample applicants (not the official answer key)
| Applicant | Issue found |
|---|---|
| K01 Vindhya Tours | GSTIN **Cancelled**; Udyam number **blank** |
| K02 Harmony Dental | GST cert **rotated/skewed** (OCR robustness); data OK |
| K03 Ganesh Woodcraft | Clean |
| K04 Saffron Dental | GST cert **blurred** → re-upload |
| K05 Balaji Realty | **Udyam certificate missing** |
| K06 Saffron Salon | GSTIN on doc `…S8189…` vs registry `…S5189…` → **checksum fails** |
| K07 Neelgiri Physio | Legal name "Prop. **Shri** Physio Clinic" ≠ trade name **Neelgiri** |
| K08 Green Leaf Legal | Clean |
| K09 Kaveri Insurance | Clean |
| K10 Kaveri Stays | Signatory **Nisha Arora** ≠ lead owner Fatima Menon |
| K11 Trinity Bake House | Electricity bill **257 days old** (> 90) |
| K12 Star Electronics | Clean |
Soft warnings: several Udyam certs show registration date / major activity different from the registry.

## Privacy choices (for the 1-page note)
- Collect only what each step needs; no Aadhaar number stored.
- Mask identifiers in UI and logs (e.g. `27XUIX*****1ZP`).
- Encrypt documents at rest; delete raw images after verification (e.g. 30 days), keep only
  verification result + masked fields for the contract period.
- Purpose limitation: KYC data used only for onboarding/compliance, not marketing.
- Consent log with timestamp; withdraw/delete request option.
