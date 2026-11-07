# Solution 1 – Self-Serve App Journey (core platform)

**Idea:** An "Udyam Digital" journey inside the business app / mobile web. Advisor → one-price quote →
eKYC → live tracker. One bill, one support number (like Airtel Black for businesses).

## User flow
1. **Language pick** (Hindi, English, Marathi, Tamil, Telugu, Kannada, Gujarati, Bengali, Punjabi, Malayalam)
2. **Advisor chat** – 6–7 questions (PDF: type, size, locations, current tools):
   - What kind of business? · How many people work there? · How many locations?
   - City? (→ city tier) · Do you have a GSTIN? (→ GSTIN-only products)
   - Current tools: what internet do you use today, and do you use billing/POS, business email,
     CCTV, a customer WhatsApp/SMS channel? (→ which needs to cover, what to replace)
3. **Recommendation** – bundle card with a "why this" line per product, in plain language
4. **Quote & checkout** – one monthly price, setup fee shown separately, toggle add-ons,
   contract length; price recalculates live; invalid add-ons are greyed out with a reason
5. **Smart KYC** – consent screen → enter GSTIN → details auto-filled from registry →
   upload only missing docs → OCR + validation → e-sign (mocked)
6. **Payment** (working mock, clearly labelled "MOCK") → order created
7. **Tracker** – stage timeline with expected dates from `typical_install_days`, alerts at each stage

## How it is implemented
| Part | Implementation |
|---|---|
| Advisor | LLM conversation (ai-service) extracts a structured profile JSON → backend rules engine returns eligible products → bundle templates per segment → LLM writes the explanation |
| Rules engine | Pure function: `eligible(product, profile)` checks city tier, min employees, min sites, GSTIN, `requires_one_of`. Unit-tested. |
| Quote | Backend computes monthly total (use catalogue min price as list price), setup total, contract months; add-on toggles re-run the rules engine |
| KYC | See kyc-validation.md |
| Tracker | Order stages (KYC and payment happen before the order exists): KYC verified → Payment received / order placed → Installation scheduled → Installed → Activated. Expected date per product line = order date + its `typical_install_days` (SIMs day 1, fibre day 5, …); bundle ETA = max of those. "Today" = 2026-07-15 for demo dates. |

## Fallbacks
- No GSTIN → show only non-GSTIN products + "add GSTIN later to unlock WhatsApp API, SMS, leased line".
- Fibre not feasible → swap P01/P02 for **P04 5G AirFiber** (2-day install).
- Advisor can't decide / customer asks for a human → lead goes to back-office queue (Solution 3).
