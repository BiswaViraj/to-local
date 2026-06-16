import { type ContentScriptContext } from "wxt/utils/content-script-context";
import { runWhileOriginEnabled } from "../src/runtime/activation";
import { normalizeOrigin } from "../src/runtime/origins";
import { parseTimestamp } from "../src/parsing/parse";
import type { ParsedTimestamp } from "../src/parsing/types";
import { findTimestamps, nearestTimestamp } from "../src/detection/scan";
import type { TextMatch } from "../src/detection/scan";
import {
  collectInlineText,
  findTimeAncestor,
  rangeFromSegments
} from "../src/detection/dom";
import { convert, type ConversionResult } from "../src/formatting/format";
import {
  STATE_KEY,
  readState,
  type DisplayPreferences
} from "../src/storage/state";

const BOUNDED_TEXT_RADIUS = 180;
const DWELL_MS = 120;
const HIDE_GRACE_MS = 220;
const MAX_CARET_DISTANCE = 2;
const MAX_SELECTION_LENGTH = 100;

interface DetectedTimestamp {
  source: string;
  parsed: ParsedTimestamp;
  rect: DOMRect;
}

interface Overlay {
  card: HTMLDivElement;
  local: HTMLDivElement;
  relative: HTMLDivElement;
  sourceValue: HTMLSpanElement;
  sourceOffset: HTMLSpanElement;
  copyReadable: HTMLButtonElement;
  copyCanonical: HTMLButtonElement;
  close: HTMLButtonElement;
  status: HTMLDivElement;
}

interface CaretLocation {
  node: Text;
  offset: number;
}

// Per-text-node cache of scan results. Keyed by the live node (GC'd with it)
// and storing only short match data plus a length signature, so large page
// text is never retained.
const scanCache = new WeakMap<Text, { length: number; matches: TextMatch[] }>();

export default defineContentScript({
  registration: "runtime",
  cssInjectionMode: "ui",
  allFrames: true,
  matchOriginAsFallback: true,
  noScriptStartedPostMessage: true,
  async main(ctx) {
    // The script can arrive two ways: registered for future loads, or injected
    // into an already-open tab when an origin is enabled. Guard against both
    // running in the same frame.
    const flag = globalThis as { __tolocalActive?: boolean };
    if (flag.__tolocalActive) {
      return;
    }
    flag.__tolocalActive = true;

    const origin = normalizeOrigin(location.origin);
    if (!origin) {
      return;
    }

    // Mount only while this exact origin is enabled. Disabling it from the
    // popup tears the overlay down in open tabs immediately, without a reload.
    let teardown: (() => void) | null = null;
    const stop = await runWhileOriginEnabled(origin, {
      activate: async () => {
        teardown = await mountOverlay(ctx);
      },
      deactivate: () => {
        teardown?.();
        teardown = null;
      }
    });
    ctx.onInvalidated(stop);
  }
});

const OVERLAY_CSS = `
  :host { pointer-events: none; }

  .card {
    position: fixed;
    display: none;
    max-width: 360px;
    box-sizing: border-box;
    color-scheme: light dark;
    background: light-dark(oklch(0.99 0.004 75), oklch(0.2 0.012 75));
    color: light-dark(oklch(0.27 0.012 75), oklch(0.95 0.01 75));
    border: 1px solid light-dark(oklch(0.89 0.008 75), oklch(0.34 0.014 75));
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.22);
    padding: 10px 12px;
    pointer-events: auto;
    font: 13px/1.5 system-ui, -apple-system, Segoe UI, sans-serif;
  }
  .card[data-theme="light"] { color-scheme: light; }
  .card[data-theme="dark"] { color-scheme: dark; }
  .card:focus-visible {
    outline: 2px solid light-dark(oklch(0.6 0.16 75), oklch(0.82 0.14 78));
    outline-offset: 2px;
  }

  .local {
    font: 600 15px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace;
    font-variant-numeric: tabular-nums;
    color: light-dark(oklch(0.52 0.13 64), oklch(0.83 0.13 80));
  }
  .relative {
    margin-top: 2px;
    font-size: 12px;
    color: light-dark(oklch(0.48 0.014 75), oklch(0.72 0.012 75));
  }
  .source {
    margin-top: 6px;
    font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
    color: light-dark(oklch(0.48 0.014 75), oklch(0.72 0.012 75));
  }

  .actions { display: none; gap: 6px; margin-top: 8px; }
  .card.pinned .actions { display: flex; }
  .card.pinned .hint { display: none; }

  .hint {
    margin-top: 6px;
    font-size: 10px;
    color: light-dark(oklch(0.58 0.012 75), oklch(0.6 0.012 75));
  }

  button {
    border: 0;
    border-radius: 6px;
    cursor: pointer;
    font: 600 11px/1 system-ui, sans-serif;
    padding: 7px 9px;
  }
  .copy {
    background: light-dark(oklch(0.74 0.15 75), oklch(0.8 0.14 75));
    color: light-dark(oklch(0.24 0.04 75), oklch(0.18 0.03 75));
  }
  .close {
    background: transparent;
    color: light-dark(oklch(0.48 0.014 75), oklch(0.72 0.012 75));
    margin-left: auto;
  }
  button:focus-visible {
    outline: 2px solid light-dark(oklch(0.6 0.16 75), oklch(0.82 0.14 78));
    outline-offset: 2px;
  }

  .status {
    margin-top: 6px;
    font-size: 10px;
    min-height: 12px;
    color: light-dark(oklch(0.48 0.014 75), oklch(0.72 0.012 75));
  }
  .status:empty { display: none; }
`;

async function mountOverlay(ctx: ContentScriptContext): Promise<() => void> {
  let prefs: DisplayPreferences = (await readState()).preferences;
  const convertOptions: { locale?: string } = navigator.language
    ? { locale: navigator.language }
    : {};

  const ui = await createShadowRootUi<Overlay>(ctx, {
    name: "tolocal-overlay",
    position: "overlay",
    zIndex: 2_147_483_647,
    isolateEvents: true,
    css: OVERLAY_CSS,
    onMount(container) {
      const card = el("div", "card");
      card.setAttribute("role", "tooltip");
      card.tabIndex = -1;

      const local = el("div", "local");
      const relative = el("div", "relative");

      const source = el("div", "source");
      source.append("from ");
      const sourceValue = el("span", "source-value");
      const sourceOffset = el("span", "source-offset");
      source.append(sourceValue, " ", sourceOffset);

      const hint = el("div", "hint");
      hint.textContent = "Click to pin and copy";

      const actions = el("div", "actions");
      const copyReadable = button("copy", "Copy time");
      const copyCanonical = button("copy", "Copy ISO");
      const close = button("close", "Close");
      actions.append(copyReadable, copyCanonical, close);

      const status = el("div", "status");
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");

      card.append(local, relative, source, hint, actions, status);
      container.append(card);

      return {
        card,
        local,
        relative,
        sourceValue,
        sourceOffset,
        copyReadable,
        copyCanonical,
        close,
        status
      };
    }
  });

  ui.mount();

  let frameRequest: number | null = null;
  let dwellTimer: number | null = null;
  let hideTimer: number | null = null;
  let lastPoint = { x: 0, y: 0 };
  let pinned = false;
  let current: ConversionResult | null = null;

  const overlay = (): Overlay | undefined => ui.mounted;

  const applyTheme = (card: HTMLDivElement): void => {
    if (prefs.theme === "light" || prefs.theme === "dark") {
      card.dataset.theme = prefs.theme;
    } else {
      delete card.dataset.theme;
    }
  };

  const hide = (): void => {
    const view = overlay();
    if (view && !pinned) {
      view.card.style.display = "none";
      view.card.classList.remove("pinned");
      view.status.textContent = "";
      current = null;
    }
  };

  const scheduleHide = (): void => {
    if (pinned) {
      return;
    }
    clearTimer(hideTimer);
    hideTimer = window.setTimeout(hide, HIDE_GRACE_MS);
  };

  const cancelHide = (): void => clearTimer(hideTimer);

  const render = (
    result: ConversionResult,
    rect: DOMRect,
    pin: boolean
  ): void => {
    const view = overlay();
    if (!view) {
      return;
    }
    current = result;
    applyTheme(view.card);
    view.local.textContent = result.absolute;
    view.relative.textContent = result.relative;
    view.sourceValue.textContent = result.source;
    view.sourceOffset.textContent = `(${result.sourceOffset})`;
    view.status.textContent = "";
    pinned = pin;
    view.card.classList.toggle("pinned", pin);
    view.card.setAttribute("role", pin ? "dialog" : "tooltip");
    positionCard(view.card, rect);
    if (pin) {
      view.card.focus({ preventScroll: true });
    }
  };

  const showMessage = (message: string, rect: DOMRect): void => {
    const view = overlay();
    if (!view) {
      return;
    }
    current = null;
    pinned = true;
    applyTheme(view.card);
    view.local.textContent = "";
    view.relative.textContent = "";
    view.sourceValue.textContent = "";
    view.sourceOffset.textContent = "";
    view.card.classList.add("pinned");
    view.status.textContent = message;
    positionCard(view.card, rect);
  };

  const inspectPoint = (): void => {
    frameRequest = null;
    if (pinned) {
      return;
    }
    clearTimer(dwellTimer);
    dwellTimer = window.setTimeout(() => {
      dwellTimer = null;
      const match = resolveTimestampAtPoint(lastPoint.x, lastPoint.y);
      if (!match) {
        scheduleHide();
        return;
      }
      cancelHide();
      render(convert(match.parsed, prefs, convertOptions), match.rect, false);
    }, DWELL_MS);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (event.composedPath().includes(ui.shadowHost)) {
      return;
    }
    lastPoint = { x: event.clientX, y: event.clientY };
    if (frameRequest === null) {
      frameRequest = window.requestAnimationFrame(inspectPoint);
    }
  };

  const onCardClick = (event: MouseEvent): void => {
    const view = overlay();
    if (!view || !current) {
      return;
    }
    if (
      event.target === view.copyReadable ||
      event.target === view.copyCanonical ||
      event.target === view.close
    ) {
      return;
    }
    if (!pinned) {
      pinned = true;
      view.card.classList.add("pinned");
      view.card.setAttribute("role", "dialog");
      view.card.focus({ preventScroll: true });
    }
  };

  const doCopy = async (value: string): Promise<void> => {
    const view = overlay();
    if (!view) {
      return;
    }
    view.status.textContent = await copyText(value);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && pinned) {
      pinned = false;
      hide();
    }
  };

  const onOutsidePointerDown = (event: PointerEvent): void => {
    if (pinned && !event.composedPath().includes(ui.shadowHost)) {
      pinned = false;
      hide();
    }
  };

  const onSelectionConvert = (): void => {
    const selection = window.getSelection();
    const text = selection?.toString().trim() ?? "";
    const rect =
      selection && selection.rangeCount > 0
        ? selection.getRangeAt(0).getBoundingClientRect()
        : new DOMRect(8, 8, 0, 0);

    if (text === "") {
      return;
    }
    if (text.length > MAX_SELECTION_LENGTH) {
      showMessage("Selection is too long to convert.", rect);
      return;
    }
    if (findTimestamps(text).length > 1) {
      showMessage("Select a single timestamp.", rect);
      return;
    }
    const parsed = parseTimestamp(text);
    if (!parsed) {
      showMessage("Not an explicit-zone timestamp.", rect);
      return;
    }
    render(convert(parsed, prefs, convertOptions), rect, true);
  };

  const onMessage = (message: unknown): void => {
    if (
      typeof message === "object" &&
      message !== null &&
      (message as { type?: string }).type === "convert-selection"
    ) {
      onSelectionConvert();
    }
  };

  const onStorageChanged = (
    changes: Record<string, { newValue?: unknown }>,
    area: string
  ): void => {
    if (area === "local" && STATE_KEY in changes) {
      void readState().then((state) => {
        prefs = state.preferences;
      });
    }
  };

  const view = overlay()!;
  view.copyReadable.addEventListener("click", () => {
    if (current) void doCopy(current.absolute);
  });
  view.copyCanonical.addEventListener("click", () => {
    if (current) void doCopy(current.canonical);
  });
  view.close.addEventListener("click", () => {
    pinned = false;
    hide();
  });
  view.card.addEventListener("click", onCardClick);
  view.card.addEventListener("mouseenter", cancelHide);
  view.card.addEventListener("mouseleave", scheduleHide);

  document.addEventListener("pointermove", onPointerMove, { passive: true });
  document.addEventListener("pointerleave", scheduleHide, { passive: true });
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("pointerdown", onOutsidePointerDown, true);
  browser.runtime.onMessage.addListener(onMessage);
  browser.storage.onChanged.addListener(onStorageChanged);

  return () => {
    clearTimer(frameRequest, true);
    clearTimer(dwellTimer);
    clearTimer(hideTimer);
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerleave", scheduleHide);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("pointerdown", onOutsidePointerDown, true);
    browser.runtime.onMessage.removeListener(onMessage);
    browser.storage.onChanged.removeListener(onStorageChanged);
    ui.remove();
  };
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function button(className: string, label: string): HTMLButtonElement {
  const node = el("button", className);
  node.type = "button";
  node.textContent = label;
  return node;
}

function clearTimer(id: number | null, isFrame = false): void {
  if (id === null) {
    return;
  }
  if (isFrame) {
    window.cancelAnimationFrame(id);
  } else {
    window.clearTimeout(id);
  }
}

function resolveTimestampAtPoint(
  x: number,
  y: number
): DetectedTimestamp | null {
  const caret = getCaretLocation(x, y);
  if (!caret) {
    return null;
  }

  // 1. A semantic <time datetime> ancestor wins, even when the visible text is
  // a human label such as "2 hours ago".
  const timeAncestor = findTimeAncestor(caret.node);
  if (timeAncestor) {
    const parsed = parseTimestamp(timeAncestor.datetime);
    if (parsed) {
      return {
        source: timeAncestor.datetime,
        parsed,
        rect: timeAncestor.element.getBoundingClientRect()
      };
    }
  }

  // 2. Fast path: the caret's own text node, cached.
  const single = nearestInNode(caret.node, caret.offset);
  if (single) {
    const range = document.createRange();
    range.setStart(caret.node, single.start);
    range.setEnd(caret.node, single.end);
    return {
      source: single.source,
      parsed: single.parsed,
      rect: range.getBoundingClientRect()
    };
  }

  // 3. Fallback: reconstruct across adjacent inline nodes for split timestamps.
  const bounded = collectInlineText(
    caret.node,
    caret.offset,
    BOUNDED_TEXT_RADIUS
  );
  const match = nearestTimestamp(bounded.text, bounded.offset);
  if (!match || caretDistance(bounded.offset, match) > MAX_CARET_DISTANCE) {
    return null;
  }
  const range = rangeFromSegments(bounded.segments, match.start, match.end);
  if (!range) {
    return null;
  }
  return {
    source: match.source,
    parsed: match.parsed,
    rect: range.getBoundingClientRect()
  };
}

function nearestInNode(node: Text, offset: number): TextMatch | null {
  const data = node.data;

  // Very large single nodes: scan only a bounded window, never cached.
  if (data.length > 4000) {
    const windowStart = Math.max(0, offset - BOUNDED_TEXT_RADIUS);
    const slice = data.slice(windowStart, offset + BOUNDED_TEXT_RADIUS);
    const localOffset = offset - windowStart;
    const match = nearestTimestamp(slice, localOffset);
    if (!match || caretDistance(localOffset, match) > MAX_CARET_DISTANCE) {
      return null;
    }
    return {
      ...match,
      start: match.start + windowStart,
      end: match.end + windowStart
    };
  }

  const cached = scanCache.get(node);
  let matches: TextMatch[];
  if (cached && cached.length === data.length) {
    matches = cached.matches;
  } else {
    matches = findTimestamps(data);
    scanCache.set(node, { length: data.length, matches });
  }

  let best: TextMatch | null = null;
  let bestDistance = Infinity;
  for (const match of matches) {
    const distance = caretDistance(offset, match);
    if (distance < bestDistance) {
      best = match;
      bestDistance = distance;
    }
  }
  return best && bestDistance <= MAX_CARET_DISTANCE ? best : null;
}

function caretDistance(
  offset: number,
  match: { start: number; end: number }
): number {
  return offset < match.start
    ? match.start - offset
    : offset > match.end
      ? offset - match.end
      : 0;
}

function getCaretLocation(x: number, y: number): CaretLocation | null {
  const position = document.caretPositionFromPoint?.(x, y);
  if (position?.offsetNode.nodeType === Node.TEXT_NODE) {
    return {
      node: position.offsetNode as Text,
      offset: position.offset
    };
  }

  const legacyDocument = document as Document & {
    caretRangeFromPoint?: (clientX: number, clientY: number) => Range | null;
  };
  const range = legacyDocument.caretRangeFromPoint?.(x, y);
  if (range?.startContainer.nodeType === Node.TEXT_NODE) {
    return {
      node: range.startContainer as Text,
      offset: range.startOffset
    };
  }

  return null;
}

// Pixel dimensions throughout so a hostile page root font-size cannot distort
// the card.
function positionCard(card: HTMLDivElement, rect: DOMRect): void {
  card.style.display = "block";
  card.style.left = "0px";
  card.style.top = "0px";

  const cardRect = card.getBoundingClientRect();
  const gap = 8;
  const left = Math.min(
    Math.max(gap, rect.left),
    Math.max(gap, window.innerWidth - cardRect.width - gap)
  );
  const preferredTop = rect.top - cardRect.height - gap;
  const top =
    preferredTop >= gap
      ? preferredTop
      : Math.min(rect.bottom + gap, window.innerHeight - cardRect.height - gap);

  card.style.left = `${Math.round(left)}px`;
  card.style.top = `${Math.round(top)}px`;
}

async function copyText(value: string): Promise<string> {
  if (!value) {
    return "Nothing to copy";
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return "Copied";
    } catch {
      // Fall through to the user-gesture legacy path for insecure HTTP pages.
    }
  }

  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.documentElement.append(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  return copied ? "Copied" : "Copy failed";
}
