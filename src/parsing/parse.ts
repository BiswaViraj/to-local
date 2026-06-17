import type { ParsedTimestamp, TimestampParser } from "./types";

const MAX_OFFSET_MINUTES = 14 * 60;

const MONTHS: Record<string, number> = {
  Jan: 1,
  Feb: 2,
  Mar: 3,
  Apr: 4,
  May: 5,
  Jun: 6,
  Jul: 7,
  Aug: 8,
  Sep: 9,
  Oct: 10,
  Nov: 11,
  Dec: 12
};

interface Fields {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

// Builds a whole-second UTC instant, rejecting impossible calendar/clock
// values. Returns null rather than silently rolling over (e.g. Feb 30).
function toEpochMs(fields: Fields, offsetMinutes: number): number | null {
  const { year, month, day, hour, minute, second } = fields;

  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (Math.abs(offsetMinutes) > MAX_OFFSET_MINUTES) return null;

  const utc = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(utc);
  // Round-trip guards against overflowing dates such as 2026-02-30.
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }

  return utc - offsetMinutes * 60_000;
}

// Parses Z, ±HH:MM, ±HHMM, and the explicit words UTC/GMT into offset minutes.
function parseOffset(token: string): number | null {
  const trimmed = token.trim();
  if (trimmed === "Z" || trimmed === "UTC" || trimmed === "GMT") {
    return 0;
  }

  const match = /^([+-])(\d{2}):?(\d{2})$/.exec(trimmed);
  if (!match) {
    return null;
  }

  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (minutes > 59) {
    return null;
  }

  return sign * (hours * 60 + minutes);
}

function build(
  fields: Fields,
  offsetMinutes: number,
  fraction: string,
  source: string,
  parserId: string
): ParsedTimestamp | null {
  const epochMs = toEpochMs(fields, offsetMinutes);
  if (epochMs === null) {
    return null;
  }
  return { epochMs, offsetMinutes, fraction, source, parserId };
}

// ISO 8601 / RFC 3339, including the space-separated log variant and explicit
// UTC/GMT suffixes. A zone is mandatory: zone-less values never match.
const ISO =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:[.,](\d{1,9}))?(Z|[+-]\d{2}:?\d{2}| ?(?:UTC|GMT))$/;

const isoParser: TimestampParser = {
  id: "iso-8601",
  parse(input) {
    const m = ISO.exec(input);
    if (!m) return null;
    const offsetMinutes = parseOffset(m[8]!);
    if (offsetMinutes === null) return null;
    return build(
      {
        year: Number(m[1]),
        month: Number(m[2]),
        day: Number(m[3]),
        hour: Number(m[4]),
        minute: Number(m[5]),
        second: Number(m[6])
      },
      offsetMinutes,
      m[7] ?? "",
      input,
      this.id
    );
  }
};

// RFC 1123 / RFC 2822, e.g. "Tue, 15 Jun 2026 08:42:11 GMT" or "... +0530".
// Only GMT, UTC, and numeric offsets are accepted; abbreviations like IST or
// EST are intentionally rejected as ambiguous.
const RFC2822 =
  /^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+)?(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s+(GMT|UTC|[+-]\d{4})$/;

const rfc2822Parser: TimestampParser = {
  id: "rfc-2822",
  parse(input) {
    const m = RFC2822.exec(input);
    if (!m) return null;
    const offsetMinutes = parseOffset(m[7]!);
    if (offsetMinutes === null) return null;
    return build(
      {
        year: Number(m[3]),
        month: MONTHS[m[2]!]!,
        day: Number(m[1]),
        hour: Number(m[4]),
        minute: Number(m[5]),
        second: m[6] ? Number(m[6]) : 0
      },
      offsetMinutes,
      "",
      input,
      this.id
    );
  }
};

// Apache / Nginx common log format, e.g. "15/Jun/2026:08:42:11 +0000".
const CLF =
  /^(\d{2})\/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-]\d{4})$/;

const clfParser: TimestampParser = {
  id: "clf",
  parse(input) {
    const m = CLF.exec(input);
    if (!m) return null;
    const offsetMinutes = parseOffset(m[7]!);
    if (offsetMinutes === null) return null;
    return build(
      {
        year: Number(m[3]),
        month: MONTHS[m[2]!]!,
        day: Number(m[1]),
        hour: Number(m[4]),
        minute: Number(m[5]),
        second: Number(m[6])
      },
      offsetMinutes,
      "",
      input,
      this.id
    );
  }
};

export const PARSERS: readonly TimestampParser[] = [
  isoParser,
  rfc2822Parser,
  clfParser
];

/**
 * Parses a trimmed candidate string against every known explicit-zone format.
 * Returns null for anything ambiguous, zone-less, or malformed.
 */
export function parseTimestamp(input: string): ParsedTimestamp | null {
  const trimmed = input.trim();
  if (trimmed === "") {
    return null;
  }
  for (const parser of PARSERS) {
    const result = parser.parse(trimmed);
    if (result) {
      return result;
    }
  }
  return null;
}
