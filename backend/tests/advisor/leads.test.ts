import { describe, expect, it } from "vitest";
import { applyUpdates } from "../../src/advisor/answers.js";
import { LeadStore, leadView, maskPhone, parseIndianMobile } from "../../src/advisor/leads.js";
import { recommend } from "../../src/advisor/recommend.js";
import { AdvisorSessionStore, remember, MAX_HISTORY } from "../../src/advisor/sessions.js";
import { catalogue, cities } from "./helpers.js";

describe("parseIndianMobile", () => {
  it.each([
    ["9876543210", "9876543210"],
    ["98765 43210", "9876543210"],
    ["+91 98765-43210", "9876543210"],
    ["+919876543210", "9876543210"],
    ["09876543210", "9876543210"],
    ["(987) 654-3210", "9876543210"],
  ])("%s -> %s", (raw, digits) => expect(parseIndianMobile(raw)).toBe(digits));

  it.each(["12345", "5876543210", "98765432101", "abcdefghij", ""])("rejects %s", (raw) => expect(parseIndianMobile(raw)).toBeNull());

  it("masks all but the last 4 digits", () => expect(maskPhone("9876543210")).toBe("******3210"));
});

describe("LeadStore", () => {
  const sessionWithRec = () => {
    const session = new AdvisorSessionStore(() => 0).create("hi");
    session.answers = applyUpdates({}, { businessKind: "office", employees: 5, sites: 1, city: "Kochi", gstin: "none", internet: "none", tools: [] }, cities).answers;
    session.recommendation = recommend(catalogue, session.answers);
    session.turns = 7;
    session.askedUnavailable = ["P12"];
    return session;
  };

  it("saves the reason, business facts and recommendation, without identifiers", () => {
    const store = new LeadStore(() => "2026-07-15", () => "AL-0000000A");
    const session = sessionWithRec();
    const { lead, created } = store.save(session, { reason: "price_too_high", note: "my GSTIN 27XUIXG0767D1ZP", phone: null, callbackConsent: false });
    expect(created).toBe(true);
    expect(lead).toMatchObject({
      leadId: "AL-0000000A",
      createdOn: "2026-07-15",
      reason: "price_too_high",
      note: "my GSTIN 27XUIX******1ZP",
      phone: null,
      callbackConsent: false,
      lang: "hi",
      segment: "prof",
      business: { type: "office", employees: 5, locations: 1, city: "Kochi", cityTier: 2, gstin: "none" },
      recommendation: { templateId: "office-pro", name: "Office Pro", monthlyInr: 4215 },
      askedAboutUnavailable: ["P12"],
      advisorTurns: 7,
    });
    expect(session.leadId).toBe("AL-0000000A");
  });

  it("updates the same lead when the owner sends the form again", () => {
    const ids = ["AL-00000001", "AL-00000002"];
    const store = new LeadStore(() => "2026-07-15", () => ids.shift()!);
    const session = sessionWithRec();
    store.save(session, { reason: "decided_to_wait", note: null, phone: null, callbackConsent: false });
    const again = store.save(session, { reason: "asked_for_human", note: null, phone: "9876543210", callbackConsent: true });
    expect(again.created).toBe(false);
    expect(again.lead.leadId).toBe("AL-00000001");
    expect(store.list()).toHaveLength(1);
    expect(leadView(again.lead).phoneMasked).toBe("******3210");
    expect(JSON.stringify(leadView(again.lead))).not.toContain("9876543210");
  });

  it("records 'could not understand' when the owner asks for a person after the advisor got stuck", () => {
    const store = new LeadStore(() => "2026-07-15");
    const session = sessionWithRec();
    session.stuck = true;
    expect(store.save(session, { reason: "asked_for_human", note: null, phone: "9876543210", callbackConsent: true }).lead.reason).toBe(
      "advisor_could_not_understand",
    );
  });

  it("never stores a phone number without consent", () => {
    const store = new LeadStore(() => "2026-07-15");
    const { lead } = store.save(sessionWithRec(), { reason: "other", note: null, phone: "9876543210", callbackConsent: false });
    expect(lead.phone).toBeNull();
    expect(lead.callbackConsent).toBe(false);
  });
});

describe("AdvisorSessionStore", () => {
  it("expires a chat after 2 hours without a message", () => {
    let now = 0;
    const store = new AdvisorSessionStore(() => now);
    const s = store.create("en");
    now = 2 * 60 * 60 * 1000;
    expect(store.get(s.id)).toBe(s);
    now += 1;
    expect(store.get(s.id)).toBeUndefined();
  });

  it("drops the least recently used chat when full", () => {
    let n = 0;
    const store = new AdvisorSessionStore(() => 0, { maxSessions: 2, idleMs: 1e9 }, () => `S-${String(++n).padStart(16, "0")}`);
    const a = store.create("en");
    const b = store.create("en");
    store.touch(a);
    store.create("en");
    expect(store.get(a.id)).toBe(a);
    expect(store.get(b.id)).toBeUndefined();
    expect(store.size).toBe(2);
  });

  it("keeps only the last turns, each cut to 400 characters", () => {
    const s = new AdvisorSessionStore().create("en");
    for (let i = 0; i < MAX_HISTORY + 3; i++) remember(s, { role: "owner", text: `${i} ${"x".repeat(500)}` });
    expect(s.history).toHaveLength(MAX_HISTORY);
    expect(s.history[0]!.text.startsWith("3 ")).toBe(true);
    expect(s.history[0]!.text.length).toBe(400);
  });
});
