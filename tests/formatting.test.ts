import { describe, expect, it } from "vitest";
import { parseTimestamp } from "../src/parsing/parse";
import { convert } from "../src/formatting/format";
import type { DisplayPreferences } from "../src/storage/state";

function prefs(zone: string): DisplayPreferences {
  return {
    timeZone: { mode: "fixed", zone },
    hourCycle: "h23",
    theme: "system"
  };
}

function canonicalFor(input: string, zone: string): string {
  const parsed = parseTimestamp(input);
  if (!parsed) throw new Error(`unparseable: ${input}`);
  return convert(parsed, prefs(zone), { locale: "en-US" }).canonical;
}

describe("convert — canonical target-zone value", () => {
  it("rebases a UTC instant into a fixed half-hour zone", () => {
    expect(canonicalFor("2026-06-15T08:42:11Z", "Asia/Kolkata")).toBe(
      "2026-06-15T14:12:11+05:30"
    );
  });

  it("keeps the instant when the source already carries an offset", () => {
    expect(canonicalFor("2026-06-15T14:12:11+05:30", "UTC")).toBe(
      "2026-06-15T08:42:11+00:00"
    );
  });

  it("preserves sub-second fractions verbatim", () => {
    expect(canonicalFor("2026-06-15T08:42:11.123456Z", "UTC")).toBe(
      "2026-06-15T08:42:11.123456+00:00"
    );
  });
});

describe("convert — DST transitions", () => {
  it("uses the summer offset across a spring-forward gap", () => {
    // 2026-03-08 02:00 EST springs forward to 03:00 EDT.
    expect(canonicalFor("2026-03-08T06:59:00Z", "America/New_York")).toBe(
      "2026-03-08T01:59:00-05:00"
    );
    expect(canonicalFor("2026-03-08T07:00:00Z", "America/New_York")).toBe(
      "2026-03-08T03:00:00-04:00"
    );
  });

  it("uses the right offset across a fall-back overlap", () => {
    // 2026-11-01 02:00 EDT falls back to 01:00 EST.
    expect(canonicalFor("2026-11-01T05:59:00Z", "America/New_York")).toBe(
      "2026-11-01T01:59:00-04:00"
    );
    expect(canonicalFor("2026-11-01T06:00:00Z", "America/New_York")).toBe(
      "2026-11-01T01:00:00-05:00"
    );
  });

  it("handles a half-hour DST zone", () => {
    // Lord Howe Island shifts between +10:30 and +11:00.
    expect(canonicalFor("2026-06-15T00:00:00Z", "Australia/Lord_Howe")).toBe(
      "2026-06-15T10:30:00+10:30"
    );
    expect(canonicalFor("2026-01-15T00:00:00Z", "Australia/Lord_Howe")).toBe(
      "2026-01-15T11:00:00+11:00"
    );
  });
});

describe("convert — source, offset, relative, absolute", () => {
  const parsed = parseTimestamp("2026-06-15T14:12:11+05:30")!;

  it("reports the source value and offset label", () => {
    const result = convert(parsed, prefs("UTC"), { locale: "en-US" });
    expect(result.source).toBe("2026-06-15T14:12:11+05:30");
    expect(result.sourceOffset).toBe("+05:30");
    expect(result.targetOffset).toBe("+00:00");
    expect(result.targetZone).toBe("UTC");
  });

  it("phrases relative time against a reference instant", () => {
    const past = convert(parsed, prefs("UTC"), {
      locale: "en-US",
      nowMs: parsed.epochMs + 2 * 3600 * 1000
    });
    expect(past.relative).toBe("2 hours ago");

    const future = convert(parsed, prefs("UTC"), {
      locale: "en-US",
      nowMs: parsed.epochMs - 3 * 86_400 * 1000
    });
    expect(future.relative).toBe("in 3 days");
  });

  it("produces a non-empty localized absolute string", () => {
    const result = convert(parsed, prefs("Asia/Kolkata"), { locale: "en-US" });
    expect(result.absolute).toContain("2026");
    expect(result.absolute.length).toBeGreaterThan(0);
  });
});
