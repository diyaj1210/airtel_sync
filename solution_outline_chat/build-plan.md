# Build Plan (prototype)

Build in this order — each step is one feature branch + PR.

| # | Branch | Deliverable | Done when |
|---|---|---|---|
| 0 | `chore/scaffold` | frontend / backend / ai-service skeletons, README, CLAUDE.md | all three run locally |
| 1 | `feature/catalogue-rules` | Load catalogue CSV; `eligible(product, profile)`; segment bundle templates | unit tests pass for tier, employees, sites, GSTIN, requires_one_of |
| 2 | `feature/quote` | Quote API + UI: monthly total, setup, contract, toggle add-ons | toggling invalid add-on shows reason |
| 3 | `feature/advisor` | LLM chat → profile JSON → rules → bundle → explanation; language switch | 15 self-made test scenarios never give ineligible products |
| 4 | `feature/kyc` | Consent screen, GSTIN/Udyam mock APIs, upload + OCR, all checks in kyc-validation.md | K01–K12 produce expected results |
| 5 | `feature/tracker` | Order stages + ETA from install days, status page | status updates visible without calling |
| 6 | `feature/propensity` | Train model on leads, `/score` API, AUC reported | scores shown in back-office |
| 7 | `feature/backoffice` | Unclosed leads queue, KYC exceptions, partner attribution | demo-ready table with filters |
| 8 | `feature/whatsapp-voice` | WhatsApp-style chat simulator + voice input | full journey possible in chat |
| 9 | `docs/submission` | Architecture diagram, privacy note, business case (≤10 slides), demo video script | all 4 submission items ready |

## Demo video (≤ 3 min) storyline
1. 0:00 Problem in one line + funnel stat
2. 0:20 Owner chats in Hindi → bundle with "why"
3. 1:00 Toggle add-ons → one price
4. 1:20 GSTIN lookup + upload → KYC catches a bad document
5. 1:50 Tracker
6. 2:10 WhatsApp + back-office + propensity score
7. 2:40 Metrics & impact
