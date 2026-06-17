// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
  collectInlineText,
  findTimeAncestor,
  rangeFromSegments
} from "../src/detection/dom";
import { nearestTimestamp } from "../src/detection/scan";

beforeEach(() => {
  document.body.innerHTML = "";
});

function firstText(el: Element): Text {
  return el.firstChild as Text;
}

describe("collectInlineText", () => {
  it("reconstructs a timestamp split across sibling spans", () => {
    document.body.innerHTML =
      '<p><span id="a">2026-06-15</span><span id="b">T08:42:11Z</span></p>';
    const a = firstText(document.getElementById("a")!);
    const result = collectInlineText(a, 4, 180);

    expect(result.text).toContain("2026-06-15T08:42:11Z");

    const match = nearestTimestamp(result.text, result.offset);
    expect(match?.source).toBe("2026-06-15T08:42:11Z");

    const range = rangeFromSegments(result.segments, match!.start, match!.end);
    expect(range?.toString()).toBe("2026-06-15T08:42:11Z");
  });

  it("does not climb into a large container", () => {
    const filler = "x".repeat(800);
    document.body.innerHTML = `<div>${filler}<span id="a">2026-06-15T08:42:11Z</span></div>`;
    const a = firstText(document.getElementById("a")!);
    const result = collectInlineText(a, 2, 180);
    // Stays within the span, so the 800-char sibling is not pulled in.
    expect(result.text).toBe("2026-06-15T08:42:11Z");
  });
});

describe("findTimeAncestor", () => {
  it("reads datetime from an enclosing <time> element", () => {
    document.body.innerHTML =
      '<time datetime="2026-06-15T08:42:11Z">2 hours ago</time>';
    const node = firstText(document.querySelector("time")!);
    expect(findTimeAncestor(node)?.datetime).toBe("2026-06-15T08:42:11Z");
  });

  it("returns null without a <time> ancestor", () => {
    document.body.innerHTML = "<p>just text</p>";
    const node = firstText(document.querySelector("p")!);
    expect(findTimeAncestor(node)).toBeNull();
  });
});
