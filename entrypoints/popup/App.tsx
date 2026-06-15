import { useCallback, useEffect, useState } from "react";
import {
  getActiveTabOrigin,
  getOriginState,
  setOriginEnabled
} from "../../src/runtime/client";
import { normalizeOrigin } from "../../src/runtime/origins";
import { loadState } from "../../src/storage/state";
import {
  currentOffsetLabel,
  resolveTargetZone
} from "../../src/formatting/zones";
import { applyTheme } from "../../src/ui/theme";

type OriginValue = string | null | undefined; // undefined: loading, null: unsupported

export function App() {
  const [origin, setOrigin] = useState<OriginValue>(undefined);
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState("Checking the active page…");
  const [busy, setBusy] = useState(false);
  const [zoneLabel, setZoneLabel] = useState("");

  const refresh = useCallback(async () => {
    const requested = new URL(location.href).searchParams.get("origin");
    const active = requested
      ? normalizeOrigin(requested)
      : await getActiveTabOrigin();

    const prefs = (await loadState()).preferences;
    applyTheme(prefs.theme);
    const zone = resolveTargetZone(prefs.timeZone);
    setZoneLabel(`${zone} · ${currentOffsetLabel(zone, Date.now())}`);

    setOrigin(active);
    if (!active) {
      return;
    }
    const state = await getOriginState(active);
    setEnabled(state.enabled);
    setStatus(
      state.permissionGranted
        ? "Host permission granted."
        : "Host permission not granted."
    );
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggle = async () => {
    if (!origin) {
      return;
    }
    setBusy(true);
    setStatus(enabled ? "Removing access…" : "Requesting access…");
    const result = await setOriginEnabled(origin, !enabled);
    setStatus(result.message);
    await refresh();
    setBusy(false);
  };

  return (
    <main className="grid min-w-[320px] gap-3 p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-accent-text">
        Site access
      </p>
      <h1 className="text-xl font-semibold tracking-[-0.01em]">toLocal</h1>

      <p
        id="origin"
        className="rounded-md border border-border bg-surface-sunken px-3 py-2 font-mono text-sm break-words"
      >
        {origin === undefined
          ? "Checking the active page…"
          : origin === null
            ? "This page does not expose an HTTP(S) origin."
            : origin}
      </p>

      {zoneLabel && (
        <p className="text-xs text-text-muted">
          Converting to <span className="font-mono">{zoneLabel}</span>
        </p>
      )}

      <button
        id="toggle"
        type="button"
        disabled={busy || origin == null}
        onClick={toggle}
        className="min-h-10 rounded-md bg-accent px-4 font-semibold text-on-accent transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none"
      >
        {enabled ? "Disable this origin" : "Enable this origin"}
      </button>

      <p
        id="status"
        role="status"
        aria-live="polite"
        className="min-h-4 text-xs text-text-muted break-words"
      >
        {status}
      </p>

      <button
        type="button"
        onClick={() => browser.runtime.openOptionsPage()}
        className="justify-self-start text-xs font-medium text-accent-text underline-offset-2 hover:underline"
      >
        Settings
      </button>
    </main>
  );
}
