import { STORAGE_KEY } from "./contracts";
import { normalizeOrigin } from "./origins";

export async function getEnabledOrigins(): Promise<string[]> {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  const values = stored[STORAGE_KEY];

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

export async function setEnabledOrigins(origins: string[]): Promise<void> {
  await browser.storage.local.set({
    [STORAGE_KEY]: [...new Set(origins)].sort()
  });
}

