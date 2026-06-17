import { useEffect, useState } from "react";
import { parseTimestamp } from "../../src/parsing/parse";
import { convert, type ConversionResult } from "../../src/formatting/format";
import { loadState, type DisplayPreferences } from "../../src/storage/state";
import { completeOnboarding } from "../../src/ui/settings";
import { applyTheme } from "../../src/ui/theme";

const SAMPLES = [
  "2026-06-15T08:42:11Z",
  "Mon, 15 Jun 2026 08:42:11 GMT",
  "15/Jun/2026:14:12:11 +0530"
];

export function App() {
  const [prefs, setPrefs] = useState<DisplayPreferences | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    void (async () => {
      const state = await loadState();
      setPrefs(state.preferences);
      applyTheme(state.preferences.theme);
      setDone(state.onboarding.completed);
    })();
  }, []);

  return (
    <main className="mx-auto grid max-w-2xl gap-8 p-8">
      <header className="grid gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-accent-text">
          Welcome
        </p>
        <h1 className="text-2xl font-semibold tracking-[-0.01em]">
          Read any timestamp in your time
        </h1>
        <p className="max-w-[60ch] text-text-muted">
          toLocal previews explicit-zone timestamps in your local time when you
          point at them. Nothing leaves your browser — there are no accounts, no
          network requests, and no page rewriting. You turn it on one site at a
          time from the toolbar.
        </p>
      </header>

      <section className="grid gap-3">
        <h2 className="text-sm font-semibold text-text-muted">
          Try it — hover a sample, then click to pin and copy
        </h2>
        <div className="grid gap-3 rounded-lg border border-border bg-surface-raised p-5">
          {prefs &&
            SAMPLES.map((sample) => (
              <DemoTimestamp key={sample} source={sample} prefs={prefs} />
            ))}
        </div>
      </section>

      <section className="flex items-center gap-4">
        <button
          type="button"
          onClick={async () => {
            await completeOnboarding();
            setDone(true);
          }}
          className="rounded-md bg-accent px-5 py-2.5 font-semibold text-on-accent hover:bg-accent-hover"
        >
          Got it
        </button>
        {done && (
          <span className="text-sm text-positive">
            You&rsquo;re set. Open any site and enable it from the toolbar.
          </span>
        )}
      </section>
    </main>
  );
}

function DemoTimestamp(props: { source: string; prefs: DisplayPreferences }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [copied, setCopied] = useState("");

  const parsed = parseTimestamp(props.source);
  const result: ConversionResult | null = parsed
    ? convert(parsed, props.prefs, {
        ...(navigator.language ? { locale: navigator.language } : {})
      })
    : null;

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied("Copied");
    } catch {
      setCopied("Copy failed");
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => !pinned && setOpen(false)}
        onClick={() => {
          setPinned(true);
          setOpen(true);
        }}
        className="rounded-md bg-surface-sunken px-3 py-2 font-mono text-sm hover:bg-surface"
      >
        {props.source}
      </button>

      {open && result && (
        <div
          role={pinned ? "dialog" : "tooltip"}
          className="absolute left-0 top-full z-10 mt-2 w-max max-w-sm rounded-md border border-border bg-surface p-3 shadow-[0_8px_24px_rgba(0,0,0,0.18)]"
        >
          <div className="font-mono text-[15px] font-semibold tabular-nums text-accent-text">
            {result.absolute}
          </div>
          <div className="mt-0.5 text-xs text-text-muted">
            {result.relative}
          </div>
          <div className="mt-1.5 font-mono text-[11px] text-text-muted">
            from {result.source} ({result.sourceOffset})
          </div>
          {pinned && (
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => copy(result.absolute)}
                className="rounded bg-accent px-2.5 py-1.5 text-[11px] font-semibold text-on-accent hover:bg-accent-hover"
              >
                Copy time
              </button>
              <button
                type="button"
                onClick={() => copy(result.canonical)}
                className="rounded bg-accent px-2.5 py-1.5 text-[11px] font-semibold text-on-accent hover:bg-accent-hover"
              >
                Copy ISO
              </button>
              <button
                type="button"
                onClick={() => {
                  setPinned(false);
                  setOpen(false);
                  setCopied("");
                }}
                className="text-[11px] text-text-muted hover:text-text"
              >
                Close
              </button>
              {copied && (
                <span className="text-[11px] text-text-muted">{copied}</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
