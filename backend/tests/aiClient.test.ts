import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { checkAiService } from "../src/aiClient.js";

let server: Server | undefined;

/** Start a real HTTP server on a free port; returns its base URL. */
async function startServer(handler: Parameters<typeof createServer>[1]): Promise<string> {
  server = createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
});

describe("checkAiService", () => {
  it("reports ok with version and latency when /health answers status ok", async () => {
    const url = await startServer((req, res) => {
      expect(req.url).toBe("/health");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ status: "ok", service: "ai-service", version: "0.1.0" }));
    });
    const result = await checkAiService(url, 2000);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.version).toBe("0.1.0");
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("reports unreachable on a non-2xx response", async () => {
    const url = await startServer((_req, res) => {
      res.statusCode = 500;
      res.end("boom");
    });
    expect(await checkAiService(url, 2000)).toEqual({ status: "unreachable", reason: "HTTP 500" });
  });

  it("reports unreachable when the body is not a healthy response", async () => {
    const url = await startServer((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ status: "starting" }));
    });
    expect(await checkAiService(url, 2000)).toEqual({
      status: "unreachable",
      reason: "unexpected health response",
    });
  });

  it("reports unreachable when nothing is listening", async () => {
    // Grab a free port, then close the server so the port refuses connections.
    const url = await startServer(() => {});
    server!.close();
    server = undefined;
    expect(await checkAiService(url, 2000)).toEqual({ status: "unreachable", reason: "connection failed" });
  });

  it("times out instead of hanging when the service never answers", async () => {
    const url = await startServer(() => {
      /* never respond */
    });
    const started = Date.now();
    expect(await checkAiService(url, 200)).toEqual({ status: "unreachable", reason: "timed out after 200 ms" });
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
