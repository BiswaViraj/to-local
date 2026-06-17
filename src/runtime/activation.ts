import { STATE_KEY, readState } from "../storage/state";

export interface ActivationHandlers {
  /** Called when the origin transitions to enabled. */
  activate: () => void | Promise<void>;
  /** Called when the origin transitions to disabled. */
  deactivate: () => void;
}

/**
 * Runs the overlay only while the given origin is enabled, reacting to live
 * changes from the popup or options page. Enabling or disabling an open tab
 * takes effect immediately, with no reload. Returns a stop function that
 * detaches the listener and deactivates if currently active.
 */
export async function runWhileOriginEnabled(
  origin: string,
  handlers: ActivationHandlers
): Promise<() => void> {
  let active = false;

  const evaluate = async (): Promise<void> => {
    const enabled = (await readState()).enabledOrigins.includes(origin);
    if (enabled && !active) {
      active = true;
      await handlers.activate();
    } else if (!enabled && active) {
      active = false;
      handlers.deactivate();
    }
  };

  const onChanged = (
    changes: Record<string, unknown>,
    areaName: string
  ): void => {
    if (areaName === "local" && STATE_KEY in changes) {
      void evaluate();
    }
  };

  browser.storage.onChanged.addListener(onChanged);
  await evaluate();

  return () => {
    browser.storage.onChanged.removeListener(onChanged);
    if (active) {
      active = false;
      handlers.deactivate();
    }
  };
}
