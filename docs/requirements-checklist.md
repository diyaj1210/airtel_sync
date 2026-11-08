# Requirements checklist

Every requirement from the case PDF (`problem_statement/Airtel_SYNC_Case.pdf`) and the data
README (`data/raw/README.md`), each mapped to the build step in
[`solution_outline_chat/build-plan.md`](../solution_outline_chat/build-plan.md) that delivers it.

Tick a box only when the step's code and tests are merged and the item is demonstrated. Steps:
S0 scaffold · S1 catalogue-rules · S2 quote · S3 advisor · S4 kyc · S5 tracker ·
S6 propensity · S7 backoffice · S8 whatsapp-voice · S9 submission docs.

## 1. Problem statement (PDF p.3)

- [ ] **R1.1** Digital-first acquisition **and** onboarding journey: discover the right bundle → buy it → get it activated — S2, S3, S4, S5
- [ ] **R1.2** Minimal human effort (self-serve end to end; humans only for exceptions) — S3, S4, S5, S7
- [ ] **R1.3** Works on a phone (mobile-first UI) — S0 onwards *(S0: mobile-first shell, 44px tap targets, safe-area insets; every later screen must keep this)*
- [x] **R1.4** In the owner's preferred language (at least Hindi and English, language switch) — S0 (shell), S3 (advisor replies) *(S0: English/हिंदी switch with key-parity tests; S3: the advisor understands and answers in Hindi (Devanagari, incl. Devanagari digits), English and Hinglish, switchable mid-chat; regional languages beyond Hindi are part of R4.2, S8/S9)*

## 2. Build challenge: required modules (PDF p.3)

### Advisor
- [x] **R2.1** GenAI-powered conversational assistant — S3 *(S3: Gemini (`gemini-3.5-flash-lite`, Google `google-genai` SDK in the ai-service) reads free-form messages and words the explanations; every sentence checked by a guard; no-key basic mode)*
- [x] **R2.2** Asks about the business: **type** — S3 *(S3: kind + label, e.g. "Dental clinic", from text or quick replies)*
- [x] **R2.3** Asks about **size** (employees) — S3 *(S3: validated 1–100,000; ranges count as the lower end)*
- [x] **R2.4** Asks about **locations** (number of sites, city → city tier) — S3 *(S3: sites + city (22 data cities, English/Hindi/old names); a city outside the list is tier 2, the stricter rule set)*
- [x] **R2.5** Asks about **current tools** (current internet, POS/billing, email, CCTV, messaging) — S3 *(S3: current internet (5 types, as in smb_leads.csv) + multi-select tools; gaps lead to add-on suggestions (no POS → billing, no CCTV → CCTV, WhatsApp/SMS → WhatsApp API) only when the rules engine allows them)*
- [x] **R2.6** Recommends a bundle **from the product catalogue** (only catalogue products) — S1, S3 *(S1: bundles built only from the 25 catalogue products; S3: the advisor's recommendation is the quote engine's bundle, tested to belong to the segment template)*
- [x] **R2.7** Explains **why** in plain language — S3 *(S3: a 'why' line per product (Gemini or templates, English/Hindi) mentioning current internet/tools; what was left out and why)*
- [x] **R2.8** Recommends with a **clear monthly price** (key question 2) — S2, S3 *(S2: quote; S3: recommendation card with monthly price, setup, contract, ready time; 'See my quote' opens the identical quote (tested))*
- [x] **R2.9** Never recommends an ineligible product: the rules engine decides, the LLM only explains — S1, S3 *(S3: the LLM only proposes answers (validated) and wording; a guard rejects any LLM sentence naming a product the engine did not allow, any rupee amount not computed by it, discounts, links, identifiers or the wrong language; an ineligible product's verdict is always the rules' sentence; tested with an honest and a lying fake LLM and a 2,304-answer invariant)*
- [x] **R2.10** Robust to live testing: judges run 15 advisor scenarios live (PDF p.4) → we test ≥15 varied scenarios — S3 *(S3: 21 scenarios (all 4 segments, en/hi/Hinglish, tier 1/2 + unlisted city, GSTIN active/inactive/none, quick replies, corrections, ranges, Devanagari digits, a GSTIN typed in, an ineligible product asked mid-chat) × 3 modes (no LLM, honest LLM, lying LLM) = 63 runs, all safe and identical recommendations)*
- [x] **R2.11** Works without an LLM key (deterministic fallback) so the demo cannot break — S3 *(S3: basic mode (rule-based parser in English/Hindi/Hinglish + templates); also used per message on quota (pause as Google asks), timeout, server error, bad output; tested for each failure kind and run live without a key)*

### Quote and checkout
- [x] **R2.12** A **single, transparent monthly price** — S2 *(S2: one monthly total on the quote screen, recomputed by the server on every change)*
- [x] **R2.13** **Add-ons the owner can toggle**, with the price recalculating — S2 *(S2: add-on switches; price updates live)*
- [x] **R2.14** Toggled add-ons re-checked against the rules; ineligible ones show a reason — S1, S2 *(S2: ineligible add-ons greyed out with the reason in English/Hindi; server re-checks and refuses (422))*
- [x] **R2.15** One-time setup fee and contract length shown separately and clearly — S2 *(S2: setup, contract and ready time shown separately from the monthly price)*
- [x] **R2.16** Plain-language product names (the case complains about quotes "with product codes the owner does not understand") — S2 *(S2: product names + translated descriptions and units; no product codes on screen (tested))*
- [ ] **R2.17** Checkout completes: payment (working mock, labelled) → order created — S5

### Smart KYC
- [ ] **R2.18** **Clear consent screen** shown before any KYC data is collected — S4
- [ ] **R2.19** **Document upload** — S4
- [ ] **R2.20** **Extraction** (OCR) of fields from uploaded documents — S4
- [ ] **R2.21** **Validation** of extracted fields (all checks in `solution_outline_chat/kyc-validation.md`) — S4
- [ ] **R2.22** **Mocked GSTIN lookup** API — S4
- [ ] **R2.23** **Mocked Udyam lookup** API — S4
- [ ] **R2.24** e-sign / DigiLocker-style step (working mock, labelled; key question 3) — S4

### Tracker
- [ ] **R2.25** **Order status view** the owner can check instead of calling support — S5
- [ ] **R2.26** Expected activation dates from `typical_install_days` — S5

## 3. Stretch goals (PDF p.3)

- [ ] **R3.1** Voice **or** WhatsApp front end (we plan both: WhatsApp-style simulator + voice input) — S8
- [ ] **R3.2** Back-office view for sales or partners showing **leads the advisor could not close** — S3 (records them), S7 (view) *(S3 done: 'Talk to a person' (phone + consent) and 'Not for me' (reason) save a lead with the reason, business facts, recommendation and products asked about but not available; 'could not understand' recorded when the advisor got stuck; `GET /api/advisor/leads` (phone masked); the view is S7)*
- [ ] **R3.3** Simple **propensity score** for which leads to call — S6 (model + API), S7 (shown in back-office)

## 4. Key questions (PDF p.3) — answered in the business case and shown in the prototype

- [ ] **R4.1** Q1: Which MSME segments to prioritise first, and for each a bundle with **products, price point, contract length** — `bundles-and-pricing.md`, S1, S9 *(S1 done: 4 segment bundles + Starter Lite built and priced from the catalogue)*
- [ ] **R4.2** Q2: Needs discovery without a salesperson: conversational advisor (chat **or** voice, **Hindi and regional languages**), a few questions, recommends a bundle with a clear monthly price — S3, S8, S9 *(S3 done: chat in Hindi + English, 7 questions, bundle with a clear monthly price; voice and regional languages: S8, rollout plan in S9)*
- [ ] **R4.3** Q3: Near-instant KYC (GSTIN/Udyam lookup, OCR, DigiLocker, e-sign) compliant with the **DPDP Act 2023**: **consent**, **purpose limitation**, **data minimisation** — S4, S9
- [ ] **R4.4** Q4: Role of the existing field force and channel partners so digital adds to them — `03-assisted-mode.md`, S7, S9
- [ ] **R4.5** Q5: Define **3–5 metrics** that matter, with **targets** — `metrics-and-rollout.md`, S9

## 5. Submission (PDF p.4)

- [ ] **R5.1** Working prototype: **demo video ≤ 3 minutes** — S9
- [ ] **R5.2** Working prototype: **code repository** — S0–S8
- [ ] **R5.3** **Solution architecture diagram** with the main components and data flows — S9
- [ ] **R5.4** **Business case in ≤ 10 slides** covering target customer, value, pricing or savings, rollout, risks — S9
- [ ] **R5.5** **1-page note on data privacy and security** choices — S9

## 6. Data and catalogue rules (data/raw/README.md, PDF p.4)

- [x] **R6.1** Use `product_catalogue.csv` (25 products) to power the advisor **and** the quote — S1, S2, S3 *(S3: advisor recommendations, product answers and prices all come from the catalogue via the rules engine)*
- [x] **R6.2** Rule `available_city_tiers`: product sold only in these tiers — S1
- [x] **R6.3** Rule `min_employees`: offered only at or above this size — S1
- [x] **R6.4** Rule `min_sites`: offered only at or above this number of sites — S1
- [ ] **R6.5** Rule `requires_gstin = Y`: cannot be sold without a **valid, active** GSTIN (Cancelled/Suspended blocks it) — S1, S4 *(S1 done: rule blocks none/cancelled/suspended; S4 will verify the status via the registry)*
- [x] **R6.6** Rule `requires_one_of`: needs at least one of the listed products **in the same bundle** (also enforced when the owner removes a product) — S1, S2 *(S1 + S2: removal of a needed product is blocked with 'needed by …')*
- [ ] **R6.7** `typical_install_days` used for the order tracker **and** expected activation dates — S5
- [x] **R6.8** Price within catalogue range (`price_min`–`price_max`); setup fee and minimum contract from the catalogue — S1, S2 *(S1 + S2: list price = price_min, per-unit setup, contract = max; matches all 368 past bundles)*
- [ ] **R6.9** "GSTIN lookup" API backed by `mock_gstin_registry.csv` (legal name, address, status incl. cancelled/suspended) — S4
- [ ] **R6.10** "Udyam lookup" API backed by `mock_udyam_registry.csv` — S4
- [ ] **R6.11** `smb_leads.csv` used for insights (business case) and the propensity model — S6, S9
- [ ] **R6.12** Smart KYC catches the planted problems in `kyc_documents/` (K01–K12); expected results listed in `kyc-validation.md`, one automated test per applicant — S4
- [ ] **R6.13** Real GSTIN format check with valid checksum — S4
- [ ] **R6.14** GSTIN validator **accepts `X` as the 4th PAN character** — S4
- [ ] **R6.15** Udyam district code **`00` is accepted** (it is in every record) — S4
- [ ] **R6.16** "Today" = **2026-07-15** for every date check — S4, S5
- [ ] **R6.17** Address proof no older than **90 days** (bill date ≥ 2026-04-16) — S4
- [ ] **R6.18** Never modify files in `data/raw/` — all steps

## 7. Privacy expectations (data/raw/README.md, PDF key question 3)

- [ ] **R7.1** Treat the data as real customer data — all steps
- [ ] **R7.2** Collect only what each step needs (data minimisation; lookup before upload) — S3, S4 *(S3 done: the advisor keeps only business facts (a typed GSTIN becomes 'has a GSTIN', the number is never stored); the LLM gets business facts + the message with identifiers masked; a phone is asked only for a call back, with consent, and shown masked; S4 KYC to come)*
- [ ] **R7.3** Clear consent notice **before** KYC (what, why, how long, how to withdraw) — S4
- [ ] **R7.4** Mask identifiers (GSTIN, Udyam, ID numbers) **in the UI** — S4, S5, S7
- [ ] **R7.5** Mask identifiers **in logs**; never log raw documents — S0 (logger), S4 *(S0 done: masking JSON loggers in backend + ai-service, incl. uvicorn access logs; documents/bodies never logged; tested)*
- [ ] **R7.6** Explain how long documents are retained (shown on consent screen + privacy note) — S4, S9
- [ ] **R7.7** Purpose limitation: KYC data used only for onboarding/compliance — S4, S9
- [x] **R7.8** No secrets in the repo: `.env` ignored, `.env.example` provided — S0
- [ ] **R7.9** The 1-page privacy note covers all of the above — S9

## 8. Team quality gates (from CLAUDE.md)

- [ ] **R8.1** Automated tests: rules engine, pricing (S1, S2), advisor scenarios ≥15 (S3), KYC checks + GSTIN checksum + K01–K12 (S4), tracker dates (S5), propensity model (S6) *(S1–S3 done: advisor 21 scenarios × 3 LLM modes + parser, guard, engine, API and UI tests)*
- [ ] **R8.2** Every mock (payments, e-sign, DigiLocker, WhatsApp API) works and is labelled as a mock — S4, S5, S8
- [ ] **R8.3** README "how to run" kept current after every step — S0–S9 *(S0: written)*
