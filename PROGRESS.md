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
| 4 | `feature/kyc` | done (awaiting commit + PR) | Smart KYC. ai-service `app/kyc/`: OCR with RapidOCR 3.10 (offline, models inside the pip wheel, no Tesseract); pink watermark removed (red channel) and tilted pages straightened (text angle from the OCR boxes) before reading; fields found by page layout (label column + value, wrapped values joined, blank fields reported as blank); readable / unreadable verdict; `POST /kyc/read` (image body, 8 MB limit, logs only type, outcome, time). Backend `src/kyc/`: GSTIN validator (format, state code, PAN holder type incl. `X`, mod-36 checksum) and Udyam validator (district `00` accepted), positional O/0 and I/1 OCR fix; MOCK registries from the CSVs; all checks 1-11 of kyc-validation.md as a pure function with today injected (Pass / Fix needed / Manual review, fixes before review, soft warnings); fuzzy name/address matching; cases in memory with consent version + date and purposes, withdraw = delete; lookup first, so certificates are needed only when the lookup fails; a cancelled/suspended GSTIN lists the quote's GSTIN-only products as blocked; MOCK e-sign (OTP shown on screen, 5 tries, 10-minute expiry, SHA-256 of the agreement, case locked after signing); MOCK lookup APIs; DEMO sample applicants K01-K12; identifiers masked in every response. Frontend: KYC flow (consent with what / why / how / how long / withdraw, business details with live GSTIN checksum, MOCK registry card, per-document upload with masked read-back, result with reasons, MOCK e-sign, done, withdraw consent on every screen), English + Hindi; entry from the accepted quote and from Home. Tests: backend 485 (84 new: K01-K12 one each, edge cases, validators on every registry record, API incl. privacy of responses and logs), frontend 72 (10 new, real backend with the recorded OCR), ai-service 119 (34 new incl. real OCR on all 47 images, one test per applicant). |
| 5 | `feature/tracker` | not started | – |
| 6 | `feature/propensity` | not started | – |
| 7 | `feature/backoffice` | not started | – |
| 8 | `feature/whatsapp-voice` | not started | – |
| 9 | `docs/submission` | not started | – |

## Open decisions (to ask the user when the step starts)

- None open. (Step 4's OCR engine: the user chose RapidOCR after a test on all 47 sample images.)

## Log

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
