import { describe, expect, it, vi } from "vitest";
import { createAiServiceLlm, LlmError, LlmGate, parseExplanation, parseUnderstanding } from "../../src/advisor/llm.js";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const REQ = {
  lang: "en" as const,
  expecting: null,
  known: {},
  cities: ["Pune"],
  products: [],
  recentTurns: [],
  message: "hi",
};

async function kindOf(p: Promise<unknown>) {
  try {
    await p;
    return "ok";
  } catch (err) {
    return err instanceof LlmError ? [err.kind, err.retryAfterMs] : "other";
  }
}

describe("ai-service client", () => {
  it("posts JSON to /advisor/understand and maps the answer", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      json(200, { businessKind: "office", employees: 5, city: null, intent: "answer", productIds: ["P02", "bad", 7], ack: "Thanks!" }),
    );
    const llm = createAiServiceLlm("http://ai", 1000, fetchFn);
    expect(await llm.understand(REQ)).toEqual({
      updates: { businessKind: "office", employees: 5 },
      intent: "answer",
      offTopic: false,
      productIds: ["P02"],
      ack: "Thanks!",
    });
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("http://ai/advisor/understand");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual(REQ);
  });

  it.each([
    [json(503, { error: "llm_disabled" }), ["disabled", undefined]],
    [json(503, { error: "llm_quota", retryAfterSeconds: 37 }), ["quota", 37_000]],
    [json(504, { error: "llm_timeout" }), ["timeout", undefined]],
    [json(502, { error: "llm_bad_output" }), ["bad_output", undefined]],
    [json(502, { error: "llm_upstream" }), ["upstream", undefined]],
    [json(422, { detail: [] }), ["upstream", undefined]],
    [new Response("not json", { status: 500 }), ["upstream", undefined]],
    [new Response("not json", { status: 200 }), ["bad_output", undefined]],
  ])("maps an error response to an error kind (%#)", async (response, expected) => {
    const llm = createAiServiceLlm("http://ai", 1000, vi.fn().mockResolvedValue(response));
    expect(await kindOf(llm.explain({ lang: "en", task: "answer", question: "q", facts: {} }))).toEqual(expected);
  });

  it("reports a refused connection as unreachable and a slow one as a timeout", async () => {
    const refused = createAiServiceLlm("http://ai", 1000, vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    expect(await kindOf(refused.understand(REQ))).toEqual(["unreachable", undefined]);
    const slow = createAiServiceLlm("http://ai", 1000, vi.fn().mockRejectedValue(Object.assign(new Error("t"), { name: "TimeoutError" })));
    expect(await kindOf(slow.understand(REQ))).toEqual(["timeout", undefined]);
  });

  it("status never throws", async () => {
    const on = createAiServiceLlm("http://ai", 1000, vi.fn().mockResolvedValue(json(200, { enabled: true, provider: "gemini", model: "gemini-3.5-flash-lite" })));
    expect(await on.status()).toEqual({ enabled: true, provider: "gemini", model: "gemini-3.5-flash-lite" });
    const off = createAiServiceLlm("http://ai", 1000, vi.fn().mockResolvedValue(json(200, { enabled: false, reason: "GEMINI_API_KEY is not set" })));
    expect(await off.status()).toEqual({ enabled: false, reason: "GEMINI_API_KEY is not set" });
    const down = createAiServiceLlm("http://ai", 1000, vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    expect(await down.status()).toEqual({ enabled: false, reason: "unreachable" });
  });
});

describe("response parsing", () => {
  it("treats the model's 'other' intent as off-topic, and an unknown intent as unclear", () => {
    expect(parseUnderstanding({ intent: "other" })).toMatchObject({ intent: "unclear", offTopic: true });
    expect(parseUnderstanding({ intent: "buy_everything" })).toMatchObject({ intent: "unclear", offTopic: false });
    expect(() => parseUnderstanding("nope")).toThrow(LlmError);
  });

  it("keeps only well-formed explanation lines", () => {
    expect(parseExplanation({ text: "t", lines: [{ productId: "P02", why: "w" }, { productId: 1 }, "x"] })).toEqual({
      text: "t",
      lines: [{ productId: "P02", why: "w" }],
    });
    expect(() => parseExplanation({ lines: [] })).toThrow(LlmError);
  });
});

describe("LlmGate", () => {
  it("returns null on failure and pauses calls for the cooldown", async () => {
    let now = 0;
    const failures: string[] = [];
    const fn = vi.fn().mockRejectedValue(new LlmError("timeout"));
    const gate = new LlmGate({} as never, (k) => failures.push(k), () => now);
    expect(await gate.call(fn)).toBeNull();
    expect(failures).toEqual(["timeout"]);
    expect(await gate.call(fn)).toBeNull();
    expect(fn).toHaveBeenCalledTimes(1);
    now = 30_000;
    fn.mockResolvedValueOnce("ok");
    expect(await gate.call(fn)).toBe("ok");
    expect(gate.lastFailureKind).toBeNull();
  });

  it("a bad answer does not pause the LLM", async () => {
    const gate = new LlmGate({} as never, () => undefined, () => 0);
    await gate.call(() => Promise.reject(new LlmError("bad_output")));
    expect(gate.available()).toBe(true);
  });
});
