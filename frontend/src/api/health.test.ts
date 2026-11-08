import { describe, expect, it, vi } from "vitest";
import { fetchSystemHealth } from "./health";

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("fetchSystemHealth", () => {
  it("calls /api/health/full and reports both services ok", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse(200, { status: "ok", services: { backend: { status: "ok" }, aiService: { status: "ok" } } }),
    );
    expect(await fetchSystemHealth(fetchFn)).toEqual({ backend: "ok", aiService: "ok" });
    expect(fetchFn).toHaveBeenCalledWith("/api/health/full", expect.objectContaining({ headers: expect.any(Object) }));
  });

  it("reads the 503 degraded body: backend ok, ai-service down", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse(503, {
        status: "degraded",
        services: { backend: { status: "ok" }, aiService: { status: "unreachable", reason: "connection failed" } },
      }),
    );
    expect(await fetchSystemHealth(fetchFn)).toEqual({ backend: "ok", aiService: "down" });
  });

  it("backend unreachable (network error): backend down, ai-service unknown", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await fetchSystemHealth(fetchFn)).toEqual({ backend: "down", aiService: "unknown" });
  });

  it("dev proxy error page (not JSON): backend down, ai-service unknown", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("proxy error", { status: 500 }));
    expect(await fetchSystemHealth(fetchFn)).toEqual({ backend: "down", aiService: "unknown" });
  });

  it("rethrows when the request was aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const fetchFn = vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError"));
    await expect(fetchSystemHealth(fetchFn, ac.signal)).rejects.toThrow("aborted");
  });
});
