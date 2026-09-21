#!/usr/bin/env node
// Copy @plantuml/core runtime siblings into public/diagram/plantuml/.
// plantuml.js itself is bundled via import("@plantuml/core"); these files are
// loaded at runtime through classic script tags (viz-global.js is UMD and must
// set globals) or the engine's lazy loader (PLANTUML_STDLIB_BASE resolves
// themes.js / emoji.js / openiconic.js / stdlib bundles).
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const pkgPath = require.resolve("@plantuml/core/package.json");
const pkgDir = dirname(pkgPath);
const { version } = require(pkgPath);
const baseDir = fileURLToPath(
  new URL("../public/diagram/plantuml/", import.meta.url),
);
// Versioned path: CacheFirst runtime caching keys on the URL, so bumping
// @plantuml/core must not serve stale siblings under the same name.
const outDir = join(baseDir, version);

rmSync(baseDir, { force: true, recursive: true });
mkdirSync(outDir, { recursive: true });
for (const file of [
  "viz-global.js",
  "themes.js",
  "emoji.js",
  "openiconic.js",
]) {
  copyFileSync(join(pkgDir, file), join(outDir, file));
}
console.log("synced @plantuml/core assets ->", outDir);
