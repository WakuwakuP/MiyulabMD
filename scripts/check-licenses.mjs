#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  detectLicenseFromText,
  findLicenseViolations,
  flattenLicenseReport,
  isAllowedLicenseExpression,
  MISSING_METADATA_PACKAGES,
} from "./check-licenses/policy.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PNPM_STORE = join(ROOT, "node_modules", ".pnpm");
const LICENSE_FILE_RE = /^li[cs]en[cs]e/i;

/**
 * @returns {Promise<unknown>}
 */
function readPnpmLicenseReport() {
  return new Promise((resolve, reject) => {
    const args = ["licenses", "list", "--prod", "--json"];
    const shell = process.platform === "win32";
    // Windows の pnpm.cmd はシェル経由で起動する。外部入力を含まない固定コマンド。
    // shell:true に別途 args を渡さず、Node.js の DEP0190 も避ける。
    const child = spawn(
      shell ? `pnpm ${args.join(" ")}` : "pnpm",
      shell ? [] : args,
      {
        cwd: ROOT,
        shell,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `pnpm licenses list --prod --json failed (${code})\n${stderr}`,
          ),
        );
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(
          new Error(`failed to parse pnpm license JSON: ${error.message}`),
        );
      }
    });
  });
}

/**
 * Locate an installed package inside the pnpm virtual store.
 * @param {string} name e.g. "khroma" or "@scope/name"
 * @returns {string | null}
 */
function findPackageDir(name) {
  const storeKey = `${name.replace("/", "+")}@`;
  try {
    for (const entry of readdirSync(PNPM_STORE)) {
      if (!entry.startsWith(storeKey)) {
        continue;
      }
      const dir = join(PNPM_STORE, entry, "node_modules", ...name.split("/"));
      if (existsSync(dir)) {
        return dir;
      }
    }
  } catch {
    // store unreadable; fall through
  }
  return null;
}

/**
 * Read a package's bundled LICENSE file and fingerprint its SPDX id.
 * @param {string} name
 * @returns {string | null}
 */
function licenseFromBundledFile(name) {
  const dir = findPackageDir(name);
  if (!dir) {
    return null;
  }
  for (const file of readdirSync(dir)) {
    if (!LICENSE_FILE_RE.test(file)) {
      continue;
    }
    const detected = detectLicenseFromText(
      readFileSync(join(dir, file), "utf8"),
    );
    if (detected) {
      return detected;
    }
  }
  return null;
}

const report = await readPnpmLicenseReport();
const packages = flattenLicenseReport(
  /** @type {Record<string, unknown>} */ (report),
).map((pkg) => {
  if (
    isAllowedLicenseExpression(pkg.license) ||
    !MISSING_METADATA_PACKAGES.has(pkg.name)
  ) {
    return pkg;
  }
  // Registry metadata is missing the field; fingerprint the bundled LICENSE
  // file instead of trusting a static override, so upstream re-licensing is
  // detected rather than silently accepted.
  const detected = licenseFromBundledFile(pkg.name);
  return detected ? { ...pkg, license: detected } : pkg;
});
const violations = findLicenseViolations(packages);

console.log(
  `checked ${packages.length} production packages against the license allowlist`,
);

if (violations.length === 0) {
  process.exit(0);
}

console.error("license policy violations:");
for (const item of violations) {
  console.error(`- ${item.name}: ${item.license} (${item.reason})`);
}
console.error(
  "review docs/licenses.md before adding a SPDX id to scripts/check-licenses/policy.mjs",
);
process.exit(1);
