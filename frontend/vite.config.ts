import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// All services share the .env in the repo root.
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function port(raw: string | undefined, fallback: number, name: string): number {
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535, got "${raw}"`);
  }
  return value;
}

export default defineConfig(({ mode }) => {
  // Read the root .env for the dev-server config only. Nothing is exposed to the browser
  // bundle unless it starts with VITE_ (and we define none), so no secret can leak into it.
  const env = { ...loadEnv(mode, repoRoot, ""), ...process.env };
  const backendPort = port(env.BACKEND_PORT, 4000, "BACKEND_PORT");
  const frontendPort = port(env.FRONTEND_PORT, 5173, "FRONTEND_PORT");
  const proxy = { "/api": { target: `http://127.0.0.1:${backendPort}` } };

  return {
    plugins: [react()],
    envDir: repoRoot,
    server: { port: frontendPort, strictPort: true, proxy },
    preview: { port: frontendPort, strictPort: true, proxy },
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      include: ["src/**/*.test.{ts,tsx}"],
    },
  };
});
