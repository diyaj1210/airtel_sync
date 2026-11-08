import { describe, expect, it } from "vitest";
import type { AdvisorLead } from "../../src/advisor/leads.js";
import { bearerToken, StaffSessions } from "../../src/backoffice/auth.js";
import { loadBusinessTypes, parseCrmLeads } from "../../src/backoffice/crm.js";
import { advisorLeadFeatures } from "../../src/backoffice/scoring.js";
import { attributionStaff, leadSourceFor, parseAttribution, staffByCode } from "../../src/backoffice/staff.js";
import type { KycEvaluation } from "../../src/kyc/checks.js";
import { applyReview, issueKey, type KycReview } from "../../src/kyc/review.js";
import { dataLeadScores, scoreLeads, type PropensityApi } from "../../src/propensity/client.js";

const BUSINESS_TYPES = loadBusinessTypes();

function lead(over: Partial<AdvisorLead> = {}, business: Partial<AdvisorLead["business"]> = {}): AdvisorLead {
  return {
    leadId: "AL-00000001",
    sessionId: "S-0000000000000000",
    createdOn: "2026-07-15",
    updatedOn: "2026-07-15",
    reason: "price_too_high",
    note: null,
    phone: null,
    callbackConsent: false,
    lang: "en",
    segment: null,
    business: { type: null, kind: null, employees: null, locations: null, city: null, cityTier: null, gstin: null, currentInternet: null, toolsInUse: null, ...business },
    recommendation: null,
    askedAboutUnavailable: [],
    advisorTurns: 1,
    attributionCode: null,
    followUp: { status: "new", assignedTo: null, updatedOn: null, updatedBy: null },
    ...over,
  };
}

describe("staff codes and attribution", () => {
  it("knows the demo codes; only partners and sales can refer", () => {
    expect(staffByCode(" ptr-01 ")?.code).toBe("PTR-01");
    expect(staffByCode("ADM-01")?.role).toBe("admin");
    expect(attributionStaff("ADM-01")).toBeUndefined();
    expect(staffByCode("PTR-1")).toBeUndefined();
    expect(parseAttribution(undefined)).toEqual({ ok: true, code: null });
    expect(parseAttribution("")).toEqual({ ok: true, code: null });
    expect(parseAttribution("sls-02")).toEqual({ ok: true, code: "SLS-02" });
    expect(parseAttribution("ADM-01")).toEqual({ ok: false });
    expect(parseAttribution(7)).toEqual({ ok: false });
    expect(leadSourceFor("PTR-02")).toBe("Channel partner");
    expect(leadSourceFor("SLS-01")).toBe("Field sales");
    expect(leadSourceFor(null)).toBeNull();
  });

  it("sessions: random tokens, unknown accounts refused, bearer header parsed strictly", () => {
    const s = new StaffSessions(() => 0);
    expect(s.signIn("NOPE-1")).toBeNull();
    const a = s.signIn("PTR-01")!;
    const b = s.signIn("PTR-01")!;
    expect(a.token).not.toBe(b.token);
    expect(s.get(a.token)?.code).toBe("PTR-01");
    expect(s.get("x")).toBeUndefined();
    const req = (authorization?: string) => ({ headers: { authorization } }) as Parameters<typeof bearerToken>[0];
    expect(bearerToken(req(`Bearer ${a.token}`))).toBe(a.token);
    expect(bearerToken(req(`Basic ${a.token}`))).toBeNull();
    expect(bearerToken(req())).toBeNull();
  });
});

describe("propensity inputs for an advisor lead", () => {
  it("maps the advisor's answers to the data's values", () => {
    const f = advisorLeadFeatures(
      lead({ lang: "hi", segment: "multi", attributionCode: "PTR-01" }, { type: "pharmacy chain", employees: 30, locations: 4, cityTier: 2, gstin: "inactive", currentInternet: "mobile_hotspot" }),
      BUSINESS_TYPES,
    );
    expect(f).toEqual({
      segment: "Small multi-site businesses",
      business_type: "Pharmacy chain",
      lead_source: "Channel partner",
      city_tier: "2",
      has_gstin: "Y",
      current_internet: "Mobile hotspot",
      preferred_language: "Hindi",
      employee_count: 30,
      num_sites: 4,
    });
  });

  it("leaves out what is not known or not a value the model knows", () => {
    expect(advisorLeadFeatures(lead({}, { type: "Dog groomer", gstin: "none" }), BUSINESS_TYPES)).toEqual({ has_gstin: "N", preferred_language: "English" });
    expect(BUSINESS_TYPES.size).toBe(35);
  });
});

describe("past-quarter leads", () => {
  it("keeps dropped leads only and refuses rows it cannot read", () => {
    const header = "lead_id,created_date,lead_source,business_name,business_type,segment,city,city_tier,state,preferred_language,employee_count,num_sites,has_gstin,gstin,has_udyam,current_provider,contact_name,contact_role,stage_reached,outcome,drop_reason";
    const row = (id: string, outcome: string, segment = "Professional offices") =>
      `${id},2026-05-01,Referral,Test Co,CA firm,${segment},Pune,1,Maharashtra,Hindi,5,1,Y,27ABCXX1234A1Z5,N,None,A B,Owner,Contacted,${outcome},Price too high`;
    const leads = parseCrmLeads([header, row("L00001", "Dropped"), row("L00002", "Activated")].join("\n"));
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ leadId: "L00001", segment: "prof", cityTier: 1, hasGstin: true, dropReason: "Price too high" });
    expect(leads[0]).not.toHaveProperty("gstin");
    expect(() => parseCrmLeads([header, row("L00003", "Dropped", "Unknown")].join("\n"))).toThrow(/L00003/);
  });
});

describe("KYC review decision", () => {
  const evaluation = (status: KycEvaluation["status"], codes: string[]): KycEvaluation =>
    ({
      status,
      issues: codes.map((code) => ({ code, severity: "review", params: {} })),
      warnings: [],
      documents: {},
      gstin: "active",
      gstinProductsAllowed: true,
      registry: { gst: null, udyam: null },
    }) as unknown as KycEvaluation;
  const review = (decision: KycReview["decision"], codes: string[]): KycReview => ({
    decision,
    by: "ADM-01",
    on: "2026-07-15",
    note: null,
    issueKey: issueKey(evaluation("manual_review", codes).issues),
  });

  it("applies only to the same problems in a manual-review case", () => {
    expect(applyReview(evaluation("manual_review", ["SIGNATORY_NOT_VERIFIED"]), review("approved", ["SIGNATORY_NOT_VERIFIED"])).status).toBe("pass");
    expect(applyReview(evaluation("manual_review", ["SIGNATORY_NOT_VERIFIED"]), review("rejected", ["SIGNATORY_NOT_VERIFIED"])).status).toBe("rejected");
    const changed = applyReview(evaluation("manual_review", ["SIGNATORY_NOT_VERIFIED", "ADDRESS_MISMATCH"]), review("approved", ["SIGNATORY_NOT_VERIFIED"]));
    expect(changed).toMatchObject({ status: "manual_review", review: null });
    expect(applyReview(evaluation("fix_needed", ["SIGNATORY_NOT_VERIFIED"]), review("approved", ["SIGNATORY_NOT_VERIFIED"])).status).toBe("fix_needed");
    expect(applyReview(evaluation("manual_review", ["A", "B"]), review("approved", ["B", "A"])).status).toBe("pass");
  });
});

describe("bulk scoring from the ai-service", () => {
  const ok = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ id: `L${String(from + i + 1).padStart(5, "0")}`, probability: 0.1, score: 50, band: "medium", reasons: [] }));

  it("sends 500 leads at a time and checks every answer", async () => {
    const sizes: number[] = [];
    const api: PropensityApi = {
      async call(_m, _p, body) {
        const n = (body as { leads: unknown[] }).leads.length;
        sizes.push(n);
        return { status: 200, body: { scores: ok(n) } };
      },
    };
    const leads = Array.from({ length: 1201 }, (_, i) => ({ id: `x${i}`, lead: {} }));
    expect(await scoreLeads(api, leads)).toHaveLength(1201);
    expect(sizes).toEqual([500, 500, 201]);
    const short: PropensityApi = { async call() { return { status: 200, body: { scores: ok(1) } }; } };
    expect(await scoreLeads(short, leads.slice(0, 2))).toBeNull();
  });

  it("data scores: a map by id; a bad or missing answer means no scores", async () => {
    const good: PropensityApi = { async call() { return { status: 200, body: { scores: ok(3) } }; } };
    expect([...(await dataLeadScores(good))!.keys()]).toEqual(["L00001", "L00002", "L00003"]);
    const noIds: PropensityApi = { async call() { return { status: 200, body: { scores: [{ ...ok(1)[0], id: null }] } }; } };
    expect(await dataLeadScores(noIds)).toBeNull();
    const down: PropensityApi = { async call() { return { status: 503, body: { error: "propensity_unavailable" } }; } };
    expect(await dataLeadScores(down)).toBeNull();
  });
});
