# Data Insights (smb_leads.csv, Apr–Jun 2026, 5,000 leads)

## Funnel
| Stage | Leads | % of previous |
|---|---|---|
| Lead | 5,000 | – |
| Contacted | 3,406 | 68% |
| Needs assessed | 1,974 | 58% |
| Quote accepted | 861 | **44% ← biggest leak** |
| KYC complete | 588 | 68% |
| Activated | 368 | 63% |

Overall 7.4% lead → activation · 17.6 days average · ~3 status-chase calls · ~₹15,000 CAC per activation.

## Why leads drop (and which solution fixes it)
| Stage dropped | Top reasons (count) | Fix |
|---|---|---|
| Lead | Unreachable (805), not interested (470), wrong number (319) | Sol 4: score & route; Sol 2: WhatsApp-first contact |
| Contacted | No time for a visit (531), locked in (325), visit not scheduled (296), only wanted mobile (280) | Sol 1/2: no visit needed; mobile-only → upsell path |
| Needs assessed | Price too high (414), competitor cheaper (207), quote too complex (206), quote too slow (179), decided to wait (107) | Sol 1: instant, plain-language quote with toggles + cheap starter bundle |
| Quote accepted | Missing GST/Udyam doc (94), paperwork too long (79), signatory unavailable (53), details mismatch (47) | Smart KYC: lookup-first, upload only what's missing, e-sign |
| KYC complete | Install delayed >21 days (98), cancelled before install (53), fibre not feasible (41), payment failed (28) | Tracker + AirFiber fallback when fibre not feasible |

## Segments
| Segment | Leads | Conversion | Median bundle/month | 6-mo churn | CAC/lead |
|---|---|---|---|---|---|
| Micro retail & services | 2,709 | 4% | ₹2,470 | **23%** | ₹812 |
| Professional offices | 1,247 | 11% | ₹6,575 | 14% | ₹1,184 |
| Small multi-site | 755 | 11% | ₹28,080 | 11% | ₹1,717 |
| Small manufacturers | 289 | 13% | ₹15,910 | 8% | ₹1,962 |

## Other signals
- **GSTIN**: 10% conversion with vs 2% without.
- **Lead source**: Referral 15% (but 25% churn), Inbound call 10%, Channel partner 8%, Field sales 7%, Website 4%, WhatsApp campaign 3%.
- **Status chasing hurts**: 1 follow-up call → 6% churn, NPS 7.5; 5 calls → 28% churn, NPS 6.0. Strong case for the Tracker.
- **Existing base**: 1,505 leads are "Accel (mobile only)" customers → pre-filled upsell.
- **Current setup**: mobile-hotspot users convert worst (4%); leased-line / mixed-per-site best (13–15%).
- **Contracts sold**: mostly 12 months (304), some 24 (61), almost no 6-month (3).

## Possible planted problems (compliance)
- 22 activated customers have a **Cancelled/Suspended GSTIN**.
- 49 product lines in activated bundles **break catalogue eligibility rules** (e.g. Biz Fibre 1G sold in tier 2, GSTIN-only products sold without GSTIN).
→ Our rules engine prevents both.
