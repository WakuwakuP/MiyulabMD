export const GITHUB_ENVIRONMENT = "cloudflare-production";
export const ACCESS_APP_NAME = "MiyulabMD Auth";

export const CI_TOKEN_PERMISSIONS = [
  { key: "workers_scripts", type: "edit" },
  { key: "d1", type: "edit" },
  { key: "workers_r2", type: "edit" },
  { key: "account_settings", type: "read" },
  { key: "workers_routes", type: "edit" },
];

export const ACCESS_TOKEN_PERMISSIONS = [
  ...CI_TOKEN_PERMISSIONS,
  { key: "access", type: "edit" },
  { key: "access_acct", type: "edit" },
];

export function extractJson(text) {
  const start = text.search(/[[{]/);
  if (start === -1) {
    throw new Error("コマンド出力から JSON を見つけられませんでした");
  }
  return JSON.parse(text.slice(start));
}

export function readTomlQuotedValue(source, key) {
  const match = source.match(
    new RegExp(`^${escapeRegExp(key)}\\s*=\\s*["']([^"']*)["']`, "m"),
  );
  return match?.[1] ?? null;
}

export function replaceTomlQuotedValue(source, key, value) {
  const pattern = new RegExp(
    `^(${escapeRegExp(key)}\\s*=\\s*)(["'])[^"']*\\2`,
    "m",
  );
  if (!pattern.test(source)) {
    throw new Error(`wrangler 設定に ${key} がありません`);
  }
  return source.replace(pattern, `$1"${value}"`);
}

export function upsertCustomDomainRoute(source, hostname) {
  const block = `[[routes]]\npattern = "${hostname}"\ncustom_domain = true\n`;
  if (/^\[\[routes\]\]/m.test(source)) {
    return source.replace(
      /\[\[routes\]\]\npattern = "[^"]*"\ncustom_domain = true\n?/,
      block,
    );
  }
  return `${source.trimEnd()}\n\n${block}`;
}

export function parseGitHubRemote(url) {
  const normalized = url.trim().replace(/\.git$/, "");
  const ssh = normalized.match(/^git@github\.com:([^/]+)\/([^/]+)$/);
  if (ssh) {
    return { owner: ssh[1], name: ssh[2] };
  }
  const https = normalized.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/);
  if (https) {
    return { owner: https[1], name: https[2] };
  }
  const sshAlt = normalized.match(
    /^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+)$/,
  );
  if (sshAlt) {
    return { owner: sshAlt[1], name: sshAlt[2] };
  }
  throw new Error(`GitHub の remote として解釈できません: ${url}`);
}

export function slugifyTeamName(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

export function normalizeTeamDomain(value) {
  const trimmed = value
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  if (trimmed.endsWith(".cloudflareaccess.com")) {
    return trimmed;
  }
  const slug = slugifyTeamName(trimmed);
  if (!slug) {
    throw new Error("チーム名が空です");
  }
  return `${slug}.cloudflareaccess.com`;
}

export function normalizeHostname(value) {
  const hostname = value
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  if (!hostname || hostname.includes(" ") || !hostname.includes(".")) {
    throw new Error(`ホスト名が不正です: ${value}`);
  }
  return hostname;
}

export function accessAuthDestination(hostname) {
  return `${normalizeHostname(hostname)}/auth*`;
}

export function workersDevHostname(workerName, subdomain) {
  return `${workerName}.${subdomain}.workers.dev`;
}

export function buildUserTokenTemplateUrl({
  name,
  accountId = "*",
  permissions,
}) {
  const params = new URLSearchParams({
    permissionGroupKeys: JSON.stringify(permissions),
    accountId,
    zoneId: "all",
    name,
  });
  return `https://dash.cloudflare.com/profile/api-tokens?${params}`;
}

export function parseAccessIncludes(spec) {
  const trimmed = spec.trim();
  if (!trimmed || trimmed === "everyone") {
    return [{ everyone: {} }];
  }

  const includes = [];
  for (const part of trimmed.split(/[,;\s]+/)) {
    if (!part) {
      continue;
    }
    if (part.startsWith("@")) {
      includes.push({ email_domain: { domain: part.slice(1) } });
      continue;
    }
    if (part.includes("@")) {
      includes.push({ email: { email: part } });
      continue;
    }
    includes.push({ email_domain: { domain: part } });
  }
  if (includes.length === 0) {
    return [{ everyone: {} }];
  }
  return includes;
}

export function isDurableApiToken(auth) {
  return auth?.type === "api_token" && Boolean(auth.token);
}

export function commandName(base) {
  if (process.platform === "win32") {
    if (base === "pnpm") {
      return "pnpm.cmd";
    }
    if (base === "gh") {
      return "gh.exe";
    }
  }
  return base;
}

export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
