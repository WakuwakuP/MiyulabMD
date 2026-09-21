/** SPDX identifiers accepted in the production dependency tree. */
export const ALLOWED_LICENSES = new Set([
  "0BSD",
  "AGPL-3.0",
  "AGPL-3.0-only",
  "AGPL-3.0-or-later",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC-BY-4.0",
  "CC0-1.0",
  // Weak file-level copyleft; used unmodified via mermaid's lazy ELK layout.
  "EPL-2.0",
  "ISC",
  "MIT",
  "MPL-2.0",
  "OFL-1.1",
  "Python-2.0",
  "Unlicense",
]);

/** Package name prefixes that must not enter the tree, regardless of SPDX. */
export const FORBIDDEN_PACKAGE_PREFIXES = ["@tiptap-pro/"];

/**
 * Packages whose registry metadata omits the license field. Membership here
 * only marks the package as "reviewed"; the checker re-reads the bundled
 * LICENSE file on every run and fingerprints it, so an upstream license
 * change still fails the check.
 */
export const MISSING_METADATA_PACKAGES = new Set([
  // khroma ships a `license` file but package.json has no license field.
  "khroma",
]);

const LICENSE_FINGERPRINTS = [
  // Check before BSD-2-Clause: the contributor clause distinguishes it.
  {
    license: "BSD-3-Clause",
    pattern: /neither the name.{0,200}(contributors|copyright holder)/is,
  },
  {
    license: "BSD-2-Clause",
    pattern: /redistribution and use in source and binary forms/i,
  },
  {
    license: "Apache-2.0",
    pattern: /apache license[\s\S]{0,200}version 2\.0/i,
  },
  {
    license: "ISC",
    pattern:
      /permission to use, copy, modify,? and\/or distribute this software/i,
  },
  {
    license: "MIT",
    pattern: /permission is hereby granted, free of charge/i,
  },
];

/**
 * Identify a license from the raw text of a bundled LICENSE file.
 * @param {string} text
 * @returns {string | null} SPDX id, or null when unrecognized
 */
export function detectLicenseFromText(text) {
  for (const { license, pattern } of LICENSE_FINGERPRINTS) {
    if (pattern.test(text)) {
      return license;
    }
  }
  return null;
}

const FORBIDDEN_LICENSE_NEEDLES = [
  "busl",
  "commons clause",
  "proprietary",
  "sspl",
  "unlicensed",
];

/**
 * @param {string} name
 * @returns {boolean}
 */
export function isForbiddenPackage(name) {
  return FORBIDDEN_PACKAGE_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/**
 * @param {string} license
 * @returns {boolean}
 */
export function hasForbiddenLicenseText(license) {
  const lower = license.toLowerCase();
  return FORBIDDEN_LICENSE_NEEDLES.some((needle) => lower.includes(needle));
}

/**
 * @param {string} expression
 * @returns {boolean}
 */
export function isAllowedLicenseExpression(expression) {
  const normalized = normalizeExpression(expression);
  if (!normalized || normalized === "unknown" || normalized === "none") {
    return false;
  }
  if (hasForbiddenLicenseText(normalized)) {
    return false;
  }
  return evaluateExpression(normalized);
}

/**
 * @param {string} raw
 * @returns {string}
 */
export function normalizeExpression(raw) {
  return String(raw ?? "")
    .replace(/\s+/g, " ")
    .replace(/\*$/g, "")
    .trim();
}

/**
 * @param {string} expression
 * @returns {boolean}
 */
function evaluateExpression(expression) {
  const unwrapped = unwrapParens(expression);
  const orParts = splitTopLevel(unwrapped, "OR");
  if (orParts.length > 1) {
    return orParts.some((part) => evaluateExpression(part));
  }
  const andParts = splitTopLevel(unwrapped, "AND");
  if (andParts.length > 1) {
    return andParts.every((part) => evaluateExpression(part));
  }
  return ALLOWED_LICENSES.has(unwrapped);
}

/**
 * @param {string} expression
 * @returns {string}
 */
function unwrapParens(expression) {
  let current = expression;
  while (current.startsWith("(") && current.endsWith(")")) {
    const inner = current.slice(1, -1).trim();
    if (!isBalanced(inner)) {
      break;
    }
    current = inner;
  }
  return current;
}

/**
 * @param {string} expression
 * @param {string} operator
 * @returns {string[]}
 */
export function splitTopLevel(expression, operator) {
  const token = ` ${operator} `;
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < expression.length; i += 1) {
    const ch = expression[i];
    if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      depth -= 1;
    } else if (
      depth === 0 &&
      expression.slice(i, i + token.length).toUpperCase() === token
    ) {
      parts.push(expression.slice(start, i).trim());
      i += token.length - 1;
      start = i + 1;
    }
  }
  parts.push(expression.slice(start).trim());
  return parts.filter(Boolean);
}

/**
 * @param {string} expression
 * @returns {boolean}
 */
function isBalanced(expression) {
  let depth = 0;
  for (const ch of expression) {
    if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      depth -= 1;
      if (depth < 0) {
        return false;
      }
    }
  }
  return depth === 0;
}

/**
 * @typedef {{ name: string, license: string }} LicensePackage
 */

/**
 * @param {Record<string, LicensePackage[] | Record<string, LicensePackage>>} grouped
 * @returns {LicensePackage[]}
 */
export function flattenLicenseReport(grouped) {
  /** @type {LicensePackage[]} */
  const packages = [];
  for (const [license, value] of Object.entries(grouped ?? {})) {
    const entries = Array.isArray(value)
      ? value
      : Object.values(value ?? {}).flat();
    for (const entry of entries) {
      const name = entry?.name;
      if (!name) {
        continue;
      }
      packages.push({
        license: entry.license || license,
        name,
      });
    }
  }
  return packages.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * @param {LicensePackage[]} packages
 * @returns {{ name: string, license: string, reason: string }[]}
 */
export function findLicenseViolations(packages) {
  /** @type {{ name: string, license: string, reason: string }[]} */
  const violations = [];
  for (const pkg of packages) {
    if (isForbiddenPackage(pkg.name)) {
      violations.push({
        license: pkg.license,
        name: pkg.name,
        reason: "forbidden package prefix",
      });
      continue;
    }
    if (!isAllowedLicenseExpression(pkg.license)) {
      violations.push({
        license: pkg.license,
        name: pkg.name,
        reason: "license not on the production allowlist",
      });
    }
  }
  return violations;
}
