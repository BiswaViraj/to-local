// Verifies that key text/background token pairs meet WCAG AA (4.5:1) in both
// light and dark resolutions. Parses the OKLCH light-dark() pairs straight out
// of src/ui/tokens.css so the check can never drift from the real tokens.
import { readFile } from "node:fs/promises";

const TOKENS = "src/ui/tokens.css";

// foreground, background — all evaluated as normal text (the strict 4.5:1 bar).
const PAIRS = [
  ["text", "surface"],
  ["text", "surface-raised"],
  ["text-muted", "surface"],
  ["accent-text", "surface"],
  ["accent-text", "surface-raised"],
  ["on-accent", "accent"]
];

function oklchToLinearSrgb([L, C, h]) {
  const hr = (h * Math.PI) / 180;
  const a = C * Math.cos(hr);
  const b = C * Math.sin(hr);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ].map((v) => Math.min(1, Math.max(0, v)));
}

function relativeLuminance(oklch) {
  const [r, g, b] = oklchToLinearSrgb(oklch);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg, bg) {
  const a = relativeLuminance(fg) + 0.05;
  const b = relativeLuminance(bg) + 0.05;
  return a > b ? a / b : b / a;
}

const css = await readFile(TOKENS, "utf8");

// Match: --name: light-dark(oklch(...), oklch(...));
const tokenRe =
  /--([\w-]+):\s*light-dark\(\s*oklch\(([^)]+)\)\s*,\s*oklch\(([^)]+)\)\s*\)/g;
const tokens = {};
for (const m of css.matchAll(tokenRe)) {
  const parse = (s) => s.trim().split(/\s+/).slice(0, 3).map(Number);
  tokens[m[1]] = { light: parse(m[2]), dark: parse(m[3]) };
}

let failed = false;
for (const theme of ["light", "dark"]) {
  for (const [fg, bg] of PAIRS) {
    if (!tokens[fg] || !tokens[bg]) {
      console.error(`FAIL ${theme}: missing token ${fg} or ${bg}`);
      failed = true;
      continue;
    }
    const ratio = contrast(tokens[fg][theme], tokens[bg][theme]);
    const label = `${theme}: ${fg} on ${bg}`;
    if (ratio < 4.5) {
      console.error(`FAIL ${label} = ${ratio.toFixed(2)}:1 (needs 4.5:1)`);
      failed = true;
    } else {
      console.log(`ok   ${label} = ${ratio.toFixed(2)}:1`);
    }
  }
}

process.exit(failed ? 1 : 0);
