// Guards the content-script bundle against two regressions that the rest of the
// architecture depends on: React must never enter it, and it must stay small
// enough to run on timestamp-heavy pages without cost. Run after `wxt build`.
import { readFile, readdir } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

const OUTPUT_DIR = ".output/chrome-mv3/content-scripts";
const MAX_GZIP_BYTES = 50 * 1024;
const REACT_MARKERS = [
  "Minified React error",
  "react.dev",
  "ReactCurrentDispatcher",
  "__SECRET_INTERNALS",
  "react-dom"
];

let files;
try {
  files = (await readdir(OUTPUT_DIR)).filter((name) => name.endsWith(".js"));
} catch {
  console.error(
    `No content scripts found in ${OUTPUT_DIR}. Run "pnpm build" first.`
  );
  process.exit(1);
}

if (files.length === 0) {
  console.error(
    `No content scripts found in ${OUTPUT_DIR}. Run "pnpm build" first.`
  );
  process.exit(1);
}

let failed = false;

for (const file of files) {
  const path = join(OUTPUT_DIR, file);
  const source = await readFile(path, "utf8");
  const gzipBytes = gzipSync(source).length;
  const reactHit = REACT_MARKERS.find((marker) => source.includes(marker));

  const sizeKb = (gzipBytes / 1024).toFixed(1);
  if (gzipBytes > MAX_GZIP_BYTES) {
    console.error(
      `FAIL ${file}: ${sizeKb} KB gzip exceeds ${MAX_GZIP_BYTES / 1024} KB budget.`
    );
    failed = true;
  } else if (reactHit) {
    console.error(`FAIL ${file}: contains React marker "${reactHit}".`);
    failed = true;
  } else {
    console.log(`ok   ${file}: ${sizeKb} KB gzip, framework-free.`);
  }
}

process.exit(failed ? 1 : 0);
