# Progress

Build order and scope: [solution_outline_chat/build-plan.md](solution_outline_chat/build-plan.md).
Requirement coverage: [docs/requirements-checklist.md](docs/requirements-checklist.md).
Status values: **not started** · **in progress** · **done** (done = merged to `main` with tests passing).

| # | Branch | Status | Delivered |
|---|---|---|---|
| – | `docs/outline-verification` | done (PR #2 merged) | Outline checked against PDF and data README; fixes in `solution_outline_chat/`; `scripts/verify_outline.py` (all checks pass); `docs/requirements-checklist.md`; `PROGRESS.md`; `CLAUDE.md` |
| 0 | `chore/scaffold` | done (PR #3 merged) | `frontend/` React 19 + Vite 7 + TS mobile-first shell, English/हिंदी switch (saved on device, sets `<html lang>`), system-status card; `backend/` Express 5 + TS with `/api/health`, `/api/health/full` (checks ai-service, 503 when degraded), masking JSON logger, config validation; `ai-service/` FastAPI with `/health`, masking JSON logging incl. uvicorn access logs; `.env.example`; README "How to run". Tests: backend 44, frontend 17, ai-service 36, all passing; `npm audit` and `pip-audit` clean. |
| 1 | `feature/catalogue-rules` | done (PR #4 merged) | `backend/src/catalogue/`: CSV parser; catalogue loader with strict validation (fails fast at startup); rules engine for all 5 rules with plain-English reasons + codes; pricing (min list price, per-unit setup, contract = max, install = max, max-price range); 5 bundle templates filtered per profile with fallbacks (Factory → fibre + static IP) and add-ons with eligibility; API `GET /api/catalogue`, `GET /api/bundles/templates`, `POST /api/eligibility`, `POST /api/bundles/build`. Tests: backend 124 (80 new), incl. 1,800-profile "never ineligible" invariant and cross-checks against smb_leads.csv (same 49 rule-breaking lines as the Python script; setup + price range match all 368 bundles). |
| 2 | `feature/quote` | done (PR #5 merged) | Backend `src/quote/`: quote engine on top of the step-1 bundles (owner removes core products / switches add-ons on; every change re-checked by the rules engine; for every item `canToggle` + reasons such as "needed by …", rule violations, "replaced by …", last item); upgrade add-on P06 replaces P05; accepted quotes stored in memory with id `Q-XXXXXXXX`, valid 7 days from today (2026-07-15); `GET /api/cities` (22 cities + tier from smb_leads.csv); `POST /api/quote` (200 / 422 with reasons / 400), `POST /api/quotes`, `GET /api/quotes/:id`. Frontend: Home → business form (type, city, people, locations, GSTIN; validation; unknown city = tier 2) → quote screen (one monthly price, setup, contract, ready time in a sticky summary; switches; greyed-out items with reasons; 'not available' list; 6-month Lite choice for shops) → accepted screen (reference + valid-until). English + Hindi incl. product descriptions, units and reasons. Tests: backend 155 (31 new, incl. a >2,000-toggle invariant), frontend 48 (31 new; UI tests run against the real backend). |
| 3 | `feature/advisor` | done (PR #6 merged) | Backend `src/advisor/`: chat engine (7 questions: type, people, locations, city, GSTIN, current internet, tools; quick replies incl. city list and tools multi-select; corrections re-recommend; 'start again'); rule-based understanding in English/Hindi/Hinglish (no-key basic mode and safety net); recommendation = quote engine bundle + add-ons for tool gaps that the rules allow; 'why' per product; product questions answered with the rules' verdict + product cards; guard on every LLM sentence (allowed products, engine-computed amounts only, no offers/links/identifiers, right language); LLM pause on quota/timeouts; leads not closed (`AL-XXXXXXXX`, reason, masked phone with consent); API `/api/advisor/status`, `/sessions`, `/messages`, `/lead`, `/leads`. ai-service: Gemini via `google-genai` 2.33.0 (`/advisor/status`, `/understand`, `/explain`, JSON-schema output, identifiers masked before sending, errors → 503/504/502 kinds, logs without prompts or key); config `GEMINI_API_KEY`, `GEMINI_MODEL` (default `gemini-3.5-flash-lite`), `GEMINI_TIMEOUT_SECONDS`. Frontend: advisor chat screen (AI/basic badge, 'AI' label on Gemini sentences, recommendation card → same quote, product cards, call-back and 'not for me' forms), English + Hindi. Tests: backend 401 (246 new: 21 scenarios × 3 LLM modes, 2,304-answer invariant, parser, guard, engine, LLM client, leads, API), frontend 62 (14 new, against the real backend), ai-service 85 (49 new, fake Gemini). |
| 4 | `feature/kyc` | done (PR #7 merged) | Smart KYC. ai-service `app/kyc/`: OCR with RapidOCR 3.10 (offline, models inside the pip wheel, no Tesseract); pink watermark removed (red channel) and tilted pages straightened (text angle from the OCR boxes) before reading; fields found by page layout (label column + value, wrapped values joined, blank fields reported as blank); readable / unreadable verdict; `POST /kyc/read` (image body, 8 MB limit, logs only type, outcome, time). Backend `src/kyc/`: GSTIN validator (format, state code, PAN holder type incl. `X`, mod-36 checksum) and Udyam validator (district `00` accepted), positional O/0 and I/1 OCR fix; MOCK registries from the CSVs; all checks 1-11 of kyc-validation.md as a pure function with today injected (Pass / Fix needed / Manual review, fixes before review, soft warnings); fuzzy name/address matching; cases in memory with consent version + date and purposes, withdraw = delete; lookup first, so certificates are needed only when the lookup fails; a cancelled/suspended GSTIN lists the quote's GSTIN-only products as blocked; MOCK e-sign (OTP shown on screen, 5 tries, 10-minute expiry, SHA-256 of the agreement, case locked after signing); MOCK lookup APIs; DEMO sample applicants K01-K12; identifiers masked in every response. Frontend: KYC flow (consent with what / why / how / how long / withdraw, business details with live GSTIN checksum, MOCK registry card, per-document upload with masked read-back, result with reasons, MOCK e-sign, done, withdraw consent on every screen), English + Hindi; entry from the accepted quote and from Home. Tests: backend 485 (84 new: K01-K12 one each, edge cases, validators on every registry record, API incl. privacy of responses and logs), frontend 72 (10 new, real backend with the recorded OCR), ai-service 119 (34 new incl. real OCR on all 47 images, one test per applicant). |
| 5 | `feature/tracker` | done (PR #8 merged) | Backend `src/orders/`: checkout (due now = setup + first month; refused before a signed KYC, without a quote, when the quote expired or has GSTIN-only products the business cannot have, or when already paid); MOCK payment (method only, no card / UPI details; MOCK failure switch -> 402, no order); order `ORD-XXXXXXXX` (one per KYC case, no personal data); tracker as pure functions: per-product expected date = order date + typical_install_days, bundle ready = the slowest, stages KYC verified -> order placed -> installation scheduled (next day) -> installed -> activated, an update per stage; MOCK advance (next stage on its expected date). API `GET /api/orders/checkout/:caseId`, `POST /api/orders`, `GET /api/orders/:id`, `POST /api/orders/:id/advance`; the KYC case shows its order id. Frontend: 'Pay and place my order' after e-sign, MOCK payment screen, tracker (ready-by date, now / next, timeline, per-product dates, updates, MOCK advance), Home -> 'Track my order' by reference; English + Hindi. Tests: backend 503 (18 new: dates per bundle incl. month boundaries, a 240-profile invariant, store, API incl. no personal data), frontend 76 (4 new: whole journey quote -> KYC -> failed + good payment -> activated, tracking by reference, Hindi). |
| 6 | `feature/propensity` | done (PR #9 merged) | ai-service `app/propensity/`: features = only what is known when a lead arrives (segment, business type, source, city tier, GSTIN, Udyam, turnover band, current internet and provider, language, employees, sites, telecom spend, number of products asked about); the 17 leakage columns (stage, outcome, drop reason, stage dates, days, follow-up calls, what was bought, value, setup, contract, churn, NPS, acquisition cost) never read into the model. Training `python -m app.propensity.train`: stratified 80/20 split (seed 42), logistic regression with C chosen by 5-fold CV on the training part, gradient boosting for comparison; writes `ai-service/models/propensity.json` (coefficients, no pickle) and `docs/propensity-report.md`. Results: test AUC 0.670 (gradient boosting 0.669), CV AUC 0.724 ± 0.030, top 20% of leads hold 32% of activations (12.0% vs 7.4%); acquisition cost alone would score 0.902 (why it is excluded). Scoring needs no scikit-learn: score 0-100 = percentile among the 5,000 leads, bands high ≥ 80 (call within 24 h) / medium ≥ 40 (WhatsApp nudge) / low (nurture), top 3 reasons = exact contributions against an average lead; missing inputs count as average; unknown or leakage inputs refused. Endpoints `/propensity/model`, `/propensity/score` (1-500), `/propensity/leads/{id}`; backend `/api/propensity/*` validates requests and the answers. Tests: ai-service 140 (21 new), backend 515 (12 new). |
| 7 | `feature/backoffice` | done (PR #10 merged) | Backend `src/backoffice/`: MOCK staff directory (operations desk ADM-01, field sales SLS-01/02, channel partners PTR-01/02) and MOCK sign-in (random token in memory, 8 hours, never logged); roles: partners see only what they referred, KYC exceptions only for the operations desk (purpose limitation). Partner attribution: `attributionCode` on the advisor chat, the accepted quote, the KYC case (inherited from the quote) and the order; public `GET /api/partners/:code` for the app's referral banner. Endpoints: advisor leads with reason, masked phone, attribution, propensity score + next action + top reasons, follow-up (status, owner); past-quarter dropped leads from smb_leads.csv (4,632, no GSTIN / Udyam numbers) by score, 25 a page; KYC exceptions queue (needs review / waiting for owner / approved / rejected) with approve / reject (a note is required to reject and shown to the owner; the decision applies only to the problems seen and lapses when they change; it never unlocks Active-GSTIN products); attribution summary (leads, quotes, KYC, orders, monthly value). All lists filterable. The public `GET /api/advisor/leads` from step 3 is removed (leads are now behind the sign-in). ai-service: `GET /propensity/leads` (every data lead's score). Frontend: `/backoffice` (sign-in, tabs per role, filter bars, tables that become cards on a phone, follow-up selects, KYC decision form, referral link), Home referral banner from `?ref=`, owner sees an approval or rejection note; English + Hindi. Tests: backend 543 (28 new), frontend 84 (8 new), ai-service 141 (1 new). |
| 8 | `feature/whatsapp-voice` | done (PR #11 merged) | Backend `src/channels/`: MOCK WhatsApp Business webhook (`POST /api/channels/whatsapp/messages` with `{ text, voice? }` or `{ buttonId }`, `POST /api/channels/whatsapp/photo`; the number in the `x-wa-from` header, never logged or echoed). A bot keeps one conversation per number (in memory, 24 h) and runs the whole journey in chat: Hi (a partner code in it is the referral) → language → the advisor's questions as reply buttons / list messages → bundle card → Buy (the quote engine recomputes the price) → consent (the app's what / why / how / how long text; type stop to withdraw) → name, GSTIN (checksum) and Udyam, or a DEMO sample → MOCK registry lookup → a photo for each document still needed, read by OCR → the checks' result with what to do → MOCK e-sign (OTP in the chat) → MOCK UPI payment → tracker with MOCK next stage; commands status, help, restart, person (call back on this number only after a yes), English / हिंदी, stop (deletes the KYC case and the chat). Every decision is made by the same code as the app (advisor engine, buildQuote, parseBusiness, evaluateCase incl. reviewer decisions, verifyEsign, checkout, order store); the bot's wording for KYC problems, documents, consent, results, payment blocks and stages is generated from the app's (`scripts/sync-channel-text.ts`, parity test). Frontend: Home → Try it on WhatsApp: WhatsApp-style simulator (number, chat bubbles with *bold* / _italic_, buttons, lists, 📎 photos, DEMO sample photos, 🔊 read aloud); 🎤 voice input (Web Speech API, en-IN / hi-IN, hidden when unsupported, errors explained, privacy note) in the simulator and on the advisor chat; English + Hindi. Tests: backend 551 (8 new), frontend 92 (8 new). |
| A1 | `feature/add-ons` | done (PR pending merge) | One-Sitting Completion + No Dead Ends. Backend `src/readiness/`: pure readiness check (states by precedence, percentage over business / GSTIN / signatory / address / feasibility, expected minutes, install date from the shared `computeTimeline`, found items, documents still needed), blockers with an action each (bilingual messages; KYC problems use the app's own wording), kept on the case (`sync.ts`: resolved by the owner/system = auto, by a reviewer's approval = staff), alternatives built by the quote engine (bundle without GSTIN-only products, 5G AirFiber bundle where the MOCK coverage check finds no fibre (Bhopal, Patna), re-quote), partner assistance (leased line, SD-WAN, 3+ sites, > Rs 10,000, install 14+ days). KYC checks: Udyam optional (warnings only), cancelled GSTIN blocks only GSTIN-only products, "Did you mean ...?" (`kyc/suggest.ts`, O/0 I/1 I/J look-alikes, name must match), owner authorisation by MOCK signing link (K10), owner answers to review questions (K07). API: lookup preview, resume, alternative, gstin-suggestion, authorisation, answers; tracker shows the open blockers; back-office queue shows readiness + blockers; metrics. Frontend: readiness card with a button per fix, blocker history, Home -> Continue my application, tracker items. |
| A2 | `feature/add-ons` | done (PR pending merge) | Privacy inside the journey. Lookup-first screen before consent; consent v2 in five sections listing only the documents still needed, five separate purposes, separate unticked marketing consent; consent record (id, version, purposes, language, channel, time) enforced by the server (403 after withdrawal); one masking format (`masking.ts`, also ai-service) GSTIN 4 + 3, Udyam / ID / phone last 4; photos encrypted with AES-256-GCM (`privacy/vault.ts`, key `DOCUMENT_ENCRYPTION_KEY`, folder `backend/var/documents` git-ignored), operations-desk-only viewing (logged); retention config marked proposed (`privacy/retention.ts`), retention job every 6 h + manual DEMO trigger, deletion log; My data page (holdings masked, purposes, deletion countdown, delete documents, cancel, withdraw, "Deleted on"); withdrawal stops an order before activation; information card before each upload; WhatsApp consent recorded with channel `whatsapp`; `docs/privacy-note.md`. Tests (both add-ons): backend 584 (33 new), frontend 101 (17 new or rewritten for the new order). |
| 9 | `docs/submission` | not started | – |

## Open decisions (to ask the user when the step starts)

- None open. (Step 4's OCR engine: the user chose RapidOCR after a test on all 47 sample images.)

## Log

- **2026-11-08**: Add-ons A1 + A2 on one branch (`feature/add-ons`, at the user's request; the
  user said to choose what is best). Decisions: (1) the KYC flow is now lookup first: business
  identifiers and the public registry lookup before consent, nothing stored until consent, then the
  name; (2) document photos are stored encrypted for 30 days after verification (the feature asks
  for encrypted storage and back-office access; before, they were never stored), deleted at once on
  request or withdrawal; without `DOCUMENT_ENCRYPTION_KEY` a random key is used for that run;
  (3) Udyam is optional everywhere: Udyam problems are caught and shown as warnings, never
  blocking (kyc-validation.md expected results updated for K01, K05, K06, K10); (4) a cancelled /
  suspended GSTIN no longer sends a case to manual review on its own: it blocks only the GSTIN-only
  products (checkout already refused them), and the owner is offered the bundle without them;
  (5) MOCK coverage: no wired internet in Bhopal and Patna (no sample uses them), AirFiber bundle
  offered; (6) an unreadable document is an owner fix (re-upload with tips), not a review;
  (7) without a quote the state describes KYC only and "get a quote" stays as the next action;
  (8) one sitting = paid within 60 minutes of consent without resuming. Withdrawal keeps a record
  of the case (consent record + deletion log) instead of removing it, so the owner can see when
  deletion happened. Verified: backend 584 / frontend 101 / ai-service 141 tests, builds, audits,
  a live run with the real OCR (K06 lookup 60% -> uploads -> "Did you mean 08YK********1ZO" ->
  confirm -> Ready 100%; K10 owner link -> Ready; photos encrypted on disk, deleted on request;
  upload after withdrawal 403). Not done: real coverage API, real staff login, a database.

- **2026-11-08**: Step 8 WhatsApp and voice. Choices: the bot lives in the backend behind a
  MOCK webhook (as a real WhatsApp Business integration would) and calls the same modules
  in-process; the simulator only plays the phone. Only the documents the checks still need are
  asked for (lookup first, as in the app), so for K07 the tampered GST certificate is never
  requested when the registry lookup succeeds; K10 is the manual-review example in chat.
  Voice uses the browser's speech recognition; the screen says Chrome / Edge send the audio to
  their speech service, and only the words reach our backend. Verified: backend 551 / frontend
  92 tests, builds, audits clean, and a live run in Hindi with the real OCR (Hi PTR-02 → voice
  message → Office Pro ₹4,215/month → K03 photos read in 5.4 / 0.9 / 1.8 s → pass → OTP → ₹5,715
  paid → ready 20 July 2026 → activated → stop); the backend log had no phone, OTP or message
  text. Not done: a real WhatsApp / Twilio connection (needs Meta business verification), add-on
  switches inside the chat (the bundle is bought as recommended; the app has the switches),
  regional languages beyond Hindi (S9 rollout plan).

- **2026-11-08**: Step 7 back-office. Choices made without asking (the user said to go ahead):
  MOCK sign-in with demo accounts and no password; KYC exceptions visible to the operations desk
  only; the past quarter's dropped leads from smb_leads.csv shown as a call-back list next to the
  live advisor leads (marked as in-sample for the model); a reviewer can approve or reject only
  manual-review cases (fix-needed cases stay with the owner). Advisor leads are scored from what
  the advisor knows (segment, business type, city tier, GSTIN, current internet, language,
  people, locations, and the source from the referral code); the rest counts as average. The
  step-3 public leads list was removed for privacy. Verified: backend 543 / frontend 84 /
  ai-service 141 tests, builds, audits clean, a live run with the real model (advisor leads 51 and
  49 medium, past quarter 4,632 with the top at 99, K07 approved then signed and paid, credited to
  PTR-01; the backend log had no phone, token or GSTIN). Not done here: assist mode sending the
  quote to the owner's phone by WhatsApp (step 8); commission amounts (no rate in the data).

- **2026-11-08**: Step 6 propensity. The test AUC is modest (0.670) and gradient boosting does
  no better (0.669), so the limit is the signal in the data, not the model; the report says so.
  Regularisation was chosen by cross-validation on the training part only (the test set was used
  once); dropping `business_type` or `preferred_language` changed CV AUC by less than its noise,
  so the outline's full feature list stays. The model is saved as JSON coefficients instead of a
  pickle (no code runs when it is loaded, no scikit-learn needed to score). Verified: backend 515 /
  frontend 76 / ai-service 140 tests, typecheck + build, live calls through the backend (model card,
  L00001 = 65 medium with reasons, strong vs weak lead 99 vs 1, a leakage input refused with 422).
  Out of scope: showing scores to sales (step 7 back-office); scoring the leads the advisor saves
  (they lack the lead source and turnover; missing inputs count as average) is wired in step 7.

- **2026-11-08**: Step 5 tracker. Choices: the demo moves an order forward with a labelled MOCK
  button (the stage happens on its expected date); updates are shown in the app (WhatsApp in
  step 8); payment due at order = setup + first month. Verified: typecheck + build, backend 503 /
  frontend 76 / ai-service 119 tests, `verify_outline.py` passing, and a live run of all three
  services (real OCR for the KYC) for Office Pro, Chain Connect and Factory Connect: MOCK
  failure 402, payment 201, ready 20 July / 29 July / 5 August 2026 = the quotes' 5 / 14 / 21
  days, activation after three MOCK steps; no names or identifiers in the logs. The user asked
  me to commit, push, open and merge the PR myself for this step and to start step 6. Out of
  scope, for later: delays and the AirFiber fallback when fibre is not feasible (not in the
  build plan), WhatsApp notifications (step 8).

- **2026-11-08**: Step 4 KYC. OCR decision: the user picked RapidOCR over Tesseract (needs a
  separate Windows install on every machine) and Gemini vision (sends customer documents to
  Google, may "correct" the very errors KYC must catch, quota). Test before building: without
  preprocessing RapidOCR missed the monospaced GSTIN / Udyam values that cross the pink
  watermark; with the red-channel cleanup all 46 readable images were read correctly, and K04's
  blurred certificate came out as low-confidence garbage, as it should. Verified: typecheck +
  build (backend, frontend), backend 485 / frontend 72 / ai-service 119 tests,
  `verify_outline.py` passing, and a live run of all three services through the Vite proxy with
  the real OCR: all 12 applicants gave the expected result of kyc-validation.md (1-2 s per page,
  4.5 s for K02's tilted certificate); the 261 log lines of that run held no identifier, name or
  address. Decisions: a fix the owner can make is reported before a manual review (all issues are
  listed either way); before "Check my documents" missing documents show as "in progress", after
  it as "fix needed"; when a Udyam certificate is uploaded the number on it is looked up (the
  owner can also type the number instead: K05). Out of scope, for later steps: the KYC exceptions
  queue for reviewers (step 7); payment after e-sign and the tracker (step 5); the privacy note
  (step 9).

- **2026-11-08**: Step 3 advisor. LLM decision: the user chose Gemini (free plan); key in the
  user's own `.env`, never committed. Model measured live: `gemini-3.8-flash` answered in 25–45 s
  on the free plan, `gemini-3.5-flash-lite` in 1.5–3.5 s, so Flash-Lite is the default (one line
  in `.env` to change). To save quota and time, short plain answers and quick replies skip the
  LLM. Verified: typecheck (backend, frontend), backend 401 / frontend 62 / ai-service 85 tests,
  `pip-audit` clean, `verify_outline.py` passing, live runs of all three services through the
  Vite proxy: English and Hindi chats with Gemini (free-form messages understood, off-topic
  questions politely redirected, ineligible SD-WAN answered with the rules' verdict) and the same
  chats with no key (basic mode, same recommendations). One live Gemini call returned a one-off
  server error; the advisor answered by rules and now retries Gemini after 10 s (quota errors
  pause for Google's retry time). Out of scope, for later steps: regional languages beyond Hindi
  and voice (step 8); the back-office leads view (step 7); verifying the self-declared GSTIN
  status against the registry (step 4, done).

- **2026-11-08**: Step 2 quote. Verified: typecheck + build (backend, frontend), backend 155 / frontend 48 / ai-service 36 tests, mutation check (disabling the 'needed by' rule fails 3 tests incl. the invariant), live run of all three services with quote / refuse / accept through the Vite proxy. Branch-keeping rule added to CLAUDE.md (no `--delete-branch`); the user restores the deleted step branches on GitHub from their PR head commits. Checkout payment (mock) and order creation stay in step 5 as planned; the accepted quote reference is what step 4/5 will build on.

- **2026-11-08**: Step 1 catalogue rules. Verified: typecheck, 124 backend tests (two planted
  bugs in the rules engine were each caught by 12–13 tests), backend build, live API calls,
  frontend/ai-service tests unchanged and passing, `verify_outline.py` passing.
  Design notes for later steps: `gstin: "active"` is self-declared until KYC (step 4) checks the
  registry; the Factory Connect P06 upgrade is an add-on that `replaces` P05 (step 2 applies it).
  Ideas raised but not yet in the plan (user to decide): compliance replay of past sales,
  drop-off recovery by stage, churn guardrail, partner attribution (steps 6–7).

- **2026-11-08**: Step 0 scaffold. Verified: dependency install from scratch, typecheck, all
  tests, frontend production build, backend production build, all three services running
  together (frontend → Vite proxy → backend → ai-service), degraded paths (ai-service down →
  503 "degraded"; backend down → UI shows "Not reachable"), and masked identifiers in live logs.
  Dependency notes: Vitest 4.1.12 and Vite 7.3.7 chosen because older versions have published
  advisories; `.npmrc` `legacy-peer-deps=true` works around an npm 10.9 crash on Vitest 4's
  optional peers; Python tests use `httpx2` (Starlette 1.x prefers it).

- **2026-11-08**: Outline verification (pre-step). All numbers and bundles reproduced by
  `python scripts/verify_outline.py` (ALL CHECKS PASSED). Outline fixes:
  - bundles: Dukaan Starter contract 6 → 12 months (P22 has a 12-month minimum), new 6-month
    Starter Lite (₹1,198); add-on setup fees added; install ETAs added; per-profile fallbacks for
    Chain/Factory; "10% bundle discount" replaced by waived/spread setup (stay within price range).
  - KYC: K01–K12 table verified against registries and leads, expected result per applicant,
    K07 described precisely (cert ≠ registry legal name), OCR traps (letter O in real GSTINs,
    wrapped addresses), Udyam date/activity mismatches confirmed as soft warnings.
  - metrics: 6 metrics → 5 (PDF asks 3–5); time-to-activate target qualified by install days.
  - advisor asks about "current tools" (PDF); tracker stages put KYC/payment before the order.
  - build plan: mock payment, e-sign, no-key LLM fallback, unclosed-lead capture, i18n shell,
    business-case contents assigned to steps.
  - small number fixes: GSTIN 9.6% vs 2.0%; hotspot 5% / none 4%; field deal size wording;
    full leakage-column list for the propensity model.
