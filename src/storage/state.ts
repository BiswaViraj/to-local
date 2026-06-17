import { normalizeOrigin } from "../runtime/origins";

export const STATE_KEY = "toLocal:state";
// Phase 1 stored a bare origin array under this key. Kept only for migration.
export const LEGACY_ORIGINS_KEY = "toLocal:enabledOrigins";

export type TimeZonePreference =
  | { mode: "system" }
  | { mode: "fixed"; zone: string };

export type HourCyclePreference = "auto" | "h12" | "h23";

export type ThemePreference = "system" | "light" | "dark";

export interface DisplayPreferences {
  timeZone: TimeZonePreference;
  hourCycle: HourCyclePreference;
  theme: ThemePreference;
}

export interface StoredStateV1 {
  schemaVersion: 1;
  preferences: DisplayPreferences;
  enabledOrigins: string[];
  onboarding: { completed: boolean };
}

export const CURRENT_SCHEMA_VERSION = 1;

export function defaultState(): StoredStateV1 {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    preferences: {
      timeZone: { mode: "system" },
      hourCycle: "auto",
      theme: "system"
    },
    enabledOrigins: [],
    onboarding: { completed: false }
  };
}

function sanitizeOrigins(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return [
    ...new Set(
      values
        .filter((value): value is string => typeof value === "string")
        .map(normalizeOrigin)
        .filter((value): value is string => value !== null)
    )
  ].sort();
}

function sanitizePreferences(value: unknown): DisplayPreferences {
  const base = defaultState().preferences;
  if (typeof value !== "object" || value === null) {
    return base;
  }
  const input = value as Partial<DisplayPreferences>;

  const timeZone: TimeZonePreference =
    input.timeZone?.mode === "fixed" &&
    typeof input.timeZone.zone === "string" &&
    isValidTimeZone(input.timeZone.zone)
      ? { mode: "fixed", zone: input.timeZone.zone }
      : { mode: "system" };

  const hourCycle: HourCyclePreference =
    input.hourCycle === "h12" || input.hourCycle === "h23"
      ? input.hourCycle
      : "auto";

  const theme: ThemePreference =
    input.theme === "light" || input.theme === "dark" ? input.theme : "system";

  return { timeZone, hourCycle, theme };
}

export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

// Coerces any stored shape (current, legacy, or corrupt) into a valid
// StoredStateV1. Always returns usable defaults rather than throwing.
export function migrateState(
  raw: unknown,
  legacyOrigins?: unknown
): StoredStateV1 {
  const fallback = defaultState();

  if (typeof raw === "object" && raw !== null && "schemaVersion" in raw) {
    const input = raw as Partial<StoredStateV1>;
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      preferences: sanitizePreferences(input.preferences),
      enabledOrigins: sanitizeOrigins(input.enabledOrigins),
      onboarding: {
        completed: input.onboarding?.completed === true
      }
    };
  }

  // No versioned state yet. Pull forward the Phase 1 origin array if present.
  return {
    ...fallback,
    enabledOrigins: sanitizeOrigins(legacyOrigins)
  };
}

// Reads and migrates state without writing anything. The content script uses
// this so injection into a page never mutates storage.
export async function readState(): Promise<StoredStateV1> {
  const stored = await browser.storage.local.get([
    STATE_KEY,
    LEGACY_ORIGINS_KEY
  ]);
  return migrateState(stored[STATE_KEY], stored[LEGACY_ORIGINS_KEY]);
}

export async function loadState(): Promise<StoredStateV1> {
  const stored = await browser.storage.local.get([
    STATE_KEY,
    LEGACY_ORIGINS_KEY
  ]);
  const migrated = migrateState(stored[STATE_KEY], stored[LEGACY_ORIGINS_KEY]);

  // Persist the migration once so the legacy key can be retired.
  if (stored[STATE_KEY] === undefined) {
    await browser.storage.local.set({ [STATE_KEY]: migrated });
    if (stored[LEGACY_ORIGINS_KEY] !== undefined) {
      await browser.storage.local.remove(LEGACY_ORIGINS_KEY);
    }
  }

  return migrated;
}

export async function saveState(state: StoredStateV1): Promise<void> {
  await browser.storage.local.set({ [STATE_KEY]: state });
}

export async function updateState(
  patch: (state: StoredStateV1) => StoredStateV1
): Promise<StoredStateV1> {
  const next = patch(await loadState());
  await saveState(next);
  return next;
}
