export type AiServiceStatus =
  | { status: "ok"; version: string; latencyMs: number }
  | { status: "unreachable"; reason: string };

type FetchFn = typeof fetch;

/**
 * Check the ai-service's GET /health. Never throws: any failure (connection refused,
 * timeout, bad status, bad body) is reported as "unreachable" with a short reason.
 */
export async function checkAiService(
  baseUrl: string,
  timeoutMs: number,
  fetchFn: FetchFn = fetch,
): Promise<AiServiceStatus> {
  const started = performance.now();
  try {
    const res = await fetchFn(`${baseUrl}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { status: "unreachable", reason: `HTTP ${res.status}` };
    const body = (await res.json()) as { status?: unknown; version?: unknown };
    if (body.status !== "ok") return { status: "unreachable", reason: "unexpected health response" };
    return {
      status: "ok",
      version: typeof body.version === "string" ? body.version : "unknown",
      latencyMs: Math.round(performance.now() - started),
    };
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return { status: "unreachable", reason: `timed out after ${timeoutMs} ms` };
    }
    return { status: "unreachable", reason: "connection failed" };
  }
}
