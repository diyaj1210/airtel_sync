# Progress

Build order and scope: [solution_outline_chat/build-plan.md](solution_outline_chat/build-plan.md).
Requirement coverage: [docs/requirements-checklist.md](docs/requirements-checklist.md).
Status values: **not started** · **in progress** · **done** (done = merged to `main` with tests passing).

| # | Branch | Status | Delivered |
|---|---|---|---|
| – | `docs/outline-verification` | done (PR #2 merged) | Outline checked against PDF and data README; fixes in `solution_outline_chat/`; `scripts/verify_outline.py` (all checks pass); `docs/requirements-checklist.md`; `PROGRESS.md`; `CLAUDE.md` |
| 0 | `chore/scaffold` | done (PR #3 merged) | `frontend/` React 19 + Vite 7 + TS mobile-first shell, English/हिंदी switch (saved on device, sets `<html lang>`), system-status card; `backend/` Express 5 + TS with `/api/health`, `/api/health/full` (checks ai-service, 503 when degraded), masking JSON logger, config validation; `ai-service/` FastAPI with `/health`, masking JSON logging incl. uvicorn access logs; `.env.example`; README "How to run". Tests: backend 44, frontend 17, ai-service 36, all passing; `npm audit` and `pip-audit` clean. |
| 1 | `feature/catalogue-rules` | done (PR #4 merged) | `backend/src/catalogue/`: CSV parser; catalogue loader with strict validation (fails fast at startup); rules engine for all 5 rules with plain-English reasons + codes; pricing (min list price, per-unit setup, contract = max, install = max, max-price range); 5 bundle templates filtered per profile with fallbacks (Factory → fibre + static IP) and add-ons with eligibility; API `GET /api/catalogue`, `GET /api/bundles/templates`, `POST /api/eligibility`, `POST /api/bundles/build`. Tests: backend 124 (80 new), incl. 1,800-profile "never ineligible" invariant and cross-checks against smb_leads.csv (same 49 rule-breaking lines as the Python script; setup + price range match all 368 bundles). |
| 2 | `feature/quote` | done (awaiting commit + PR) | Backend `src/quote/`: quote engine on top of the step-1 bundles (owner removes core products / switches add-ons on; every change re-checked by the rules engine; for every item `canToggle` + reasons such as "needed by …", rule violations, "replaced by …", last item); upgrade add-on P06 replaces P05; accepted quotes stored in memory with id `Q-XXXXXXXX`, valid 7 days from today (2026-07-15); `GET /api/cities` (22 cities + tier from smb_leads.csv); `POST /api/quote` (200 / 422 with reasons / 400), `POST /api/quotes`, `GET /api/quotes/:id`. Frontend: Home → business form (type, city, people, locations, GSTIN; validation; unknown city = tier 2) → quote screen (one monthly price, setup, contract, ready time in a sticky summary; switches; greyed-out items with reasons; 'not available' list; 6-month Lite choice for shops) → accepted screen (reference + valid-until). English + Hindi incl. product descriptions, units and reasons. Tests: backend 155 (31 new, incl. a >2,000-toggle invariant), frontend 48 (31 new; UI tests run against the real backend). |
| 3 | `feature/advisor` | not started | – |
| 4 | `feature/kyc` | not started | – |
| 5 | `feature/tracker` | not started | – |
| 6 | `feature/propensity` | not started | – |
| 7 | `feature/backoffice` | not started | – |
| 8 | `feature/whatsapp-voice` | not started | – |
| 9 | `docs/submission` | not started | – |

## Open decisions (to ask the user when the step starts)

- **Step 3 (advisor):** which LLM provider and key the user has. A no-key fallback is built either way.
- **Step 4 (KYC):** OCR engine. Tesseract is not installed on the dev machine; options are
  installing it, a pip-only engine, or a vision LLM (needs a key; the no-key path must still work).

## Log

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
