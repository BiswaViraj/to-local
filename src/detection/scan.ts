import { parseTimestamp } from "../parsing/parse";
import type { ParsedTimestamp } from "../parsing/types";

export interface TextMatch {
  source: string;
  start: number;
  end: number;
  parsed: ParsedTimestamp;
}

const MON = "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec";
const DOW = "Mon|Tue|Wed|Thu|Fri|Sat|Sun";

// Loosely locates candidate spans; parseTimestamp is the strict gate that
// validates each one, so all real rules live in a single place.
const SCAN = new RegExp(
  [
    `(?<!\\d)\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}:\\d{2}(?:[.,]\\d{1,9})?(?:Z|[+-]\\d{2}:?\\d{2}| ?(?:UTC|GMT))`,
    `(?:(?:${DOW}),?\\s+)?(?<!\\d)\\d{1,2}\\s+(?:${MON})\\s+\\d{4}\\s+\\d{2}:\\d{2}(?::\\d{2})?\\s+(?:GMT|UTC|[+-]\\d{4})`,
    `(?<!\\d)\\d{2}\\/(?:${MON})\\/\\d{4}:\\d{2}:\\d{2}:\\d{2} [+-]\\d{4}`
  ].join("|"),
  "g"
);

/** Finds every valid explicit-zone timestamp in a string, with positions. */
export function findTimestamps(text: string): TextMatch[] {
  const matches: TextMatch[] = [];
  for (const m of text.matchAll(SCAN)) {
    const raw = m[0];
    const leading = raw.length - raw.trimStart().length;
    const source = raw.trim();
    const start = m.index + leading;
    const parsed = parseTimestamp(source);
    if (parsed) {
      matches.push({ source, start, end: start + source.length, parsed });
    }
  }
  return matches;
}

/** The valid timestamp nearest a character offset, or null if there is none. */
export function nearestTimestamp(
  text: string,
  offset: number
): TextMatch | null {
  let best: TextMatch | null = null;
  let bestDistance = Infinity;
  for (const match of findTimestamps(text)) {
    const distance =
      offset < match.start
        ? match.start - offset
        : offset > match.end
          ? offset - match.end
          : 0;
    if (distance < bestDistance) {
      best = match;
      bestDistance = distance;
    }
  }
  return best;
}
