import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const svgPath = join(root, "docs/brand/app-icons/04-md-note.svg");
const outDir = join(root, "apps/web/public/icons");
const svg = readFileSync(svgPath);

mkdirSync(outDir, { recursive: true });

for (const size of [192, 512]) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: size },
  });
  writeFileSync(join(outDir, `icon-${size}.png`), resvg.render().asPng());
}

console.log(`Wrote ${outDir}/icon-192.png and icon-512.png`);
