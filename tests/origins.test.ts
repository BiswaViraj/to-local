import { describe, expect, it } from "vitest";
import {
  normalizeOrigin,
  originToMatchPattern,
  uniqueMatchPatterns
} from "../src/runtime/origins";

describe("origin helpers", () => {
  it("normalizes a full origin and preserves explicit ports", () => {
    expect(normalizeOrigin("http://localhost:4173/logs?q=1")).toBe(
      "http://localhost:4173"
    );
  });

  it("rejects unsupported schemes and malformed values", () => {
    expect(normalizeOrigin("file:///tmp/logs.html")).toBeNull();
    expect(normalizeOrigin("not a url")).toBeNull();
  });

  it("maps full origins to Chrome host-scoped match patterns", () => {
    expect(originToMatchPattern("http://localhost:4173")).toBe(
      "http://localhost/*"
    );
  });

  it("deduplicates registrations while retaining separate app origins", () => {
    expect(
      uniqueMatchPatterns([
        "http://localhost:4173",
        "http://localhost:4174",
        "https://example.com"
      ])
    ).toEqual(["http://localhost/*", "https://example.com/*"]);
  });
});
