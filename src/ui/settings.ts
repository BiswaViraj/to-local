import {
  updateState,
  type DisplayPreferences,
  type StoredStateV1
} from "../storage/state";

/** Merges a partial preferences patch into stored state. */
export function patchPreferences(
  patch: Partial<DisplayPreferences>
): Promise<StoredStateV1> {
  return updateState((state) => ({
    ...state,
    preferences: { ...state.preferences, ...patch }
  }));
}

/** Marks onboarding complete so it is not shown again. */
export function completeOnboarding(): Promise<StoredStateV1> {
  return updateState((state) => ({
    ...state,
    onboarding: { completed: true }
  }));
}
