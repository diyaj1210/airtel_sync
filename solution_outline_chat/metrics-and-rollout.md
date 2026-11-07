# Metrics, Targets & Rollout (Key question 5)

## The 5 metrics that matter (key question 5 asks for 3–5)
| # | Metric | Baseline (data) | Target (6 months after launch) |
|---|---|---|---|
| 1 | Lead → activation conversion (north star) | 7.4% | **12%** |
| 2 | Days lead → activation | 17.6 | **≤ 7** for self-serve bundles (micro / professional, install 2–5 days); multi-site and leased-line bundles are bound by install time (SD-WAN 14, leased line 21–30 days) → target **≤ install days + 3** |
| 3 | Blended CAC per activation | ₹15,000 | **≤ ₹8,000** |
| 4 | 6-month churn | 15% (micro 23%) | **< 10%** |
| 5 | Status-chase calls per customer | ~3 | **< 1** |

Diagnostic (tracked, not a headline metric): needs assessed → quote accepted, 44% today (biggest
leak) → 65%.

## Rough business case logic
- Same 5,000 leads/quarter at 12% → ~600 activations vs 368 (+63%).
- Self-serve & WhatsApp cut sales cost on small deals; field time moves to high-value accounts.
- Lower churn from fewer chase calls (1 call → 6% churn vs 5 calls → 28%).

## Rollout
| Phase | Scope |
|---|---|
| Pilot (0–3 months) | Professional offices, 2–3 tier-1 cities, app journey, Hindi + English |
| Phase 2 (3–6 months) | Micro retail via WhatsApp + voice, 4–5 regional languages, partner assist mode |
| Phase 3 (6–12 months) | Multi-site & manufacturers with field-assist, SD-WAN/leased-line flows, tier-2 scale-up |

## Risks & mitigations
| Risk | Mitigation |
|---|---|
| LLM recommends wrong product | Rules engine decides; LLM explains only; test suite of scenarios |
| KYC fraud / mismatched docs | Registry + checksum + cross-document checks; manual-review queue |
| Partner/field pushback | Attribution code + commission on digital closes |
| Fibre not feasible | AirFiber fallback with 2-day install |
| Data privacy breach | Masking, encryption, minimal retention, DPDP consent log |
| Micro churn | Short contracts, low starter price, proactive care via churn score |
