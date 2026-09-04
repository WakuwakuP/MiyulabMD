#!/usr/bin/env node

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertRemoteOverrides,
  readDeployOverridesFromEnv,
  writeDeployConfigFiles,
} from "./setup-deploy/wrangler-config.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const WORKER_DIR = join(ROOT, "../apps/worker");

const requireRemote = process.argv.includes("--require-remote");
const overrides = readDeployOverridesFromEnv(process.env);
if (requireRemote) {
  assertRemoteOverrides(overrides);
}

const paths = await writeDeployConfigFiles(WORKER_DIR, overrides);
console.log(`wrote ${paths.mainPath}`);
console.log(`wrote ${paths.ogPath}`);
