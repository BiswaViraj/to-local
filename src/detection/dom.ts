export interface TextSegment {
  node: Text;
  start: number;
  length: number;
}

export interface BoundedText {
  text: string;
  offset: number;
  segments: TextSegment[];
}

export interface TimeAncestor {
  element: Element;
  datetime: string;
}

const MAX_SEGMENTS = 48;
const MAX_NODES_SCANNED = 4000;
// Climb only into ancestors small enough to be a line/cell, never into a huge
// container, so reconstruction stays cheap on pages like 100k-line logs.
const MAX_ROOT_CHARS = 600;

/**
 * Reconstructs a bounded run of inline text around the caret, spanning adjacent
 * text nodes so a timestamp split across several <span>s reads as one string.
 * Stays cheap by bailing out to the single caret node for large containers.
 */
export function collectInlineText(
  caretNode: Text,
  caretOffset: number,
  radius: number
): BoundedText {
  const singleton: BoundedText = {
    text: caretNode.data,
    offset: caretOffset,
    segments: [{ node: caretNode, start: 0, length: caretNode.data.length }]
  };

  let root = caretNode.parentElement;
  if (!root) {
    return singleton;
  }
  // Climb to the nearest line/cell-sized ancestor so adjacent inline spans are
  // visible, but stop before any large container.
  while (
    root.parentElement &&
    (root.parentElement.textContent?.length ?? 0) <= MAX_ROOT_CHARS
  ) {
    root = root.parentElement;
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push(n as Text);
    if (nodes.length > MAX_NODES_SCANNED) {
      return singleton;
    }
  }

  const index = nodes.indexOf(caretNode);
  if (index === -1) {
    return singleton;
  }

  let lo = index;
  let hi = index;
  let before = caretOffset;
  let after = caretNode.data.length - caretOffset;
  while ((before < radius || after < radius) && hi - lo + 1 < MAX_SEGMENTS) {
    if (before < radius && lo > 0) {
      lo -= 1;
      before += nodes[lo]!.data.length;
    } else if (after < radius && hi < nodes.length - 1) {
      hi += 1;
      after += nodes[hi]!.data.length;
    } else {
      break;
    }
  }

  const segments: TextSegment[] = [];
  let text = "";
  let offset = caretOffset;
  for (let i = lo; i <= hi; i += 1) {
    const node = nodes[i]!;
    segments.push({ node, start: text.length, length: node.data.length });
    if (node === caretNode) {
      offset = text.length + caretOffset;
    }
    text += node.data;
  }

  return { text, offset, segments };
}

/** Finds an enclosing <time datetime> element, walking up from a node. */
export function findTimeAncestor(node: Node): TimeAncestor | null {
  let element: Element | null =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement;
  while (element) {
    if (element.tagName === "TIME") {
      const datetime = element.getAttribute("datetime");
      if (datetime) {
        return { element, datetime };
      }
    }
    element = element.parentElement;
  }
  return null;
}

/** Builds a DOM Range over a [start, end) slice of reconstructed text. */
export function rangeFromSegments(
  segments: TextSegment[],
  start: number,
  end: number
): Range | null {
  const startSeg = segments.find(
    (s) => start >= s.start && start <= s.start + s.length
  );
  const endSeg = segments.find(
    (s) => end >= s.start && end <= s.start + s.length
  );
  if (!startSeg || !endSeg) {
    return null;
  }
  const range = document.createRange();
  range.setStart(startSeg.node, start - startSeg.start);
  range.setEnd(endSeg.node, end - endSeg.start);
  return range;
}
