# Solution 4 – Propensity Scoring & Base Upsell

**Idea:** Decide who to contact and how before anyone picks up a phone. Lower CAC.

## Propensity model
- **Training data**: `smb_leads.csv`, target = `outcome == Activated`
- **Features**: segment, business_type, lead_source, city_tier, has_gstin, has_udyam,
  employee_count, num_sites, annual_turnover_band, current_internet, current_provider,
  monthly_telecom_spend_inr, number of products_of_interest, preferred_language
- **Do not use** post-outcome columns → leakage: stage_reached, outcome, drop_reason, all stage
  dates, days_lead_to_activation, customer_follow_up_calls, bundle_products,
  monthly_bundle_value_inr, one_time_setup_inr, contract_months, churned_within_6_months,
  nps_score, and acquisition_cost_inr (cost grows as the lead moves down the funnel)
- **Validation**: stratified train/test split (368 positives out of 5,000); report test AUC
- **Model**: logistic regression (explainable) + gradient boosting for comparison; report AUC
- **Output**: score 0–100 + top 3 reasons (feature contributions)

## Routing rules
| Score | Action |
|---|---|
| High (top 20%) | Call within 24h (field/partner) |
| Medium | WhatsApp nudge to self-serve journey |
| Low | Automated nurture only |

## Churn guardrail (bonus)
Small churn score on activated leads (segment, follow-up calls, days to activate) → flag at-risk
customers for proactive care.

## Base upsell
- 1,505 leads are existing **Accel (mobile only)** customers → pre-filled journey
  (KYC already on file) with a fibre + business bundle offer.

## How it is implemented
- `ai-service/ml/train_propensity.py` → saves model file
- API `POST /score` returns score + reasons; back-office shows it
- Notebook/report in `scripts/` with funnel analysis charts for the business case
