"""Verify the numbers and bundles in solution_outline_chat/ against data/raw/.

Read-only on data/raw/. Standard library only, so it runs on any Python 3.10+:

    python scripts/verify_outline.py

Exit code 0 = every check passed, 1 = at least one check failed.
"""
from __future__ import annotations

import csv
import statistics
import sys
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

RAW = Path(__file__).resolve().parent.parent / "data" / "raw"
TODAY = date(2026, 7, 15)  # "today" per data/raw/README.md

failures: list[str] = []


def check(label: str, actual, expected) -> None:
    ok = actual == expected
    print(f"  [{'OK ' if ok else 'FAIL'}] {label}: {actual}" + ("" if ok else f" (outline says {expected})"))
    if not ok:
        failures.append(label)


def read(name: str) -> list[dict]:
    with open(RAW / name, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


cat = {p["product_id"]: p for p in read("product_catalogue.csv")}
leads = read("smb_leads.csv")
gst = {r["gstin"]: r for r in read("mock_gstin_registry.csv")}
udyam = {r["udyam_number"]: r for r in read("mock_udyam_registry.csv")}

# --------------------------------------------------------------------------- rules
def violations(pid: str, profile: dict, bundle_ids: set[str]) -> list[str]:
    """Catalogue eligibility rules from data/raw/README.md."""
    p = cat[pid]
    v = []
    if str(profile["tier"]) not in p["available_city_tiers"].split(";"):
        v.append(f"tier {profile['tier']} not in {p['available_city_tiers']}")
    if profile["employees"] < int(p["min_employees"]):
        v.append(f"employees {profile['employees']} < {p['min_employees']}")
    if profile["sites"] < int(p["min_sites"]):
        v.append(f"sites {profile['sites']} < {p['min_sites']}")
    if p["requires_gstin"] == "Y" and not profile["gstin_active"]:
        v.append("needs valid active GSTIN")
    if p["requires_one_of"]:
        need = set(p["requires_one_of"].split("|"))
        if not need & (bundle_ids - {pid}):
            v.append(f"needs one of {p['requires_one_of']}")
    return v


def price(lines: list[tuple[str, int]]):
    monthly = sum(int(cat[p]["price_min_inr_per_month"]) * q for p, q in lines)
    setup = sum(int(cat[p]["one_time_setup_inr"]) * q for p, q in lines)
    contract = max(int(cat[p]["min_contract_months"]) for p, _ in lines)
    install = max(int(cat[p]["typical_install_days"]) for p, _ in lines)
    return monthly, setup, contract, install


def check_bundle(name, profile, lines, monthly, setup, contract, addons=()):
    print(f"\n{name}  profile={profile}")
    ids = {p for p, _ in lines}
    for p, _ in lines:
        v = violations(p, profile, ids)
        check(f"{p} {cat[p]['product_name']} eligible", v, [])
    m, s, c, i = price(lines)
    check("monthly (catalogue min price)", m, monthly)
    check("one-time setup", s, setup)
    check("contract months = max(min_contract_months)", c, contract)
    print(f"  install ETA = max(typical_install_days) = {i} days")
    for p, prof in addons:
        v = violations(p, prof, ids | {p})
        check(f"add-on {p} {cat[p]['product_name']} eligible for {prof}", v, [])


print("=" * 70, "\nBUNDLES (bundles-and-pricing.md)")
micro = dict(tier=2, employees=3, sites=1, gstin_active=False)
check_bundle("1 Dukaan Digital Starter (with P22)", micro,
             [("P04", 1), ("P07", 1), ("P22", 1)], 1597, 1000, 12,
             addons=[("P19", micro), ("P23", micro), ("P18", micro),
                     ("P15", dict(micro, gstin_active=True))])
check_bundle("1b Dukaan Digital Starter Lite (6-month)", micro,
             [("P04", 1), ("P07", 1)], 1198, 0, 6)
prof = dict(tier=2, employees=5, sites=1, gstin_active=False)
prof_g = dict(prof, gstin_active=True)
check_bundle("2 Office Pro", prof,
             [("P02", 1), ("P07", 2), ("P16", 5), ("P17", 1), ("P20", 5), ("P09", 1)],
             4215, 1500, 12,
             addons=[("P12", prof_g), ("P11", prof), ("P14", prof_g)])
multi = dict(tier=2, employees=15, sites=3, gstin_active=True)
check_bundle("3 Chain Connect (3 sites)", multi,
             [("P02", 3), ("P09", 3), ("P23", 6), ("P22", 3), ("P10", 3), ("P13", 1), ("P08", 3)],
             19182, 34300, 24)
mfg = dict(tier=2, employees=10, sites=1, gstin_active=True)
check_bundle("4 Factory Connect", mfg,
             [("P05", 1), ("P21", 1), ("P24", 5), ("P16", 10), ("P08", 2)],
             13192, 29000, 24, addons=[("P06", dict(mfg, employees=25))])

# negative controls: the rules must reject these
print("\nNegative controls (rules must reject):")
check("P03 in tier 2 rejected", bool(violations("P03", dict(tier=2, employees=10, sites=1, gstin_active=True), {"P03"})), True)
check("P10 with 2 sites rejected", bool(violations("P10", dict(tier=1, employees=20, sites=2, gstin_active=True), {"P10", "P02"})), True)
check("P15 without GSTIN rejected", bool(violations("P15", micro, {"P15"})), True)
check("P09 without fibre rejected", bool(violations("P09", prof, {"P09", "P04"})), True)
check("P12 with 2 employees rejected", bool(violations("P12", dict(prof_g, employees=2), {"P12", "P02"})), True)

# --------------------------------------------------------------------------- data
print("\n" + "=" * 70, "\nLEADS DATA (data-insights.md, PDF Appendix A1)")
act = [l for l in leads if l["outcome"] == "Activated"]
pct = lambda a, b: round(100 * a / b)
check("leads", len(leads), 5000)
check("activated", len(act), 368)
check("overall conversion % (1 dp)", round(100 * len(act) / len(leads), 1), 7.4)
check("avg days lead->activation (1 dp)",
      round(statistics.mean(int(l["days_lead_to_activation"]) for l in act), 1), 17.6)
check("avg follow-up calls (activated, rounded)",
      round(statistics.mean(int(l["customer_follow_up_calls"]) for l in act)), 3)
cac = sum(int(l["acquisition_cost_inr"]) for l in leads) / len(act)
check("blended CAC per activation ~15,000 (nearest 1k)", round(cac, -3), 15000)

stages = ["Lead", "Contacted", "Needs assessed", "Quote accepted", "KYC complete", "Activated"]
reached = Counter(stages.index(l["stage_reached"]) for l in leads)
cum = [sum(v for k, v in reached.items() if k >= i) for i in range(len(stages))]
check("funnel counts", cum, [5000, 3406, 1974, 861, 588, 368])

print("\nDrop reasons by stage reached (top):")
drops = defaultdict(Counter)
for l in leads:
    if l["outcome"] == "Dropped":
        drops[l["stage_reached"]][l["drop_reason"]] += 1
expected_drops = {
    "Lead": {"Unreachable": 805, "Not interested on first call": 470, "Wrong number": 319},
}
for st in stages[:-1]:
    print(f"  {st}: {drops[st].most_common(5)}")

print("\nSegments:")
seg_expect = {  # leads, conversion %, median bundle, churn %
    "Micro retail & services": (2709, 4, 2470, 23),
    "Professional offices": (1247, 11, 6575, 14),
    "Small multi-site businesses": (755, 11, 28080, 11),
    "Small manufacturers": (289, 13, 15910, 8),
}
for seg, (n, conv, med, churn) in seg_expect.items():
    sl = [l for l in leads if l["segment"] == seg]
    sa = [l for l in sl if l["outcome"] == "Activated"]
    check(f"{seg} leads", len(sl), n)
    check(f"{seg} conversion %", pct(len(sa), len(sl)), conv)
    check(f"{seg} median bundle", round(statistics.median(int(l["monthly_bundle_value_inr"]) for l in sa)), med)
    check(f"{seg} 6-mo churn %", pct(sum(l["churned_within_6_months"] == "Y" for l in sa), len(sa)), churn)
    print(f"  {seg}: CAC/lead = {statistics.mean(int(l['acquisition_cost_inr']) for l in sl):.0f}")

print("\nOther signals:")
for flag, exp in [("Y", 9.6), ("N", 2.0)]:
    g = [l for l in leads if l["has_gstin"] == flag]
    check(f"conversion has_gstin={flag} % (1 dp)",
          round(100 * sum(l["outcome"] == "Activated" for l in g) / len(g), 1), exp)
check("overall 6-mo churn % of activated", pct(sum(l["churned_within_6_months"] == "Y" for l in act), len(act)), 15)
src = {s: pct(sum(l["outcome"] == "Activated" for l in g), len(g))
       for s in {l["lead_source"] for l in leads}
       for g in [[l for l in leads if l["lead_source"] == s]]}
check("conversion by lead source %", src, {"Referral": 15, "Inbound call": 10, "Channel partner": 8,
                                          "Field sales": 7, "Website form": 4, "WhatsApp campaign": 3})
ref = [l for l in act if l["lead_source"] == "Referral"]
check("Referral churn %", pct(sum(l["churned_within_6_months"] == "Y" for l in ref), len(ref)), 25)
check("existing 'Accel (mobile only)' leads",
      sum(l["current_provider"] == "Accel (mobile only)" for l in leads), 1505)
check("contract months sold", dict(Counter(int(l["contract_months"]) for l in act)), {12: 304, 24: 61, 6: 3})
print("  follow-up calls -> churn % / avg NPS:")
for c in sorted({int(l["customer_follow_up_calls"]) for l in act}):
    g = [l for l in act if int(l["customer_follow_up_calls"]) == c]
    print(f"    {c} calls: n={len(g)} churn={pct(sum(l['churned_within_6_months']=='Y' for l in g), len(g))}% "
          f"NPS={statistics.mean(int(l['nps_score']) for l in g):.1f}")
print("  conversion by current_internet:")
for ci in sorted({l["current_internet"] for l in leads}):
    g = [l for l in leads if l["current_internet"] == ci]
    print(f"    {ci}: {pct(sum(l['outcome']=='Activated' for l in g), len(g))}% (n={len(g)})")

print("\nPlanted compliance problems in activated bundles:")
bad_gst = [l for l in act if l["gstin"] and gst.get(l["gstin"], {}).get("status") in ("Cancelled", "Suspended")]
check("activated with Cancelled/Suspended GSTIN", len(bad_gst), 22)
viol_lines, viol_kinds = 0, Counter()
setup_match = in_range = 0
KIND = {"tier": "city_tier", "employees": "min_employees", "sites": "min_sites",
        "needs valid": "requires_gstin", "needs one": "requires_one_of"}
for l in act:
    lines = [(x.split("x")[0], int(x.split("x")[1])) for x in l["bundle_products"].split(";")]
    ids = {p for p, _ in lines}
    profile = dict(tier=int(l["city_tier"]), employees=int(l["employee_count"]), sites=int(l["num_sites"]),
                   gstin_active=l["has_gstin"] == "Y" and gst.get(l["gstin"], {}).get("status") == "Active")
    # count only catalogue-rule breaks other than GSTIN status (status counted above)
    profile_rules = dict(profile, gstin_active=l["has_gstin"] == "Y")
    for p, _ in lines:
        v = violations(p, profile_rules, ids)
        if v:
            viol_lines += 1
            viol_kinds.update(next(k for pre, k in KIND.items() if x.startswith(pre)) for x in v)
    setup_match += sum(int(cat[p]["one_time_setup_inr"]) * q for p, q in lines) == int(l["one_time_setup_inr"])
    lo = sum(int(cat[p]["price_min_inr_per_month"]) * q for p, q in lines)
    hi = sum(int(cat[p]["price_max_inr_per_month"]) * q for p, q in lines)
    in_range += lo <= int(l["monthly_bundle_value_inr"]) <= hi
check("product lines breaking catalogue rules", viol_lines, 49)
print(f"  rule breaks by kind (a line can break several): {dict(viol_kinds)}")
check("setup fee = sum(setup x qty) for every activated bundle", setup_match, len(act))
check("monthly value within [sum min, sum max] price range", in_range, len(act))

print("\nRegistries / identifiers (data/raw/README.md):")
CH = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
def gst_check_char(s14):
    t = 0
    for i, c in enumerate(s14):
        v = CH.index(c) * (2 if i % 2 else 1)
        t += v // 36 + v % 36
    return CH[(36 - t % 36) % 36]
check("all registry GSTIN checksums valid", all(gst_check_char(g[:14]) == g[14] for g in gst), True)
check("all registry GSTIN PAN 4th char == X", all(g[5] == "X" for g in gst), True)
check("all Udyam numbers have district 00", all(u.split("-")[2] == "00" for u in udyam), True)
check("90 days before today", date.fromordinal(TODAY.toordinal() - 90).isoformat(), "2026-04-16")

print("\n" + "=" * 70)
if failures:
    print(f"{len(failures)} check(s) FAILED: {failures}")
    sys.exit(1)
print("ALL CHECKS PASSED")
