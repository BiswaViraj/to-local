import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { parseTimestamp } from "../src/parsing/parse";

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

function offsetToken(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

// Offsets that real zones use, all within ±14:00.
const offsetArb = fc.constantFrom(
  0,
  60,
  -60,
  330,
  345,
  -480,
  -300,
  840,
  -720,
  540
);

const fieldsArb = fc.record({
  year: fc.integer({ min: 1970, max: 2099 }),
  month: fc.integer({ min: 1, max: 12 }),
  day: fc.integer({ min: 1, max: 28 }), // safe across every month
  hour: fc.integer({ min: 0, max: 23 }),
  minute: fc.integer({ min: 0, max: 59 }),
  second: fc.integer({ min: 0, max: 59 }),
  offset: offsetArb
});

describe("parseTimestamp — round-trip property", () => {
  it("recovers the instant from any well-formed ISO value", () => {
    fc.assert(
      fc.property(fieldsArb, (f) => {
        const input = `${pad(f.year, 4)}-${pad(f.month)}-${pad(f.day)}T${pad(
          f.hour
        )}:${pad(f.minute)}:${pad(f.second)}${
          f.offset === 0 ? "Z" : offsetToken(f.offset)
        }`;

        const result = parseTimestamp(input);
        expect(result).not.toBeNull();

        const expected =
          Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second) -
          f.offset * 60_000;
        expect(result!.epochMs).toBe(expected);
        expect(result!.offsetMinutes).toBe(f.offset);
      })
    );
  });

  it("preserves any 1-9 digit fraction", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[0-9]{1,9}$/),
        fieldsArb,
        (fraction, f) => {
          const input = `${pad(f.year, 4)}-${pad(f.month)}-${pad(
            f.day
          )}T${pad(f.hour)}:${pad(f.minute)}:${pad(f.second)}.${fraction}Z`;
          expect(parseTimestamp(input)?.fraction).toBe(fraction);
        }
      )
    );
  });
});

describe("parseTimestamp — fuzz safety", () => {
  it("never throws on arbitrary input", () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        expect(() => parseTimestamp(input)).not.toThrow();
      })
    );
  });

  it("never treats a bare number as a timestamp", () => {
    fc.assert(
      fc.property(fc.integer(), (n) => {
        expect(parseTimestamp(String(n))).toBeNull();
      })
    );
  });

  it("rejects ISO shapes that carry no zone", () => {
    fc.assert(
      fc.property(fieldsArb, (f) => {
        const zoneless = `${pad(f.year, 4)}-${pad(f.month)}-${pad(
          f.day
        )}T${pad(f.hour)}:${pad(f.minute)}:${pad(f.second)}`;
        expect(parseTimestamp(zoneless)).toBeNull();
      })
    );
  });
});
