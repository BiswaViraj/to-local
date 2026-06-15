import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing";
import {
  CURRENT_SCHEMA_VERSION,
  LEGACY_ORIGINS_KEY,
  STATE_KEY,
  defaultState,
  loadState,
  migrateState,
  updateState
} from "../src/storage/state";

beforeEach(() => {
  fakeBrowser.reset();
});

describe("migrateState", () => {
  it("returns defaults for empty storage", () => {
    expect(migrateState(undefined)).toEqual(defaultState());
  });

  it("pulls forward a Phase 1 legacy origin array", () => {
    const state = migrateState(undefined, [
      "https://example.com",
      "not a url",
      "https://example.com"
    ]);
    expect(state.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(state.enabledOrigins).toEqual(["https://example.com"]);
  });

  it("drops corrupt preferences back to safe defaults", () => {
    const state = migrateState({
      schemaVersion: 1,
      preferences: {
        timeZone: { mode: "fixed", zone: "Mars/Olympus" },
        theme: "neon"
      },
      enabledOrigins: ["https://a.test", 5],
      onboarding: { completed: "yes" }
    });
    expect(state.preferences.timeZone).toEqual({ mode: "system" });
    expect(state.preferences.theme).toBe("system");
    expect(state.enabledOrigins).toEqual(["https://a.test"]);
    expect(state.onboarding.completed).toBe(false);
  });

  it("keeps a valid fixed time zone", () => {
    const state = migrateState({
      schemaVersion: 1,
      preferences: {
        timeZone: { mode: "fixed", zone: "Asia/Kolkata" },
        hourCycle: "h23",
        theme: "dark"
      },
      enabledOrigins: [],
      onboarding: { completed: true }
    });
    expect(state.preferences.timeZone).toEqual({
      mode: "fixed",
      zone: "Asia/Kolkata"
    });
    expect(state.preferences.hourCycle).toBe("h23");
    expect(state.onboarding.completed).toBe(true);
  });
});

describe("loadState", () => {
  it("migrates the legacy key once and removes it", async () => {
    await fakeBrowser.storage.local.set({
      [LEGACY_ORIGINS_KEY]: ["https://legacy.test"]
    });

    const state = await loadState();
    expect(state.enabledOrigins).toEqual(["https://legacy.test"]);

    const after = await fakeBrowser.storage.local.get([
      STATE_KEY,
      LEGACY_ORIGINS_KEY
    ]);
    expect(after[STATE_KEY]).toBeDefined();
    expect(after[LEGACY_ORIGINS_KEY]).toBeUndefined();
  });

  it("round-trips preferences through updateState", async () => {
    await updateState((state) => ({
      ...state,
      preferences: { ...state.preferences, theme: "dark" }
    }));
    expect((await loadState()).preferences.theme).toBe("dark");
  });
});
