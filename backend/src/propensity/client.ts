import { Router } from "express";

/**
 * Lead propensity score (step 6): the model lives in the ai-service; the backend validates requests,
 * passes them on and checks the answers. Used by the back-office (step 7) to decide whom to call.
 *
 *   GET  /api/propensity/model             model card: inputs, excluded leakage columns, test AUC, bands
 *   POST /api/propensity/score             { leads: [{ id?, lead: { feature: value } }] } (1-500) -> scores + top 3 reasons
 *   GET  /api/propensity/leads/:leadId     score of a lead in smb_leads.csv (e.g. L00001)
 */

export interface PropensityApi {
  call(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; body: unknown }>;
}

export const NO_PROPENSITY: PropensityApi = {
  async call() {
    return { status: 503, body: { error: "propensity_unavailable" } };
  },
};

type FetchFn = typeof fetch;

export function createAiServicePropensity(baseUrl: string, timeoutMs: number, fetchFn: FetchFn = fetch): PropensityApi {
  return {
    async call(method, path, body) {
      try {
        const res = await fetchFn(`${baseUrl}${path}`, {
          method,
          headers: body === undefined ? { accept: "application/json" } : { "content-type": "application/json", accept: "application/json" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        return { status: res.status, body: await res.json() };
      } catch {
        return { status: 503, body: { error: "propensity_unavailable" } };
      }
    },
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const BANDS = ["high", "medium", "low"];

/** One score as the ai-service must send it; anything else is treated as the service being unavailable. */
function validScore(s: unknown): boolean {
  if (!isRecord(s)) return false;
  const { score, probability, band, reasons } = s;
  return (
    typeof score === "number" &&
    Number.isInteger(score) &&
    score >= 0 &&
    score <= 100 &&
    typeof probability === "number" &&
    probability >= 0 &&
    probability <= 1 &&
    typeof band === "string" &&
    BANDS.includes(band) &&
    Array.isArray(reasons) &&
    reasons.length <= 3 &&
    reasons.every((r) => isRecord(r) && typeof r.feature === "string" && typeof r.value === "string" && (r.effect === "up" || r.effect === "down") && typeof r.weight === "number")
  );
}

export function parseScoreRequest(body: unknown): string | null {
  if (!isRecord(body) || !Array.isArray(body.leads)) return "leads must be an array";
  if (body.leads.length < 1 || body.leads.length > 500) return "leads must have 1 to 500 items";
  for (const item of body.leads) {
    if (!isRecord(item) || !isRecord(item.lead)) return "each item needs a lead object";
    if (item.id !== undefined && (typeof item.id !== "string" || item.id.length > 40)) return "id must be a string of at most 40 characters";
    if (Object.keys(item).some((k) => k !== "id" && k !== "lead")) return "each item has only id and lead";
  }
  return null;
}

export function propensityRouter(api: PropensityApi): Router {
  const router = Router();
  const unavailable = { error: "propensity_unavailable" };

  router.get("/propensity/model", async (_req, res) => {
    const r = await api.call("GET", "/propensity/model");
    if (r.status === 200 && isRecord(r.body) && isRecord(r.body.metrics)) return void res.json(r.body);
    res.status(503).json(unavailable);
  });

  router.post("/propensity/score", async (req, res) => {
    const problem = parseScoreRequest(req.body);
    if (problem) return void res.status(400).json({ error: "invalid_request", details: [problem] });
    const r = await api.call("POST", "/propensity/score", req.body);
    if (r.status === 422 && isRecord(r.body)) return void res.status(422).json(r.body);
    const scores = isRecord(r.body) ? r.body.scores : undefined;
    if (r.status === 200 && Array.isArray(scores) && scores.length === (req.body.leads as unknown[]).length && scores.every(validScore)) {
      return void res.json({ scores });
    }
    res.status(503).json(unavailable);
  });

  router.get("/propensity/leads/:leadId", async (req, res) => {
    if (!/^L\d{5}$/.test(req.params.leadId)) return void res.status(404).json({ error: "lead_not_found" });
    const r = await api.call("GET", `/propensity/leads/${req.params.leadId}`);
    if (r.status === 404) return void res.status(404).json({ error: "lead_not_found" });
    if (r.status === 200 && validScore(r.body)) return void res.json(r.body);
    res.status(503).json(unavailable);
  });

  return router;
}
