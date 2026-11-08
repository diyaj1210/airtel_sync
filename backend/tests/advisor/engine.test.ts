import { describe, expect, it } from "vitest";
import { LlmError, NO_LLM } from "../../src/advisor/llm.js";
import { fakeLlm, honestLlm, makeEngine, runChat } from "./helpers.js";

const OFFICE_CHAT = ["dental clinic in Kochi with 5 people", "1", "no", "mobile hotspot", "email"];

describe("no-key mode", () => {
  it("greets, says it is in basic mode and asks the first question with quick replies", async () => {
    const { engine, sessions } = makeEngine(NO_LLM);
    const reply = await engine.start(sessions.create("en"));
    expect(reply.mode).toBe("basic");
    expect(reply.messages.map((m) => m.text)).toEqual([
      expect.stringContaining("Namaste! I'm the Accel Business advisor"),
      expect.stringContaining("Basic mode"),
      "What kind of business do you run? Type it (for example “dental clinic” or “kirana store”) or pick one.",
    ]);
    expect(reply.expecting).toBe("businessKind");
    expect(reply.quickReplies.map((q) => q.label)).toEqual(["Shop or small service", "Office or clinic", "Several branches", "Factory or workshop"]);
  });

  it("offers every city as a quick reply, plus 'not in the list', in Hindi script for Hindi", async () => {
    const { engine, sessions } = makeEngine();
    const { replies } = await runChat(engine, sessions, "hi", ["दुकान", "2", "1"]);
    const last = replies.at(-1)!;
    expect(last.expecting).toBe("city");
    expect(last.quickReplies).toHaveLength(23);
    expect(last.quickReplies[0]).toEqual({ label: "अहमदाबाद", choice: { slot: "city", value: "Ahmedabad" } });
    expect(last.quickReplies.at(-1)!.label).toBe("मेरा शहर सूची में नहीं है");
  });

  it("asks the tools question as a multi-select", async () => {
    const { engine, sessions } = makeEngine();
    const { replies } = await runChat(engine, sessions, "en", OFFICE_CHAT.slice(0, 4));
    const last = replies.at(-1)!;
    expect(last.expecting).toBe("tools");
    expect(last.multiSelect).toBe(true);
    expect(last.quickReplies.map((q) => q.choice)).toEqual([
      { slot: "tools", value: ["pos"] },
      { slot: "tools", value: ["email"] },
      { slot: "tools", value: ["cctv"] },
      { slot: "tools", value: ["messaging"] },
      { slot: "tools", value: [] },
    ]);
  });

  it("explains the recommendation with the price, terms and a why for every product", async () => {
    const { engine, sessions } = makeEngine();
    const { replies } = await runChat(engine, sessions, "en", OFFICE_CHAT);
    const last = replies.at(-1)!;
    const text = last.messages.map((m) => m.text).join("\n");
    expect(text).toContain("For your Dental clinic in Kochi (5 people, 1 location) I recommend Office Pro at ₹4,215/month.");
    expect(text).toContain("One-time setup ₹1,500, contract 12 months, ready in about 5 days.");
    expect(last.recommendation!.items.find((i) => i.productId === "P02")!.why).toBe(
      "300 Mbps fibre so the whole team can work, video-call and use cloud tools at once. It replaces the mobile hotspot you use today.",
    );
    expect(last.recommendation!.whySource).toBe("rules");
  });

  it("lists what the rules engine left out and why", async () => {
    const { engine, sessions } = makeEngine();
    const { replies } = await runChat(engine, sessions, "en", ["restaurant chain, 2 outlets in Indore, 15 people", "no gst", "broadband", "none"]);
    const text = replies.at(-1)!.messages.map((m) => m.text).join("\n");
    expect(text).toContain("Not included for now: Managed SD-WAN (Needs at least 3 locations. Needs an active GSTIN.), Toll-free Number (Needs an active GSTIN.)");
  });

  it("answers a product question with the rules engine's verdict and a product card", async () => {
    const { engine, sessions } = makeEngine();
    const { replies } = await runChat(engine, sessions, "en", [...OFFICE_CHAT, "can I get cloud telephony?"]);
    const m = replies.at(-1)!.messages[0]!;
    expect(m.source).toBe("rules");
    expect(m.text).toBe(
      "Cloud Telephony / SIP: Business phone lines over internet with IVR, call recording. ₹1,000/month per channel + ₹2,000 one-time setup. It isn't available for your business: Needs an active GSTIN.",
    );
    expect(m.products).toEqual([expect.objectContaining({ productId: "P12", eligible: false, addOn: false, inBundle: false })]);
  });

  it("before the business is known, a product question lists who can get it", async () => {
    const { engine, sessions } = makeEngine();
    const { replies } = await runChat(engine, sessions, "en", ["What is SD-WAN?"]);
    const m = replies.at(-1)!.messages[0]!;
    expect(m.products![0]!.eligible).toBeNull();
    expect(m.text).toContain("Who can get it: Needs at least 10 people working at the business. Needs at least 3 locations. Needs an active GSTIN.");
    expect(m.text).toContain("I'll confirm once I know a bit more about your business.");
  });

  it("answers a price question before and after the recommendation", async () => {
    const { engine, sessions } = makeEngine();
    const before = await runChat(engine, sessions, "en", ["how much does it cost?"]);
    expect(before.replies.at(-1)!.messages[0]!.text).toBe("I'll show you one clear monthly price as soon as I know a little more about your business.");
    const after = await runChat(engine, sessions, "en", [...OFFICE_CHAT, "how much is it?"]);
    expect(after.replies.at(-1)!.messages[0]!.text).toBe(
      "Office Pro: ₹4,215/month, one-time setup ₹1,500, contract 12 months, ready in about 5 days. These are list prices from our catalogue.",
    );
  });

  it("re-recommends when an answer changes after the recommendation", async () => {
    const { engine, sessions } = makeEngine();
    const { replies } = await runChat(engine, sessions, "en", [...OFFICE_CHAT, "actually we do have an active GST"]);
    const last = replies.at(-1)!;
    expect(last.messages.map((m) => m.text)).toContain("I've updated your bundle with that change.");
    expect(last.recommendation!.quoteRequest.profile.gstin).toBe("active");
  });

  it("rejects an impossible number and asks again", async () => {
    const { engine, sessions } = makeEngine();
    const { replies } = await runChat(engine, sessions, "en", ["shop", "0"]);
    expect(replies.at(-1)!.messages.map((m) => m.text)).toEqual([
      "Please give the number of people as a whole number from 1 to 100000.",
      "How many people work there, including you?",
    ]);
    const r = await runChat(engine, sessions, "en", [{ slot: "businessKind", value: "shop" }, { slot: "employees", value: 0 }]);
    expect(r.replies.at(-1)!.messages[0]!.text).toBe("Please give the number of people as a whole number from 1 to 100000.");
  });

  it("offers a person after three messages it cannot understand", async () => {
    const { engine, sessions } = makeEngine();
    const { session, replies } = await runChat(engine, sessions, "en", ["asdf", "qwerty", "zxcv"]);
    const last = replies.at(-1)!;
    expect(session.stuck).toBe(true);
    expect(last.messages.map((m) => m.text)).toContain(
      "I'm having trouble understanding. A person from our team can help: tap “Talk to a person”, or try one of the options below.",
    );
    expect(last.quickReplies.at(-1)).toEqual({ label: "Talk to a person", choice: { slot: "action", value: "human" } });
  });

  it("hands over to a person, and opens the 'why not' form", async () => {
    const { engine, sessions } = makeEngine();
    const human = await runChat(engine, sessions, "en", ["I want to talk to a real person"]);
    expect(human.replies.at(-1)!.action).toBe("handoff");
    expect(human.replies.at(-1)!.quickReplies).toEqual([]);
    const no = await runChat(engine, sessions, "en", [{ slot: "action", value: "not_interested" }]);
    expect(no.replies.at(-1)!.action).toBe("not_interested");
  });

  it("starts again", async () => {
    const { engine, sessions } = makeEngine();
    const { session, replies } = await runChat(engine, sessions, "en", [...OFFICE_CHAT, "start over"]);
    expect(session.answers).toEqual({});
    expect(replies.at(-1)!.recommendation).toBeNull();
    expect(replies.at(-1)!.expecting).toBe("businessKind");
  });

  it("switches language mid-chat", async () => {
    const { engine, sessions } = makeEngine();
    const session = sessions.create("en");
    await engine.start(session);
    const r = await engine.handle(session, { lang: "hi", text: "dental clinic" });
    expect(r.lang).toBe("hi");
    expect(r.messages.at(-1)!.text).toBe("वहाँ कितने लोग काम करते हैं, आप समेत?");
  });
});

describe("with an LLM", () => {
  it("uses the LLM's words when they pass the checks, and says so", async () => {
    const llm = honestLlm();
    const { engine, sessions } = makeEngine(llm);
    const { replies } = await runChat(engine, sessions, "en", OFFICE_CHAT);
    const last = replies.at(-1)!;
    expect(last.mode).toBe("gemini");
    expect(last.messages.find((m) => m.source === "gemini")?.text).toContain("Office Pro suits your business at ₹4,215/month.");
    expect(last.recommendation!.items[0]!.why).toBe("Biz Fibre 300 helps your daily work.");
  });

  it("never sends the LLM a GSTIN, phone number or name it can identify", async () => {
    const llm = honestLlm();
    const { engine, sessions } = makeEngine(llm);
    await runChat(engine, sessions, "en", ["I run a clinic, GSTIN 27XUIXG0767D1ZP, my number is 9876543210, mail a@b.com"]);
    const sent = JSON.stringify(llm.calls);
    expect(sent).not.toContain("27XUIXG0767D1ZP");
    expect(sent).not.toContain("9876543210");
    expect(sent).not.toContain("a@b.com");
    expect(llm.calls.understand[0]!.message).toContain("27XUIX******1ZP");
  });

  it("does not call the LLM for a short plain answer to the question asked (saves quota)", async () => {
    const llm = honestLlm();
    const { engine, sessions } = makeEngine(llm);
    await runChat(engine, sessions, "en", ["I run a dental clinic in Kochi", "5", "1", "no", { slot: "internet", value: "none" }]);
    expect(llm.calls.understand.map((c) => c.message)).toEqual(["I run a dental clinic in Kochi"]);
  });

  it("drops an acknowledgement that names a product or a price, and uses its own", async () => {
    const llm = fakeLlm({ understand: () => ({ ack: "Great, Biz Fibre 300 is ₹1,499!" }) });
    const { engine, sessions } = makeEngine(llm);
    const { replies } = await runChat(engine, sessions, "en", ["I run a dental clinic in Kochi"]);
    expect(replies.at(-1)!.messages[0]).toEqual({ text: "Noted: Dental clinic, Kochi.", source: "rules" });
  });

  it("a question gets the answer without the LLM's acknowledgement in front of it", async () => {
    const llm = fakeLlm({
      understand: () => ({ intent: "product_question", productIds: ["P10"], ack: "Sure, noted!" }),
      explain: () => ({ text: "A person from our team can help with that.", lines: [] }),
    });
    const { engine, sessions } = makeEngine(llm);
    const { replies } = await runChat(engine, sessions, "en", [...OFFICE_CHAT, "can I get SD-WAN?"]);
    expect(replies.at(-1)!.messages.map((m) => m.text).join(" ")).not.toContain("Sure, noted!");
  });

  it("an off-topic message gets the LLM's polite redirect and the question again", async () => {
    const llm = fakeLlm({
      understand: () => ({ intent: "unclear", offTopic: true, updates: {}, ack: "I can only help with internet, phone and cloud services for your business." }),
    });
    const { engine, sessions } = makeEngine(llm);
    const { session, replies } = await runChat(engine, sessions, "en", ["who will win the cricket match today?"]);
    expect(replies.at(-1)!.messages).toEqual([
      { text: "I can only help with internet, phone and cloud services for your business.", source: "gemini" },
      expect.objectContaining({ text: expect.stringContaining("What kind of business") }),
    ]);
    expect(session.unclearStreak).toBe(0);
  });

  it("values the LLM extracts are validated: an impossible size is rejected, not used", async () => {
    const llm = fakeLlm({ understand: () => ({ updates: { businessKind: "bank", employees: -3, city: "Atlantis" }, intent: "answer" }) });
    const { engine, sessions } = makeEngine(llm);
    const { session } = await runChat(engine, sessions, "en", ["we are a big bank with minus three people in Atlantis"]);
    expect(session.answers).toEqual({});
  });

  it("the LLM cannot add products: an ineligible product it names only gets a 'not available' card", async () => {
    const llm = fakeLlm({
      understand: () => ({ intent: "product_question", productIds: ["P10", "P99"] }),
      explain: () => ({ text: "Yes! Managed SD-WAN is perfect for you.", lines: [] }),
    });
    const { engine, sessions } = makeEngine(llm);
    const { replies } = await runChat(engine, sessions, "en", [...OFFICE_CHAT, "tell me about the network thing"]);
    const m = replies.at(-1)!.messages[0]!;
    expect(m.products!.map((p) => [p.productId, p.eligible])).toEqual([["P10", false]]);
    expect(m.source).toBe("rules");
    expect(m.text).not.toContain("perfect");
  });

  it("for an ineligible product the verdict is always the rules' sentence, the LLM only adds to it", async () => {
    const llm = fakeLlm({
      understand: () => ({ intent: "product_question", productIds: ["P12"] }),
      explain: () => ({ text: "A person from our team can suggest other ways to take calls.", lines: [] }),
    });
    const { engine, sessions } = makeEngine(llm);
    const { replies } = await runChat(engine, sessions, "en", [...OFFICE_CHAT, "can I get cloud telephony?"]);
    const m = replies.at(-1)!.messages[0]!;
    expect(m.source).toBe("gemini");
    expect(m.text.startsWith("Cloud Telephony / SIP: Business phone lines")).toBe(true);
    expect(m.text).toContain("It isn't available for your business: Needs an active GSTIN.");
    expect(m.text.endsWith("A person from our team can suggest other ways to take calls.")).toBe(true);
  });

  it("a recommendation text with a wrong price is replaced by the template", async () => {
    const llm = fakeLlm({ explain: () => ({ text: "Office Pro for just ₹3,000/month!", lines: [] }) });
    const { engine, sessions } = makeEngine(llm);
    const { replies } = await runChat(engine, sessions, "en", OFFICE_CHAT);
    const m = replies.at(-1)!.messages.find((x) => x.text.includes("Office Pro"))!;
    expect(m.source).toBe("rules");
    expect(m.text).toContain("₹4,215/month");
    expect(m.text).not.toContain("3,000");
  });

  it("a 'why' line for a product outside the bundle is ignored; a bad one falls back per line", async () => {
    const llm = fakeLlm({
      explain: () => ({
        text: "Office Pro suits your clinic at ₹4,215/month.",
        lines: [
          { productId: "P10", why: "SD-WAN links your branches." },
          { productId: "P02", why: "Fast fibre for your clinic." },
          { productId: "P09", why: "Only ₹1 extra!" },
        ],
      }),
    });
    const { engine, sessions } = makeEngine(llm);
    const { replies } = await runChat(engine, sessions, "en", OFFICE_CHAT);
    const items = replies.at(-1)!.recommendation!.items;
    expect(items.map((i) => i.productId)).not.toContain("P10");
    expect(items.find((i) => i.productId === "P02")!.why).toBe("Fast fibre for your clinic.");
    expect(items.find((i) => i.productId === "P09")!.why).toBe(
      "If the main line goes down, a 4G/5G backup switches on by itself, so you stay online.",
    );
  });

  it("a Hindi chat rejects an English LLM reply", async () => {
    const llm = fakeLlm({ explain: () => ({ text: "Office Pro suits you at ₹4,215/month.", lines: [] }) });
    const { engine, sessions } = makeEngine(llm);
    const { replies } = await runChat(engine, sessions, "hi", ["कोच्चि में डेंटल क्लिनिक, 5 लोग", "1", "नहीं", "मोबाइल हॉटस्पॉट", "ईमेल"]);
    const m = replies.at(-1)!.messages.find((x) => x.text.includes("Office Pro"))!;
    expect(m.source).toBe("rules");
    expect(m.text).toContain("मेरा सुझाव है: Office Pro, ₹4,215/महीना।");
  });

  it("a request for a person is honoured even if the LLM misses it", async () => {
    const llm = fakeLlm({ understand: () => ({ intent: "answer" }) });
    const { engine, sessions } = makeEngine(llm);
    const { replies } = await runChat(engine, sessions, "en", ["I am a clinic, please call me back"]);
    expect(replies.at(-1)!.action).toBe("handoff");
  });
});

describe("LLM failures: the advisor keeps working on its rules", () => {
  it.each(["quota", "timeout", "upstream", "unreachable", "disabled", "bad_output"] as const)(
    "%s -> rule-based answer, same recommendation",
    async (kind) => {
      const llm = fakeLlm({
        understand: () => {
          throw new LlmError(kind);
        },
      });
      const { engine, sessions } = makeEngine(llm);
      const { replies } = await runChat(engine, sessions, "en", OFFICE_CHAT);
      const last = replies.at(-1)!;
      expect(last.recommendation!.name).toBe("Office Pro");
      expect(last.recommendation!.totals.monthlyInr).toBe(4215);
      expect(last.messages.every((m) => m.source === "rules")).toBe(true);
    },
  );

  it("after a quota error the LLM is paused for the time Google asks, then tried again", async () => {
    let now = 0;
    let fail = true;
    const llm = fakeLlm({
      understand: () => {
        if (fail) throw new LlmError("quota", 90_000);
        return {};
      },
    });
    const { engine, sessions, gate } = makeEngine(llm, () => now);
    const session = sessions.create("en");
    await engine.start(session);
    await engine.handle(session, { lang: "en", text: "I run a dental clinic in Kochi" });
    expect(llm.calls.understand).toHaveLength(1);
    expect(gate.available()).toBe(false);

    fail = false;
    now = 60_000; // still paused (Google asked for 90 s)
    const paused = await engine.handle(session, { lang: "en", text: "we are five people working here" });
    expect(llm.calls.understand).toHaveLength(1);
    expect(paused.mode).toBe("basic");

    now = 90_000;
    await engine.handle(session, { lang: "en", text: "we have only one location for now" });
    expect(llm.calls.understand).toHaveLength(2);
    expect(gate.available()).toBe(true);
  });

  it("logs the failure kind, never the message", async () => {
    const llm = fakeLlm({
      understand: () => {
        throw new LlmError("timeout");
      },
    });
    const { engine, sessions, logLines } = makeEngine(llm);
    await runChat(engine, sessions, "en", ["my clinic GSTIN is 27XUIXG0767D1ZP"]);
    const logs = logLines.join("\n");
    expect(logs).toContain('"llm":"timeout"');
    expect(logs).not.toContain("27XUIXG0767D1ZP");
    expect(logs).not.toContain("my clinic");
  });
});
