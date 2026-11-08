import { describe, expect, it } from "vitest";
import { createLogger } from "../src/logger.js";

function capture(level: "debug" | "info" | "warn" | "error" | "silent") {
  const lines: string[] = [];
  const logger = createLogger({
    service: "test",
    level,
    sink: (line) => lines.push(line),
    now: () => new Date("2026-07-15T10:00:00.000Z"),
  });
  return { logger, lines };
}

describe("createLogger", () => {
  it("writes one JSON line with time, level, service and message", () => {
    const { logger, lines } = capture("info");
    logger.info("hello", { step: 0 });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual({
      time: "2026-07-15T10:00:00.000Z",
      level: "info",
      service: "test",
      msg: "hello",
      step: 0,
    });
  });

  it("masks identifiers in the message and in fields, and never writes documents", () => {
    const { logger, lines } = capture("info");
    logger.info("lookup 27XUIXG0767D1ZP", { udyam: "UDYAM-MH-00-9516696", document: "RAW-BYTES" });
    const line = lines[0]!;
    expect(line).not.toContain("27XUIXG0767D1ZP");
    expect(line).not.toContain("9516696");
    expect(line).not.toContain("RAW-BYTES");
    expect(JSON.parse(line)).toMatchObject({
      msg: "lookup 27XUIX******1ZP",
      udyam: "UDYAM-MH-00-****696",
      document: "[REDACTED]",
    });
  });

  it("filters by level", () => {
    const { logger, lines } = capture("warn");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    expect(lines.map((l) => JSON.parse(l).level)).toEqual(["warn", "error"]);
  });

  it("writes nothing at level silent", () => {
    const { logger, lines } = capture("silent");
    logger.error("e");
    expect(lines).toEqual([]);
  });

  it("does not let fields overwrite the logger's own keys", () => {
    const { logger, lines } = capture("info");
    logger.info("real message", { msg: "fake", level: "error", service: "evil" });
    expect(JSON.parse(lines[0]!)).toMatchObject({ msg: "real message", level: "info", service: "test" });
  });
});
