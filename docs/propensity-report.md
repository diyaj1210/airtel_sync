# Lead propensity model: report

Written by `python -m app.propensity.train` (ai-service). Data: `data/raw/smb_leads.csv`,
5,000 leads, 368 activated (7.4%).
Target: `outcome == Activated`. Model served: **logistic regression** (explainable: every score
comes with its top 3 reasons); gradient boosting trained on the same inputs for comparison.

## Results (held-out test set: 1,000 leads, 74 activated; stratified, seed 42)

| Model | Test AUC | 5-fold CV AUC (train) | Top 20% of leads by score hold |
|---|---|---|---|
| Logistic regression (served) | **0.670** | 0.724 ± 0.030 | 32% of activations (12.0% activate vs 7.4% overall) |
| Gradient boosting (comparison) | 0.669 | – | 36% of activations |

## Inputs (known when the lead arrives)

`segment`, `business_type`, `lead_source`, `city_tier`, `has_gstin`, `has_udyam`, `annual_turnover_band`, `current_internet`, `current_provider`, `preferred_language`, `employee_count`, `num_sites`, `monthly_telecom_spend_inr`, `products_of_interest_count`
(`products_of_interest_count` = number of products asked about; counts and money as log(1 + x)).

**Left out (leakage)**: `stage_reached`, `outcome`, `drop_reason`, `contacted_date`, `needs_assessed_date`, `quote_accepted_date`, `kyc_complete_date`, `activated_date`, `days_lead_to_activation`, `customer_follow_up_calls`, `bundle_products`, `monthly_bundle_value_inr`, `one_time_setup_inr`, `contract_months`, `churned_within_6_months`, `nps_score`, `acquisition_cost_inr`. They are filled in, or
grow, as the lead moves through the funnel. Example: `acquisition_cost_inr` alone scores an AUC of
0.902, because money is spent on leads that go further.

## Strongest drivers (log-odds per input)

| Input | Value | Effect |
|---|---|---|
| lead_source | Referral | +0.69 |
| has_gstin | Y | +0.53 |
| business_type | Gym chain | +0.31 |
| preferred_language | Hindi | +0.29 |
| annual_turnover_band | 5 - 25 cr | +0.28 |
| city_tier | 1 | +0.24 |
| current_provider | Accel (mobile only) | +0.24 |
| current_provider | Accel | +0.22 |

| Input | Value | Effect |
|---|---|---|
| has_gstin | N | -0.53 |
| lead_source | WhatsApp campaign | -0.44 |
| lead_source | Website form | -0.42 |
| segment | Micro retail & services | -0.41 |
| business_type | Hardware store | -0.28 |
| city_tier | 2 | -0.24 |
| current_provider | Local ISP | -0.23 |
| current_internet | Mobile hotspot | -0.23 |

## Score and routing

Score = the lead's percentile among all 5,000 leads (0-100). Bands (solution outline 04):
**high** = score ≥ 80 (top 20%): call within 24 h · **medium** = 40-79:
WhatsApp nudge to the self-serve journey · **low** = below 40: automated nurture.
