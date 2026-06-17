import { useEffect, useMemo, useState } from "react";
import {
  loadState,
  type DisplayPreferences,
  type HourCyclePreference,
  type ThemePreference
} from "../../src/storage/state";
import { setOriginEnabled } from "../../src/runtime/client";
import { normalizeOrigin } from "../../src/runtime/origins";
import {
  currentOffsetLabel,
  listTimeZones,
  resolveTargetZone
} from "../../src/formatting/zones";
import { patchPreferences } from "../../src/ui/settings";
import { applyTheme } from "../../src/ui/theme";

export function App() {
  const [prefs, setPrefs] = useState<DisplayPreferences | null>(null);
  const [origins, setOrigins] = useState<string[]>([]);
  const [shortcut, setShortcut] = useState<string | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    void (async () => {
      setNow(Date.now());
      const state = await loadState();
      setPrefs(state.preferences);
      setOrigins(state.enabledOrigins);
      applyTheme(state.preferences.theme);
      const commands = await browser.commands.getAll();
      const command = commands.find((c) => c.name === "convert-selection");
      setShortcut(command?.shortcut ?? "");
    })();
  }, []);

  const update = async (patch: Partial<DisplayPreferences>) => {
    const next = await patchPreferences(patch);
    setPrefs(next.preferences);
    applyTheme(next.preferences.theme);
  };

  const reloadOrigins = async () =>
    setOrigins((await loadState()).enabledOrigins);

  if (!prefs) {
    return <main className="mx-auto max-w-2xl p-8">Loading…</main>;
  }

  return (
    <main className="mx-auto grid max-w-2xl gap-8 p-8">
      <header className="grid gap-1">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-accent-text">
          toLocal
        </p>
        <h1 className="text-2xl font-semibold tracking-[-0.01em]">Settings</h1>
      </header>

      <Section title="Appearance">
        <Field label="Theme">
          <Segmented<ThemePreference>
            value={prefs.theme}
            onChange={(theme) => update({ theme })}
            options={[
              ["system", "System"],
              ["light", "Light"],
              ["dark", "Dark"]
            ]}
          />
        </Field>
        <Field label="Hour format">
          <Segmented<HourCyclePreference>
            value={prefs.hourCycle}
            onChange={(hourCycle) => update({ hourCycle })}
            options={[
              ["auto", "Auto"],
              ["h12", "12-hour"],
              ["h23", "24-hour"]
            ]}
          />
        </Field>
      </Section>

      <Section title="Target timezone">
        <Field label="Source">
          <Segmented
            value={prefs.timeZone.mode}
            onChange={(mode) =>
              update({
                timeZone:
                  mode === "system"
                    ? { mode: "system" }
                    : {
                        mode: "fixed",
                        zone: resolveTargetZone(prefs.timeZone)
                      }
              })
            }
            options={[
              ["system", "Browser local"],
              ["fixed", "Fixed zone"]
            ]}
          />
        </Field>
        {prefs.timeZone.mode === "fixed" && (
          <TimezonePicker
            value={prefs.timeZone.zone}
            now={now}
            onChange={(zone) => update({ timeZone: { mode: "fixed", zone } })}
          />
        )}
      </Section>

      <Section title="Enabled sites">
        <OriginsManager
          origins={origins}
          onRemove={async (origin) => {
            await setOriginEnabled(origin, false);
            await reloadOrigins();
          }}
          onAdd={async (origin) => {
            const result = await setOriginEnabled(origin, true);
            if (result.ok) {
              await reloadOrigins();
            }
            return result.ok ? null : result.message;
          }}
        />
      </Section>

      <Section title="Keyboard shortcut">
        <p className="text-sm text-text-muted">
          Convert the selected timestamp:{" "}
          {shortcut ? (
            <kbd className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-xs">
              {shortcut}
            </kbd>
          ) : (
            <span className="text-danger">not assigned</span>
          )}
        </p>
        <button
          type="button"
          onClick={() =>
            browser.tabs.create({ url: "chrome://extensions/shortcuts" })
          }
          className="justify-self-start text-sm font-medium text-accent-text underline-offset-2 hover:underline"
        >
          Change in Chrome shortcuts
        </button>
      </Section>
    </main>
  );
}

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4">
      <h2 className="text-sm font-semibold text-text-muted">{props.title}</h2>
      <div className="grid gap-4 rounded-lg border border-border bg-surface-raised p-5">
        {props.children}
      </div>
    </section>
  );
}

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium">{props.label}</span>
      {props.children}
    </div>
  );
}

function Segmented<T extends string>(props: {
  value: T;
  onChange: (value: T) => void;
  options: Array<[T, string]>;
}) {
  return (
    <div className="inline-flex w-fit gap-1 rounded-md bg-surface-sunken p-1">
      {props.options.map(([value, label]) => (
        <button
          key={value}
          type="button"
          aria-pressed={props.value === value}
          onClick={() => props.onChange(value)}
          className={`rounded px-3 py-1.5 text-sm font-medium transition-colors motion-reduce:transition-none ${
            props.value === value
              ? "bg-accent text-on-accent"
              : "text-text-muted hover:text-text"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function TimezonePicker(props: {
  value: string;
  now: number;
  onChange: (zone: string) => void;
}) {
  const [query, setQuery] = useState("");
  const now = props.now;
  const zones = useMemo(() => listTimeZones(), []);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? zones.filter((z) => z.toLowerCase().includes(q)) : zones;
    return list.slice(0, 40);
  }, [query, zones]);

  return (
    <div className="grid gap-2">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`Search zones — current: ${props.value}`}
        aria-label="Search timezones"
        className="rounded-md border border-border bg-surface px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      />
      <ul className="max-h-64 overflow-auto rounded-md border border-border">
        {filtered.map((zone) => (
          <li key={zone}>
            <button
              type="button"
              onClick={() => props.onChange(zone)}
              aria-current={zone === props.value}
              className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-surface-sunken ${
                zone === props.value ? "font-semibold text-accent-text" : ""
              }`}
            >
              <span>{zone}</span>
              <span className="font-mono text-xs text-text-muted">
                {currentOffsetLabel(zone, now)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function OriginsManager(props: {
  origins: string[];
  onRemove: (origin: string) => Promise<void>;
  onAdd: (origin: string) => Promise<string | null>;
}) {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");

  const add = async () => {
    setError("");
    const normalized = normalizeOrigin(input.trim());
    if (!normalized) {
      setError("Enter a full http(s) origin, e.g. https://app.example.com");
      return;
    }
    const message = await props.onAdd(normalized);
    if (message) {
      setError(message);
    } else {
      setInput("");
    }
  };

  return (
    <div className="grid gap-3">
      {props.origins.length === 0 ? (
        <p className="text-sm text-text-muted">
          No sites enabled yet. Enable one from the toolbar popup, or add an
          embedded app origin below.
        </p>
      ) : (
        <ul className="grid gap-2">
          {props.origins.map((origin) => (
            <li
              key={origin}
              className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
            >
              <span className="font-mono text-sm break-all">{origin}</span>
              <button
                type="button"
                onClick={() => props.onRemove(origin)}
                className="shrink-0 text-sm font-medium text-danger underline-offset-2 hover:underline"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="https://embedded-app.example.com"
          aria-label="Add an origin"
          className="flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />
        <button
          type="submit"
          className="rounded-md bg-accent px-4 font-semibold text-on-accent hover:bg-accent-hover"
        >
          Add
        </button>
      </form>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
