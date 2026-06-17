import { describe, expect, it } from "vitest";
import { findTimestamps, nearestTimestamp } from "../src/detection/scan";

describe("findTimestamps", () => {
  it("locates a timestamp inside a log line with correct bounds", () => {
    const line = '127.0.0.1 - [2026-06-15T08:42:11Z] "GET /" 200';
    const matches = findTimestamps(line);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.source).toBe("2026-06-15T08:42:11Z");
    expect(line.slice(matches[0]!.start, matches[0]!.end)).toBe(
      "2026-06-15T08:42:11Z"
    );
  });

  it("finds the Apache CLF form", () => {
    const line = '10.0.0.1 - - [15/Jun/2026:08:42:11 +0000] "GET /"';
    const matches = findTimestamps(line);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.source).toBe("15/Jun/2026:08:42:11 +0000");
  });

  it("finds multiple timestamps on one line", () => {
    const line = "start 2026-06-15T08:00:00Z end 2026-06-15T09:30:00Z";
    expect(findTimestamps(line)).toHaveLength(2);
  });

  it("ignores shapes the parser rejects", () => {
    expect(findTimestamps("bad 2026-02-30T08:42:11Z value")).toHaveLength(0);
    expect(findTimestamps("zone-less 2026-06-15T08:42:11 here")).toHaveLength(
      0
    );
    expect(findTimestamps("epoch 1718440931 here")).toHaveLength(0);
  });

  it("does not match a year embedded in a longer number", () => {
    expect(findTimestamps("id=12026-06-15T08:42:11Z")).toHaveLength(0);
  });
});

describe("nearestTimestamp", () => {
  const line = "start 2026-06-15T08:00:00Z mid 2026-06-15T09:30:00Z end";
  const first = line.indexOf("2026-06-15T08");
  const second = line.indexOf("2026-06-15T09");

  it("picks the timestamp under or nearest the offset", () => {
    expect(nearestTimestamp(line, first + 2)?.source).toBe(
      "2026-06-15T08:00:00Z"
    );
    expect(nearestTimestamp(line, second + 2)?.source).toBe(
      "2026-06-15T09:30:00Z"
    );
  });

  it("returns null when there is nothing to find", () => {
    expect(nearestTimestamp("no timestamps here", 5)).toBeNull();
  });
});
