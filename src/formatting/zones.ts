import type { TimeZonePreference } from "../storage/state";

/** Formats an offset in minutes as a signed ±HH:mm label. */
export function offsetLabel(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}

function parseGmtOffset(value: string): number {
  // Intl "longOffset" yields "GMT", "UTC", "GMT+05:30", or "GMT-08:00".
  const m = /^(?:GMT|UTC)(?:([+-])(\d{1,2}):?(\d{2}))?$/.exec(value);
  if (!m || !m[1]) {
    return 0;
  }
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

/** The target zone's UTC offset, in minutes, at a specific instant. */
export function zoneOffsetMinutes(epochMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset"
  }).formatToParts(new Date(epochMs));
  const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  return parseGmtOffset(name);
}

export interface ZoneClockParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
}

/** The wall-clock fields shown in a zone at an instant, padded for canonical use. */
export function zoneClockParts(
  epochMs: number,
  timeZone: string
): ZoneClockParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(epochMs));

  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";

  return {
    year: pick("year"),
    month: pick("month"),
    day: pick("day"),
    hour: pick("hour"),
    minute: pick("minute"),
    second: pick("second")
  };
}

/** Resolves a stored preference to a concrete IANA zone id. */
export function resolveTargetZone(preference: TimeZonePreference): string {
  if (preference.mode === "fixed") {
    return preference.zone;
  }
  return new Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** All IANA zones the runtime supports. */
export function listTimeZones(): string[] {
  return Intl.supportedValuesOf("timeZone");
}

/** Current offset label for a zone, for preview lists in the options page. */
export function currentOffsetLabel(timeZone: string, atMs: number): string {
  return offsetLabel(zoneOffsetMinutes(atMs, timeZone));
}
