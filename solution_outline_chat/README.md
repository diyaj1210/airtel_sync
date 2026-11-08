# Solution Outline – Project Udyam Digital

Airtel SYNC YTL Hackathon 2026 · Enterprise Track A
Fictional operator in the case: **Accel Telecom / Accel Business** (stands in for Airtel / Airtel Business)

## Problem in one line
Let a small business owner discover the right bundle, buy it and get it activated with minimal
human effort — on a phone, in their preferred language.

## Our approach: one platform, four solutions
We build **one shared backend** and put several front doors and operating modes on top of it.

| # | Solution | What it fixes | File |
|---|---|---|---|
| 1 | **Self-serve app journey** (core) | Slow, confusing quotes; paper KYC; status chasing | [01-self-serve-app.md](01-self-serve-app.md) |
| 2 | **WhatsApp & voice, vernacular** | Micro owners who won't download an app | [02-whatsapp-voice.md](02-whatsapp-voice.md) |
| 3 | **Partner & field assist mode** | Digital competing with field force / partners | [03-assisted-mode.md](03-assisted-mode.md) |
| 4 | **Propensity scoring & base upsell** | High CAC, calling the wrong leads | [04-propensity-upsell.md](04-propensity-upsell.md) |

Supporting documents:
- [data-insights.md](data-insights.md) – what the leads data tells us (the "why")
- [bundles-and-pricing.md](bundles-and-pricing.md) – segment bundles built from the catalogue
- [kyc-validation.md](kyc-validation.md) – Smart KYC checks and the planted problems in K01–K12
- [architecture.md](architecture.md) – components, data flow, tech stack
- [metrics-and-rollout.md](metrics-and-rollout.md) – KPIs, targets, phased rollout
- [build-plan.md](build-plan.md) – module-by-module build order for the prototype
- [05-one-sitting-and-privacy.md](05-one-sitting-and-privacy.md) – add-ons: One-Sitting Completion + No Dead Ends, privacy inside the journey

## Mapping to what the judges asked for

| Requirement | Covered by |
|---|---|
| Advisor (GenAI, recommends bundle, explains why) | Solution 1 + 2 |
| Quote & checkout (one monthly price, toggle add-ons) | Solution 1 |
| Smart KYC (OCR, validation, GSTIN/Udyam lookup, consent) | Solution 1 + kyc-validation.md |
| Tracker (order status without calling) | Solution 1 + 2 |
| Stretch: voice / WhatsApp front end | Solution 2 |
| Stretch: back-office view of unclosed leads | Solution 3 |
| Stretch: propensity score | Solution 4 |
| Key Q1 segments & bundles | bundles-and-pricing.md |
| Key Q2 needs discovery without salesperson | Solution 1 + 2 |
| Key Q3 near-instant, DPDP-compliant KYC | kyc-validation.md + architecture.md + 05-one-sitting-and-privacy.md |
| Key Q4 role of field force & partners | Solution 3 |
| Key Q5 metrics & targets (3–5 metrics) | metrics-and-rollout.md |

The full requirement-by-requirement checklist, mapped to build steps, is in
[../docs/requirements-checklist.md](../docs/requirements-checklist.md). The numbers and bundles
in this outline are checked by `python scripts/verify_outline.py`.

## Submission checklist
- [ ] Working prototype + demo video (max 3 min) + code repo
- [ ] Solution architecture diagram
- [ ] Business case, max 10 slides (SYNC template): target customer, value, pricing or savings, rollout, risks
- [ ] 1-page data privacy & security note

## Golden rule for the advisor
**The rules engine decides eligibility. The LLM only explains.**
The judges run 15 live advisor scenarios — the advisor must never recommend a product that breaks a
catalogue rule (city tier, min employees, min sites, GSTIN, required companion product).
