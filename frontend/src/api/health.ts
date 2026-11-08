export type ServiceState = "ok" | "down" | "unknown";

export interface SystemHealth {
  backend: ServiceState;
  aiService: ServiceState;
}

interface FullHealthBody {
  services?: {
    backend?: { status?: unknown };
    aiService?: { status?: unknown };
  };
}

/**
 * Ask the backend for the health of the whole chain (backend + ai-service).
 * The backend answers 200 (all ok) or 503 (degraded) with a JSON body; both are read.
 * If the backend itself cannot be reached, the ai-service state is "unknown".
 */
export async function fetchSystemHealth(
  fetchFn: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<SystemHealth> {
  let body: FullHealthBody;
  try {
    const res = await fetchFn("/api/health/full", { signal, headers: { accept: "application/json" } });
    body = (await res.json()) as FullHealthBody;
  } catch (err) {
    if (signal?.aborted) throw err;
    return { backend: "down", aiService: "unknown" };
  }
  if (body?.services?.backend?.status !== "ok") return { backend: "down", aiService: "unknown" };
  return {
    backend: "ok",
    aiService: body.services.aiService?.status === "ok" ? "ok" : "down",
  };
}
