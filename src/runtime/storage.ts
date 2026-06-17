import { loadState, updateState } from "../storage/state";
import { normalizeOrigin } from "./origins";

export async function getEnabledOrigins(): Promise<string[]> {
  const state = await loadState();
  return state.enabledOrigins;
}

export async function setEnabledOrigins(origins: string[]): Promise<void> {
  const normalized = [
    ...new Set(
      origins
        .map(normalizeOrigin)
        .filter((value): value is string => value !== null)
    )
  ].sort();

  await updateState((state) => ({ ...state, enabledOrigins: normalized }));
}
