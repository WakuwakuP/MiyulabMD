import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { replaceTomlQuotedValue, upsertCustomDomainRoute } from "./helpers.mjs";

export const PLACEHOLDER_D1_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";
export const PLACEHOLDER_ACCESS_TEAM_DOMAIN = "example.cloudflareaccess.com";

export const WRANGLER_DEPLOY_TOML = "wrangler.deploy.toml";
export const OG_FETCH_DEPLOY_TOML = "wrangler.og-fetch.deploy.toml";

export const DEPLOY_VAR_NAMES = {
  workerName: "WORKER_NAME",
  ogFetchName: "OG_FETCH_WORKER_NAME",
  d1Name: "D1_DATABASE_NAME",
  d1Id: "D1_DATABASE_ID",
  r2Name: "R2_BUCKET_NAME",
  accessTeamDomain: "ACCESS_TEAM_DOMAIN",
  customHostname: "CUSTOM_HOSTNAME",
};

function trimToUndef(value) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function readDeployOverridesFromEnv(env = process.env) {
  return {
    workerName: trimToUndef(env.WORKER_NAME),
    ogFetchName: trimToUndef(env.OG_FETCH_WORKER_NAME),
    d1Name: trimToUndef(env.D1_DATABASE_NAME),
    d1Id: trimToUndef(env.D1_DATABASE_ID),
    r2Name: trimToUndef(env.R2_BUCKET_NAME),
    accessTeamDomain: trimToUndef(env.ACCESS_TEAM_DOMAIN),
    customHostname: trimToUndef(env.CUSTOM_HOSTNAME),
  };
}

export function applyDeployOverrides(wranglerToml, ogToml, overrides) {
  let nextWrangler = wranglerToml;
  if (overrides.workerName) {
    nextWrangler = replaceTomlQuotedValue(
      nextWrangler,
      "name",
      overrides.workerName,
    );
  }
  if (overrides.d1Name) {
    nextWrangler = replaceTomlQuotedValue(
      nextWrangler,
      "database_name",
      overrides.d1Name,
    );
  }
  if (overrides.d1Id) {
    nextWrangler = replaceTomlQuotedValue(
      nextWrangler,
      "database_id",
      overrides.d1Id,
    );
  }
  if (overrides.r2Name) {
    nextWrangler = replaceTomlQuotedValue(
      nextWrangler,
      "bucket_name",
      overrides.r2Name,
    );
  }
  if (overrides.ogFetchName) {
    nextWrangler = replaceTomlQuotedValue(
      nextWrangler,
      "service",
      overrides.ogFetchName,
    );
  }
  if (overrides.accessTeamDomain) {
    nextWrangler = replaceTomlQuotedValue(
      nextWrangler,
      "ACCESS_TEAM_DOMAIN",
      overrides.accessTeamDomain,
    );
  }
  if (overrides.customHostname) {
    nextWrangler = upsertCustomDomainRoute(
      nextWrangler,
      overrides.customHostname,
    );
  }

  let nextOg = ogToml;
  if (overrides.ogFetchName) {
    nextOg = replaceTomlQuotedValue(nextOg, "name", overrides.ogFetchName);
  }

  return { wranglerToml: nextWrangler, ogToml: nextOg };
}

export function assertRemoteOverrides(overrides) {
  if (!overrides.d1Id || overrides.d1Id === PLACEHOLDER_D1_DATABASE_ID) {
    throw new Error(
      "D1_DATABASE_ID がありません。Environment cloudflare-production の Variables に設定してください",
    );
  }
}

export async function writeDeployConfigFiles(workerDir, overrides) {
  const wranglerToml = await readFile(join(workerDir, "wrangler.toml"), "utf8");
  const ogToml = await readFile(
    join(workerDir, "wrangler.og-fetch.toml"),
    "utf8",
  );
  const next = applyDeployOverrides(wranglerToml, ogToml, overrides);
  const mainPath = join(workerDir, WRANGLER_DEPLOY_TOML);
  const ogPath = join(workerDir, OG_FETCH_DEPLOY_TOML);
  await writeFile(
    mainPath,
    `# Generated from wrangler.toml and deploy variables. Do not commit.\n${next.wranglerToml}`,
  );
  await writeFile(
    ogPath,
    `# Generated from wrangler.og-fetch.toml and deploy variables. Do not commit.\n${next.ogToml}`,
  );
  return { mainPath, ogPath };
}
