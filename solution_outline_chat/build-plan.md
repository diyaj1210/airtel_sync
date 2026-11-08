# Build Plan (prototype)

Build in this order — each step is one feature branch + PR. The add-on features A1, A2 and A3 share
one branch, `feature/add-ons`, at the user's request.

| # | Branch | Deliverable | Done when |
|---|---|---|---|
| 0 | `chore/scaffold` | frontend / backend / ai-service skeletons; mobile-first app shell with Hindi/English language switch; `.env.example`; README "how to run" | all three run locally; a test runner works in each |
| 1 | `feature/catalogue-rules` | Load catalogue CSV; `eligible(product, profile)` returning reasons; segment bundle templates filtered per profile; pricing helpers (monthly, per-unit setup, contract = max, install ETA = max) | unit tests pass for tier, employees, sites, GSTIN, requires_one_of; the 4 bundles + Starter Lite reproduce the totals in bundles-and-pricing.md |
| 2 | `feature/quote` | Quote API + UI: one monthly total, setup shown separately, contract length, toggle add-ons, plain-language line names (no bare product codes) | toggling an ineligible add-on shows the reason; removing a product that another line requires is blocked with a reason |
| 3 | `feature/advisor` | Chat asks type, size, locations, city, GSTIN, current tools → profile JSON → rules → bundle → explanation in the chosen language; works **without an LLM key** (deterministic fallback); "talk to a human" / not-closed leads saved with a reason for the back-office | ≥15 varied test scenarios never return an ineligible product |
| 4 | `feature/kyc` | Consent screen (DPDP), GSTIN/Udyam mock lookup APIs, upload + OCR, all checks in kyc-validation.md, masked IDs, e-sign (working mock, labelled) | K01–K12 produce the expected results in kyc-validation.md, one test each |
| 5 | `feature/tracker` | Mock payment (labelled) → order created → stages + expected date per product from `typical_install_days`; status page; stage notifications | status and expected dates visible without calling; date tests pass with today = 2026-07-15 |
| 6 | `feature/propensity` | Train model on leads (no leakage columns), `/score` API with top reasons, test AUC reported | scores shown in back-office |
| 7 | `feature/backoffice` | Leads the advisor could not close + reason, KYC exceptions queue, partner attribution, filters | demo-ready table with filters |
| 8 | `feature/whatsapp-voice` | WhatsApp-style chat simulator + voice input (reuses the same APIs) | full journey possible in chat |
| A1 | `feature/add-ons` | **One-Sitting Completion + No Dead Ends**: readiness check before any upload (states Not possible / Partner help / Needs review / Almost ready / Ready, percentage, expected time, install date from the shared timeline); blockers with an action each, kept on the application, shown in the app, the tracker and the back-office; fixes for K01-K12; save and return; one-sitting metrics | K01-K12 each give the expected state + blocker + fix (tests); no screen without a next action; card and blockers in Hindi and English |
| A2 | `feature/add-ons` | **Privacy inside the journey (DPDP)**: lookup-first screen; five-section consent listing only what is still needed, separate optional marketing; server-side consent enforcement (403); one masking utility; encrypted document storage + retention job + deletion log; My data page; `docs/privacy-note.md` | upload without consent -> 403; masking and log redaction; deletion removes the file and records the date; withdrawal blocks activation; consent lists only documents still needed |
| A3 | `feature/add-ons` | **Time-to-value quote + Day-1 value**: one shared `computeTimeline` (per-product ready date from typical_install_days, a dependent product never before its base link, bundle = latest, Day-1 products, service windows for long installs) used by the quote, the readiness check and the tracker; the quote shows name, monthly price, setup, contract (and the product that drives it, with a shorter-contract offer) and the approximate ready date, plus the value timeline and a Day-1 banner; the tracker shows planned vs actual per product | Office Pro 5 days / 12 months / Day 1 = P07 P16 P17 P20; Micro starter 3 days / 12 months (P22); Chain Connect 14 days / 24 months; Factory Connect 21 days / 24 months; dependents never before their base (tests); same dates in quote, readiness and tracker; Hindi and English |
| 9 | `docs/submission` | Architecture diagram (components + data flows), 1-page privacy & security note, business case ≤10 slides (target customer, value, pricing or savings, rollout, risks), demo video script ≤3 min | all 4 submission items ready |

## Demo video (≤ 3 min) storyline
1. 0:00 Problem in one line + funnel stat
2. 0:20 Owner chats in Hindi → bundle with "why"
3. 1:00 Toggle add-ons → one price
4. 1:20 GSTIN lookup + upload → KYC catches a bad document
5. 1:50 Tracker
6. 2:10 WhatsApp + back-office + propensity score
7. 2:40 Metrics & impact
