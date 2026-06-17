import { describe, expect, it } from "vitest";
import { parseTimestamp } from "../src/parsing/parse";

// 2026-06-15T08:42:11Z expressed five different ways. Every accepted form must
// resolve to this exact instant.
const INSTANT = Date.UTC(2026, 5, 15, 8, 42, 11);

describe("parseTimestamp — equivalent representations", () => {
  const equivalents: Array<[string, string]> = [
    ["2026-06-15T08:42:11Z", "iso-8601"],
    ["2026-06-15T08:42:11+00:00", "iso-8601"],
    ["2026-06-15 08:42:11 UTC", "iso-8601"],
    ["2026-06-15 08:42:11 GMT", "iso-8601"],
    ["2026-06-15T14:12:11+05:30", "iso-8601"],
    ["2026-06-15T14:12:11+0530", "iso-8601"],
    ["Mon, 15 Jun 2026 08:42:11 GMT", "rfc-2822"],
    ["15 Jun 2026 08:42:11 +0000", "rfc-2822"],
    ["15 Jun 2026 14:12:11 +0530", "rfc-2822"],
    ["15/Jun/2026:08:42:11 +0000", "clf"],
    ["15/Jun/2026:14:12:11 +0530", "clf"]
  ];

  it.each(equivalents)("parses %s to the shared instant", (input, parserId) => {
    const result = parseTimestamp(input);
    expect(result).not.toBeNull();
    expect(result!.epochMs).toBe(INSTANT);
    expect(result!.parserId).toBe(parserId);
    expect(result!.source).toBe(input);
  });
});

describe("parseTimestamp — offsets", () => {
  const cases: Array<[string, number]> = [
    ["2026-06-15T08:42:11Z", 0],
    ["2026-06-15T08:42:11-08:00", -480],
    ["2026-06-15T08:42:11+05:30", 330],
    ["2026-06-15T08:42:11+05:45", 345],
    ["2026-06-15T08:42:11+14:00", 840],
    ["2026-06-15T08:42:11-12:00", -720]
  ];

  it.each(cases)("reads the offset in %s", (input, offsetMinutes) => {
    expect(parseTimestamp(input)?.offsetMinutes).toBe(offsetMinutes);
  });
});

describe("parseTimestamp — fractions", () => {
  it("preserves 1 to 9 fraction digits verbatim", () => {
    for (let n = 1; n <= 9; n++) {
      const digits = "123456789".slice(0, n);
      const result = parseTimestamp(`2026-06-15T08:42:11.${digits}Z`);
      expect(result?.fraction).toBe(digits);
      // The whole-second instant ignores the fraction.
      expect(result?.epochMs).toBe(INSTANT);
    }
  });

  it("accepts a comma fraction separator", () => {
    expect(parseTimestamp("2026-06-15T08:42:11,500Z")?.fraction).toBe("500");
  });

  it("has no fraction when none is present", () => {
    expect(parseTimestamp("2026-06-15T08:42:11Z")?.fraction).toBe("");
  });
});

describe("parseTimestamp — rejected", () => {
  const rejected = [
    "",
    "   ",
    "2026-06-15T08:42:11", // zone-less
    "2026-06-15 08:42:11", // zone-less log
    "2026-06-15", // date only
    "08:42:11Z", // time only
    "1718440931", // bare unix epoch
    "1718440931000", // epoch millis
    "2026-06-15T08:42:11 IST", // ambiguous abbreviation
    "Mon, 15 Jun 2026 08:42:11 EST", // ambiguous abbreviation
    "15 Jun 2026 08:42:11 CST",
    "2026-02-30T08:42:11Z", // impossible date
    "2026-13-01T08:42:11Z", // impossible month
    "2026-06-15T24:00:00Z", // 24:00
    "2026-06-15T08:42:60Z", // leap second
    "2026-06-15T08:60:11Z", // minute 60
    "2026-06-15T08:42:11+15:00", // offset beyond +14:00
    "2026-06-15T08:42:11+05:99", // impossible offset minutes
    "2026-06-15T08:42Z", // missing seconds
    "yesterday at noon",
    "Jun 15 2026"
  ];

  it.each(rejected)("rejects %j", (input) => {
    expect(parseTimestamp(input)).toBeNull();
  });
});
