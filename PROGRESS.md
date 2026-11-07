# Progress

Build order and scope: [solution_outline_chat/build-plan.md](solution_outline_chat/build-plan.md).
Requirement coverage: [docs/requirements-checklist.md](docs/requirements-checklist.md).
Status values: **not started** · **in progress** · **done** (done = merged to `main` with tests passing).

| # | Branch | Status | Delivered |
|---|---|---|---|
| – | `docs/outline-verification` | done (awaiting commit + PR) | Outline checked against PDF and data README; fixes in `solution_outline_chat/`; `scripts/verify_outline.py` (all checks pass); `docs/requirements-checklist.md`; `PROGRESS.md`; `CLAUDE.md` |
| 0 | `chore/scaffold` | not started | – |
| 1 | `feature/catalogue-rules` | not started | – |
| 2 | `feature/quote` | not started | – |
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
