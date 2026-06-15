import { type ContentScriptContext } from "wxt/utils/content-script-context";
import { runWhileOriginEnabled } from "../src/runtime/activation";
import { normalizeOrigin } from "../src/runtime/origins";
import { parseTimestamp } from "../src/parsing/parse";
import type { ParsedTimestamp } from "../src/parsing/types";
import {
  findTimestamps,
  nearestTimestamp,
  type TextMatch
} from "../src/detection/scan";
import {
  collectInlineText,
  findTimeAncestor,
  rangeFromSegments
} from "../src/detection/dom";

const BOUNDED_TEXT_RADIUS = 180;
const DWELL_MS = 120;
const MAX_CARET_DISTANCE = 2;

interface DetectedTimestamp {
  source: string;
  parsed: ParsedTimestamp;
  rect: DOMRect;
}

// Per-text-node cache of scan results. Keyed by the live node (so it is GC'd
// with the node) and storing only short match data plus a length signature, so
// large page text is never retained.
const scanCache = new WeakMap<Text, { length: number; matches: TextMatch[] }>();

interface MountedOverlay {
  card: HTMLDivElement;
  copy: HTMLButtonElement;
  source: HTMLSpanElement;
  status: HTMLSpanElement;
}

interface CaretLocation {
  node: Text;
  offset: number;
}

export default defineContentScript({
  registration: "runtime",
  cssInjectionMode: "ui",
  allFrames: true,
  matchOriginAsFallback: true,
  noScriptStartedPostMessage: true,
  async main(ctx) {
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

async function mountOverlay(ctx: ContentScriptContext): Promise<() => void> {
  const ui = await createShadowRootUi<MountedOverlay>(ctx, {
    name: "tolocal-overlay",
    position: "overlay",
    zIndex: 2_147_483_647,
    isolateEvents: true,
    css: `
        :host {
          pointer-events: none;
        }

        .card {
          position: fixed;
          display: none;
          max-width: 360px;
          box-sizing: border-box;
          border: 1px solid rgba(115, 130, 122, 0.55);
          border-radius: 7px;
          background: #101713;
          color: #eef7f1;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.28);
          font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
          padding: 8px 10px;
          pointer-events: auto;
          white-space: nowrap;
        }

        .label {
          color: #7ed9aa;
          display: block;
          font: 700 10px/1.2 system-ui, sans-serif;
          letter-spacing: 0.08em;
          margin-bottom: 4px;
          text-transform: uppercase;
        }

        .copy {
          border: 0;
          border-radius: 4px;
          background: #7ed9aa;
          color: #101713;
          cursor: pointer;
          font: 700 11px/1 system-ui, sans-serif;
          margin-left: 10px;
          padding: 6px 8px;
        }

        .status {
          color: #9fb3a7;
          display: block;
          font: 10px/1.2 system-ui, sans-serif;
          margin-top: 5px;
        }
      `,
    onMount(container) {
      const card = document.createElement("div");
      const label = document.createElement("span");
      const source = document.createElement("span");
      const copy = document.createElement("button");
      const status = document.createElement("span");

      card.className = "card";
      card.setAttribute("role", "tooltip");
      label.className = "label";
      label.textContent = "toLocal";
      copy.className = "copy";
      copy.type = "button";
      copy.textContent = "Copy";
      status.className = "status";
      status.setAttribute("role", "status");
      card.append(label, source, copy, status);
      container.append(card);

      copy.addEventListener("click", async () => {
        const result = await copyText(source.textContent ?? "");
        status.textContent = result;
      });

      return { card, copy, source, status };
    }
  });

  ui.mount();

  let frameRequest: number | null = null;
  let dwellTimer: number | null = null;
  let lastPoint = { x: 0, y: 0 };

  const hide = (): void => {
    if (ui.mounted) {
      ui.mounted.card.style.display = "none";
    }
  };

  const inspectPoint = (): void => {
    frameRequest = null;
    if (dwellTimer !== null) {
      window.clearTimeout(dwellTimer);
    }
    dwellTimer = window.setTimeout(() => {
      dwellTimer = null;
      const match = resolveTimestampAtPoint(lastPoint.x, lastPoint.y);
      if (!match || !ui.mounted) {
        hide();
        return;
      }

      ui.mounted.source.textContent = match.source;
      ui.mounted.status.textContent = "";
      positionCard(ui.mounted.card, match.rect);
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

  document.addEventListener("pointermove", onPointerMove, { passive: true });
  document.addEventListener("pointerleave", hide, { passive: true });

  return () => {
    if (frameRequest !== null) {
      window.cancelAnimationFrame(frameRequest);
    }
    if (dwellTimer !== null) {
      window.clearTimeout(dwellTimer);
    }
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerleave", hide);
    ui.remove();
  };
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

function positionCard(card: HTMLDivElement, rect: DOMRect): void {
  card.style.display = "block";
  card.style.left = "0px";
  card.style.top = "0px";

  const cardRect = card.getBoundingClientRect();
  const gap = 8;
  const left = Math.min(
    Math.max(gap, rect.left),
    window.innerWidth - cardRect.width - gap
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
      return "Copied with Clipboard API";
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
  return copied ? "Copied with legacy fallback" : "Copy failed";
}
