// Audits the production build for privacy and supply-chain hygiene: no source
// maps, no eval, and no remote script/font references. Run after `wxt build`.
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const ROOT = ".output/chrome-mv3";
const REMOTE = /googleapis|gstatic|unpkg|jsdelivr|cdnjs|\/\/cdn\./;

async function walk(dir) {
  const out = [];
  for (const name of await readdir(dir)) {
    const path = join(dir, name);
    if ((await stat(path)).isDirectory()) {
      out.push(...(await walk(path)));
    } else {
      out.push(path);
    }
  }
  return out;
}

let files;
try {
  files = await walk(ROOT);
} catch {
  console.error(`No build found at ${ROOT}. Run "pnpm build" first.`);
  process.exit(1);
}

let failed = false;
const fail = (message) => {
  console.error(`FAIL ${message}`);
  failed = true;
};

for (const file of files) {
  if (file.endsWith(".map")) {
    fail(`${file}: source map shipped in production`);
    continue;
  }
  if (!/\.(js|css|html)$/.test(file)) {
    continue;
  }
  const source = await readFile(file, "utf8");
  if (file.endsWith(".js") && /\beval\s*\(/.test(source)) {
    fail(`${file}: contains eval(`);
  }
  if (source.includes("sourceMappingURL")) {
    fail(`${file}: references a source map`);
  }
  if (REMOTE.test(source)) {
    fail(`${file}: references a remote host`);
  }
}

if (!failed) {
  console.log(
    `ok   ${files.length} build files: no maps, eval, or remote refs.`
  );
}
process.exit(failed ? 1 : 0);
