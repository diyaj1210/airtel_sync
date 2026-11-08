import { describe, expect, it } from "vitest";
import { parseCsv } from "../../src/catalogue/csv.js";

describe("parseCsv", () => {
  it("parses a header and rows into objects", () => {
    expect(parseCsv("a,b\n1,2\n3,4\n")).toEqual([
      { a: "1", b: "2" },
      { a: "3", b: "4" },
    ]);
  });

  it("handles quoted fields with commas, escaped quotes and newlines", () => {
    expect(parseCsv('id,desc\nP01,"Fibre, 100 Mbps ""unlimited"""\nP02,"two\nlines"\n')).toEqual([
      { id: "P01", desc: 'Fibre, 100 Mbps "unlimited"' },
      { id: "P02", desc: "two\nlines" },
    ]);
  });

  it("handles CRLF line endings, a BOM, empty fields and no trailing newline", () => {
    expect(parseCsv("﻿a,b,c\r\n1,,3\r\n4,5,")).toEqual([
      { a: "1", b: "", c: "3" },
      { a: "4", b: "5", c: "" },
    ]);
  });

  it("skips blank lines", () => {
    expect(parseCsv("a\n1\n\n2\n\n")).toEqual([{ a: "1" }, { a: "2" }]);
  });

  it("rejects rows with the wrong number of fields", () => {
    expect(() => parseCsv("a,b\n1,2,3\n")).toThrow(/row 2 has 3 fields, expected 2/);
  });

  it("rejects an unterminated quote and a stray quote", () => {
    expect(() => parseCsv('a\n"open\n')).toThrow(/ends inside a quoted field/);
    expect(() => parseCsv('a\nab"c\n')).toThrow(/stray quote/);
  });

  it("rejects empty input and duplicate columns", () => {
    expect(() => parseCsv("")).toThrow(/empty/);
    expect(() => parseCsv("a,a\n1,2\n")).toThrow(/duplicate column "a"/);
  });
});
