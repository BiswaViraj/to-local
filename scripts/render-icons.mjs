// Rasterizes public/icon.svg into the PNG sizes Chrome needs. Run after editing
// the master SVG: `node scripts/render-icons.mjs`.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";

const SIZES = [16, 32, 48, 128];
const svg = await readFile("assets/icon.svg");
await mkdir("public/icon", { recursive: true });

for (const size of SIZES) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: size }
  });
  const png = resvg.render().asPng();
  await writeFile(`public/icon/${size}.png`, png);
  console.log(`rendered public/icon/${size}.png (${png.length} bytes)`);
}
