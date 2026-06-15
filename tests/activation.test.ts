import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { runWhileOriginEnabled } from "../src/runtime/activation";
import { STATE_KEY, defaultState } from "../src/storage/state";

const ORIGIN = "https://app.example.com";

async function setEnabled(origins: string[]): Promise<void> {
  await fakeBrowser.storage.local.set({
    [STATE_KEY]: { ...defaultState(), enabledOrigins: origins }
  });
}

beforeEach(() => {
  fakeBrowser.reset();
});

describe("runWhileOriginEnabled", () => {
  it("activates immediately when the origin is already enabled", async () => {
    await setEnabled([ORIGIN]);
    const activate = vi.fn();
    const deactivate = vi.fn();

    await runWhileOriginEnabled(ORIGIN, { activate, deactivate });

    expect(activate).toHaveBeenCalledTimes(1);
    expect(deactivate).not.toHaveBeenCalled();
  });

  it("stays inactive when the origin is not enabled", async () => {
    await setEnabled([]);
    const activate = vi.fn();

    await runWhileOriginEnabled(ORIGIN, { activate, deactivate: vi.fn() });

    expect(activate).not.toHaveBeenCalled();
  });

  it("deactivates when the origin is disabled live, and reactivates", async () => {
    await setEnabled([ORIGIN]);
    const activate = vi.fn();
    const deactivate = vi.fn();
    await runWhileOriginEnabled(ORIGIN, { activate, deactivate });

    await setEnabled([]);
    expect(deactivate).toHaveBeenCalledTimes(1);

    await setEnabled([ORIGIN]);
    expect(activate).toHaveBeenCalledTimes(2);
  });

  it("stop() detaches and deactivates if active", async () => {
    await setEnabled([ORIGIN]);
    const deactivate = vi.fn();
    const stop = await runWhileOriginEnabled(ORIGIN, {
      activate: vi.fn(),
      deactivate
    });

    stop();
    expect(deactivate).toHaveBeenCalledTimes(1);

    // Further storage changes must not call the handlers again.
    await setEnabled([]);
    expect(deactivate).toHaveBeenCalledTimes(1);
  });
});
