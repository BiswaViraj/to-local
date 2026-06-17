export interface ParsedTimestamp {
  /** Whole-second UTC instant in epoch milliseconds. */
  epochMs: number;
  /** Source UTC offset in minutes east of UTC (UTC, GMT, and Z are 0). */
  offsetMinutes: number;
  /** Raw fractional-second digits with no separator (1-9 chars), or "". */
  fraction: string;
  /** The exact recognized source substring. */
  source: string;
  /** Identifier of the parser that matched, for diagnostics. */
  parserId: string;
}

export interface TimestampParser {
  id: string;
  /** Returns a parsed instant, or null when the input is not this format. */
  parse(input: string): ParsedTimestamp | null;
}
