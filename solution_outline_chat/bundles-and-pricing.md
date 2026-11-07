# Segment Bundles & Pricing (Key question 1)

Prices use the catalogue **minimum** monthly price as list price. All bundles pass the catalogue
eligibility rules for the stated profile. Every number on this page is checked by
`python scripts/verify_outline.py` (not by eye).

Pricing model (confirmed against all 368 activated bundles in `smb_leads.csv`):
- Monthly = Σ price × qty, and must stay inside [Σ price_min × qty, Σ price_max × qty] (true for 368/368).
- One-time setup = Σ `one_time_setup_inr` × qty, i.e. setup is **per unit** (matches 368/368).
- Contract = max(`min_contract_months`) of the products in the bundle.
- Install ETA = max(`typical_install_days`) of the products in the bundle.
- The templates below are **filtered by the rules engine per profile**: a line whose rule fails
  (tier, min_employees, min_sites, requires_gstin, requires_one_of) is removed or swapped, and
  quantities scale with employees / sites.

## Priority order
1. **Professional offices** – 25% of base, 11% conversion, 14% churn, mid price sensitivity → launch segment
2. **Small multi-site** – highest value (median ₹28k/month), 11% churn → field-assisted
3. **Micro retail & services** – biggest volume (55%) but 4% conversion and 23% churn → cheap,
   short-contract starter via WhatsApp
4. **Small manufacturers** – lowest churn (8%), high value, small volume (5%) → field-assisted

## Bundles

### 1. Dukaan Digital Starter – Micro retail (no GSTIN needed)
| Product | Qty | ₹/month |
|---|---|---|
| P04 Biz 5G AirFiber 100 | 1 | 899 |
| P07 Business Postpaid 299 | 1 | 299 |
| P22 Secure Wi-Fi with Guest Network | 1 | 399 |
| **Total** | | **₹1,597** + ₹1,000 setup |

Contract: **12 months** (P22 Secure Wi-Fi has a 12-month minimum). Installs in ~3 days.
**Starter Lite (6-month option):** P04 + P07 only = **₹1,198**, no setup, 6-month contract
(P04 minimum), ~2-day install. P22 can be added later, which moves the contract to 12 months.
Add-ons: P19 Cloud POS (+599, ₹2,500 setup), P23 Cloud CCTV (+199/camera, ₹1,800 setup/camera),
P18 Website (+299), P15 WhatsApp API (+999, **needs GSTIN**, 3-month minimum).

### 2. Office Pro – Professional offices (clinic, CA firm, coaching)
| Product | Qty | ₹/month |
|---|---|---|
| P02 Biz Fibre 300 | 1 | 1,499 |
| P07 Business Postpaid 299 | 2 | 598 |
| P16 Cloud Email & Office | 5 | 625 |
| P17 Cloud Backup 1 TB | 1 | 499 |
| P20 Endpoint Security | 5 | 495 |
| P09 Backup 4G/5G Failover | 1 | 499 |
| **Total** | | **₹4,215** + ₹1,500 setup |

Contract: 12 months. Installs in ~5 days. Quantities of P16/P20 follow headcount (5 shown).
Add-ons: P12 Cloud Telephony (≥3 employees + GSTIN, ₹2,000 setup), P11 Static IP, P14 SMS (GSTIN).

### 3. Chain Connect – Small multi-site (example: 3 sites, 15 employees, GSTIN)
Per site: P02 Fibre 300 (1,499) + P09 Failover (499) + P23 CCTV ×2 (398) + P22 Wi-Fi (399) = ₹2,795
| Item | ₹/month |
|---|---|
| 3 sites × ₹2,795 | 8,385 |
| P10 Managed SD-WAN × 3 sites (≥10 emp, ≥3 sites, GSTIN) | 7,500 |
| P13 Toll-free number | 1,500 |
| P08 Business Postpaid 599 × 3 | 1,797 |
| **Total** | **≈ ₹19,182** + ₹34,300 setup |

Contract: 24 months (SD-WAN minimum). Installs in ~14 days (SD-WAN). Field-assisted.
If the business has < 10 employees, < 3 sites or no active GSTIN, the rules engine drops P10
(and P13 without GSTIN); the contract then falls to 12 months.

### 4. Factory Connect – Small manufacturers (≥10 employees, GSTIN)
| Product | Qty | ₹/month |
|---|---|---|
| P05 Internet Leased Line 20 | 1 | 8,000 |
| P21 Managed Firewall | 1 | 1,999 |
| P24 Machine Monitoring IoT | 5 | 745 |
| P16 Cloud Email & Office | 10 | 1,250 |
| P08 Business Postpaid 599 | 2 | 1,198 |
| **Total** | | **₹13,192** + ₹29,000 setup (10,000 + 4,000 + 5 × 3,000) |

Contract: 24 months. Installs in ~21 days (leased line). Field-assisted. Upgrade: P06 Leased Line 100 at ≥25 employees.
P05, P21 and P24 all need ≥10 employees **and** an active GSTIN; below that the rules engine
falls back to P02 Biz Fibre 300 + P11 Static IP + P16/P20.

## Pricing principles
- One monthly number, setup shown separately, "why" per line.
- Stay inside the catalogue price range: list price = `price_min`, never below it. A "bundle
  benefit" for 3+ categories is given as a **waived or spread setup fee**, not a monthly price
  below catalogue minimum (no activated bundle in the data is priced below the range).
- Option to spread setup fee over the contract (micro).
