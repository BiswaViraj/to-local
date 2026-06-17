import type { ParsedTimestamp } from "../parsing/types";
import type { DisplayPreferences, HourCyclePreference } from "../storage/state";
import {
  offsetLabel,
  resolveTargetZone,
  zoneClockParts,
  zoneOffsetMinutes
} from "./zones";

export interface ConversionResult {
  /** Localized absolute time in the target zone, including the zone name. */
  absolute: string;
  /** Relative phrasing such as "2 hours ago". */
  relative: string;
  /** The exact recognized source value. */
  source: string;
  /** The source offset as a ±HH:mm label. */
  sourceOffset: string;
  /** Canonical target-zone value: YYYY-MM-DDTHH:mm:ss[.fraction]±HH:mm. */
  canonical: string;
  /** The resolved target IANA zone. */
  targetZone: string;
  /** The target offset as a ±HH:mm label. */
  targetOffset: string;
}

export interface ConvertOptions {
  /** BCP-47 locale; defaults to the runtime locale. */
  locale?: string;
  /** Reference instant for relative phrasing; defaults to now. */
  nowMs?: number;
}

function hourCycleOption(
  preference: HourCyclePreference
): Intl.DateTimeFormatOptions {
  if (preference === "h12") return { hourCycle: "h12" };
  if (preference === "h23") return { hourCycle: "h23" };
  return {};
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 31_557_600],
  ["month", 2_629_800],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1]
];

function formatRelative(
  epochMs: number,
  nowMs: number,
  locale: string | undefined
): string {
  const deltaSeconds = Math.round((epochMs - nowMs) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  for (const [unit, seconds] of RELATIVE_UNITS) {
    if (Math.abs(deltaSeconds) >= seconds || unit === "second") {
      return rtf.format(Math.round(deltaSeconds / seconds), unit);
    }
  }
  return rtf.format(0, "second");
}

/**
 * Converts a parsed instant into everything the overlay and copy actions need,
 * formatted for the target zone and locale. Pure: instant in, strings out.
 */
export function convert(
  parsed: ParsedTimestamp,
  preferences: DisplayPreferences,
  options: ConvertOptions = {}
): ConversionResult {
  const { locale, nowMs = Date.now() } = options;
  const targetZone = resolveTargetZone(preferences.timeZone);
  const targetOffsetMinutes = zoneOffsetMinutes(parsed.epochMs, targetZone);
  const date = new Date(parsed.epochMs);

  const absolute = new Intl.DateTimeFormat(locale, {
    timeZone: targetZone,
    dateStyle: "medium",
    timeStyle: "long",
    ...hourCycleOption(preferences.hourCycle)
  }).format(date);

  const clock = zoneClockParts(parsed.epochMs, targetZone);
  const fraction = parsed.fraction ? `.${parsed.fraction}` : "";
  const canonical = `${clock.year}-${clock.month}-${clock.day}T${clock.hour}:${clock.minute}:${clock.second}${fraction}${offsetLabel(targetOffsetMinutes)}`;

  return {
    absolute,
    relative: formatRelative(parsed.epochMs, nowMs, locale),
    source: parsed.source,
    sourceOffset: offsetLabel(parsed.offsetMinutes),
    canonical,
    targetZone,
    targetOffset: offsetLabel(targetOffsetMinutes)
  };
}
