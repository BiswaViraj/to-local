import { STORAGE_KEY } from "../src/runtime/contracts";
import { normalizeOrigin } from "../src/runtime/origins";

const BOUNDED_TEXT_RADIUS = 180;
const DWELL_MS = 120;
const TIMESTAMP_CANDIDATE =
  /(?:\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2}|[ ](?:UTC|GMT))|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),? [^\n]{6,40}(?:GMT|UTC|[+-]\d{4})|\d{2}\/[A-Z][a-z]{2}\/\d{4}:\d{2}:\d{2}:\d{2} [+-]\d{4})/g;

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
    if (!origin || !(await isOriginEnabled(origin))) {
      return;
    }

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

    document.addEventListener("pointermove", onPointerMove, {
      passive: true
    });
    document.addEventListener("pointerleave", hide, { passive: true });

    ctx.onInvalidated(() => {
      if (frameRequest !== null) {
        window.cancelAnimationFrame(frameRequest);
      }
      if (dwellTimer !== null) {
        window.clearTimeout(dwellTimer);
      }
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerleave", hide);
      ui.remove();
    });
  }
});

async function isOriginEnabled(origin: string): Promise<boolean> {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  const enabledOrigins = stored[STORAGE_KEY];
  return Array.isArray(enabledOrigins) && enabledOrigins.includes(origin);
}

function resolveTimestampAtPoint(
  x: number,
  y: number
): { source: string; rect: DOMRect } | null {
  const caret = getCaretLocation(x, y);
  if (!caret) {
    return null;
  }

  const text = caret.node.data;
  const windowStart = Math.max(0, caret.offset - BOUNDED_TEXT_RADIUS);
  const windowEnd = Math.min(text.length, caret.offset + BOUNDED_TEXT_RADIUS);
  const boundedText = text.slice(windowStart, windowEnd);
  const localOffset = caret.offset - windowStart;
  const candidates = [...boundedText.matchAll(TIMESTAMP_CANDIDATE)];
  const nearest = candidates
    .map((candidate) => ({
      candidate,
      distance: distanceFromRange(
        localOffset,
        candidate.index,
        candidate.index + candidate[0].length
      )
    }))
    .sort((left, right) => left.distance - right.distance)[0];

  if (!nearest || nearest.distance > 3) {
    return null;
  }

  const start = windowStart + nearest.candidate.index;
  const end = start + nearest.candidate[0].length;
  const range = document.createRange();
  range.setStart(caret.node, start);
  range.setEnd(caret.node, end);

  return {
    source: nearest.candidate[0],
    rect: range.getBoundingClientRect()
  };
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

function distanceFromRange(
  point: number,
  start: number,
  end: number
): number {
  if (point < start) {
    return start - point;
  }
  if (point > end) {
    return point - end;
  }
  return 0;
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
      : Math.min(
          rect.bottom + gap,
          window.innerHeight - cardRect.height - gap
        );

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
