#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  attachCustomDomain,
  createAccessOrganization,
  createCloudflare,
  ensureAccessApp,
  ensureD1,
  ensureR2,
  ensureWorkersSubdomain,
  getAccessOrganization,
  isNotFound,
  listAccounts,
  listIdentityProviders,
  listZones,
  putWorkerSecret,
  verifyToken,
} from "./setup-deploy/cloudflare.mjs";
import {
  detectGitHubRepo,
  ensureEnvironment,
  ensureGhAuth,
  setEnvironmentSecret,
} from "./setup-deploy/github.mjs";
import {
  ACCESS_APP_NAME,
  ACCESS_TOKEN_PERMISSIONS,
  accessAuthDestination,
  buildUserTokenTemplateUrl,
  CI_TOKEN_PERMISSIONS,
  commandName,
  extractJson,
  GITHUB_ENVIRONMENT,
  isDurableApiToken,
  normalizeHostname,
  normalizeTeamDomain,
  parseAccessIncludes,
  readTomlQuotedValue,
  replaceTomlQuotedValue,
  slugifyTeamName,
  upsertCustomDomainRoute,
  workersDevHostname,
} from "./setup-deploy/helpers.mjs";
import { commandExists, runCommand } from "./setup-deploy/process.mjs";
import { createPrompt } from "./setup-deploy/prompt.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(ROOT, "..");
const WORKER_DIR = join(REPO_ROOT, "apps/worker");
const WRANGLER_TOML = join(WORKER_DIR, "wrangler.toml");
const OG_TOML = join(WORKER_DIR, "wrangler.og-fetch.toml");

function printHelp() {
  console.log(`MiyulabMD デプロイ環境セットアップ

使い方:
  pnpm setup:deploy

対話で次を揃えます。フォーク先のリポジトリでも、手元から実行できます。

  1. wrangler login で Cloudflare にログインし、一時 OAuth トークンを取得
  2. D1 / R2 / Worker 名を wrangler.toml に反映
  3. Zero Trust Access（チームドメインと /auth* アプリ、ACCESS_AUD）
  4. Worker シークレットと任意の初回デプロイ
  5. GitHub Environment ${GITHUB_ENVIRONMENT} に
     CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID を登録

前提: Node.js 20+、pnpm、GitHub CLI (gh)
`);
}

function logStep(index, title) {
  console.log(`\n[${index}] ${title}`);
}

function logInfo(message) {
  console.log(`  ${message}`);
}

async function openUrl(url) {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  await runCommand(command, args, { allowFail: true });
}

async function ensureDependencies(prompt) {
  if (!existsSync(join(WORKER_DIR, "node_modules/wrangler"))) {
    const install = await prompt.confirm(
      "依存関係が未インストールです。pnpm install を実行しますか？",
      true,
    );
    if (!install) {
      throw new Error("先に pnpm install を実行してください");
    }
    await runCommand(commandName("pnpm"), ["install"], {
      cwd: REPO_ROOT,
      inherit: true,
    });
  }
}

async function loginCloudflare(prompt, cloudflare) {
  logStep(1, "Cloudflare にログイン");

  const envToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (envToken) {
    const useEnv = await prompt.confirm(
      "環境変数 CLOUDFLARE_API_TOKEN を使いますか？",
      true,
    );
    if (useEnv) {
      await verifyToken(envToken);
      logInfo("環境変数の API トークンを使います。");
      return { type: "api_token", token: envToken };
    }
  }

  const whoami = await cloudflare.wrangler(["whoami", "--json"], {
    allowFail: true,
  });
  let loggedIn = false;
  if (whoami.code === 0) {
    try {
      const info = extractJson(`${whoami.stdout}\n${whoami.stderr}`);
      loggedIn = Boolean(info.loggedIn ?? info.email ?? info.accounts);
    } catch {
      loggedIn = false;
    }
  }

  if (!loggedIn) {
    logInfo(
      "ブラウザで Cloudflare にログインし、セットアップ用の一時 OAuth トークンを取得します。",
    );
    const canOpenBrowser = await prompt.confirm(
      "このマシンでブラウザを開けますか？（SSH のみなら n）",
      true,
    );
    const loginArgs = ["login"];
    if (!canOpenBrowser) {
      loginArgs.push("--device");
      logInfo(
        "デバイス認可を使います。表示された URL とコードをブラウザで開いてください。",
      );
    }
    await cloudflare.wrangler(loginArgs, { inherit: true });
  } else {
    logInfo("既存の wrangler ログインを使います。");
  }

  const auth = await cloudflare.wranglerJson(["auth", "token", "--json"]);
  if (!auth.token) {
    throw new Error("wrangler auth token からトークンを取得できませんでした");
  }
  logInfo(
    auth.type === "oauth"
      ? "OAuth の一時トークンを取得しました。"
      : "API トークンを取得しました。",
  );
  return auth;
}

async function selectAccount(prompt, token, cloudflare) {
  let accounts = [];
  try {
    accounts = await listAccounts(token);
  } catch {
    const whoami = await cloudflare.wranglerJson(["whoami", "--json"]);
    accounts = whoami.accounts ?? [];
  }
  if (accounts.length === 0) {
    throw new Error("Cloudflare アカウントが見つかりません");
  }
  const account = await prompt.choose(
    "対象の Cloudflare アカウント:",
    accounts.map((item) => ({
      value: { id: item.id, name: item.name },
      label: `${item.name} (${item.id})`,
    })),
  );
  logInfo(`Account ID: ${account.id}`);
  return account;
}

async function collectNames(prompt, wranglerToml, ogToml) {
  logStep(2, "リソース名");
  const workerName = await prompt.ask(
    "Worker 名",
    readTomlQuotedValue(wranglerToml, "name") ?? "miyulabmd",
  );
  const ogFetchName = await prompt.ask(
    "og-fetch Worker 名",
    readTomlQuotedValue(ogToml, "name") ?? `${workerName}-og-fetch`,
  );
  const d1Name = await prompt.ask(
    "D1 データベース名",
    readTomlQuotedValue(wranglerToml, "database_name") ?? workerName,
  );
  const r2Name = await prompt.ask(
    "R2 バケット名",
    readTomlQuotedValue(wranglerToml, "bucket_name") ?? `${workerName}-images`,
  );
  return { workerName, ogFetchName, d1Name, r2Name };
}

async function canUseAccessApi(token, accountId) {
  try {
    await getAccessOrganization(token, accountId);
    return true;
  } catch (error) {
    if (isNotFound(error)) {
      return true;
    }
    if (
      error.status === 403 ||
      /permission|Authentication|not authorized|forbidden/i.test(error.message)
    ) {
      return false;
    }
    throw error;
  }
}

async function promptForApiToken(prompt, { accountId, permissions, name }) {
  const url = buildUserTokenTemplateUrl({
    name,
    accountId,
    permissions,
  });

  console.log(`
  権限は URL に事前入力済みです。作成後、表示されたトークンを貼り付けてください。

  ${url}

  セットアップだけなら TTL を短くできます。
  GitHub Actions に登録する場合は期限を空けるか、長くしてください。
  wrangler login の OAuth トークンは期限切れになるため CI には使えません。
`);

  if (await prompt.confirm("ブラウザでトークン作成画面を開きますか？", true)) {
    await openUrl(url);
  }

  for (;;) {
    const pasted = await prompt.secret("作成した API トークン: ");
    if (!pasted) {
      throw new Error("API トークンが入力されませんでした");
    }
    try {
      await verifyToken(pasted);
      logInfo("API トークンを確認しました。");
      return pasted;
    } catch (error) {
      console.log(`  トークンが無効です: ${error.message}`);
      if (!(await prompt.confirm("やり直しますか？", true))) {
        throw error;
      }
    }
  }
}

async function resolveApiTokens(
  prompt,
  auth,
  accountId,
  { needAccess, needGitHub },
) {
  let setupToken = auth.token;
  let githubToken = isDurableApiToken(auth) ? auth.token : null;

  if (needAccess) {
    const accessOk = await canUseAccessApi(setupToken, accountId);
    if (accessOk) {
      logInfo("現在のトークンで Access API を呼べます。");
    } else {
      logInfo("Access API には追加の API トークンが必要です。");
      const privileged = await promptForApiToken(prompt, {
        accountId,
        permissions: ACCESS_TOKEN_PERMISSIONS,
        name: "MiyulabMD setup + GitHub Actions",
      });
      setupToken = privileged;
      githubToken = privileged;
    }
  }

  if (needGitHub && !githubToken) {
    logInfo("GitHub Actions 用に有効期限の長い API トークンが必要です。");
    githubToken = await promptForApiToken(prompt, {
      accountId,
      permissions: CI_TOKEN_PERMISSIONS,
      name: "MiyulabMD GitHub Actions",
    });
  }

  return { setupToken, githubToken };
}

async function writeWorkerConfig({
  wranglerToml,
  ogToml,
  names,
  databaseId,
  teamDomain,
  customHostname,
}) {
  let nextWrangler = wranglerToml;
  nextWrangler = replaceTomlQuotedValue(nextWrangler, "name", names.workerName);
  nextWrangler = replaceTomlQuotedValue(
    nextWrangler,
    "database_name",
    names.d1Name,
  );
  nextWrangler = replaceTomlQuotedValue(
    nextWrangler,
    "database_id",
    databaseId,
  );
  nextWrangler = replaceTomlQuotedValue(
    nextWrangler,
    "bucket_name",
    names.r2Name,
  );
  nextWrangler = replaceTomlQuotedValue(
    nextWrangler,
    "service",
    names.ogFetchName,
  );
  if (teamDomain) {
    nextWrangler = replaceTomlQuotedValue(
      nextWrangler,
      "ACCESS_TEAM_DOMAIN",
      teamDomain,
    );
  }
  if (customHostname) {
    nextWrangler = upsertCustomDomainRoute(nextWrangler, customHostname);
  }
  await writeFile(WRANGLER_TOML, nextWrangler);

  let nextOg = ogToml;
  nextOg = replaceTomlQuotedValue(nextOg, "name", names.ogFetchName);
  await writeFile(OG_TOML, nextOg);
}

async function setupAccess(prompt, token, account, hostname, loginEmail) {
  logStep(4, "Zero Trust Access");

  let org = await getAccessOrganization(token, account.id);
  if (org) {
    logInfo(`既存のチームドメイン: ${org.auth_domain}`);
  } else {
    const defaultTeam = slugifyTeamName(account.name) || "miyulabmd";
    const teamInput = await prompt.ask(
      "新しい Zero Trust チーム名（xxx.cloudflareaccess.com）",
      defaultTeam,
    );
    const authDomain = normalizeTeamDomain(teamInput);
    const displayName = await prompt.ask("チームの表示名", account.name);
    org = await createAccessOrganization(token, account.id, {
      name: displayName,
      authDomain,
    });
    logInfo(`Zero Trust 組織を作成しました: ${org.auth_domain}`);
  }

  const defaultAllow = loginEmail || "everyone";
  const allowSpec = await prompt.ask(
    "ログインを許可する対象（メール / @ドメイン / everyone）",
    defaultAllow,
  );
  const includes = parseAccessIncludes(allowSpec);
  const destination = accessAuthDestination(hostname);
  const { created, app } = await ensureAccessApp(token, account.id, {
    destination,
    includes,
  });
  const aud = app.aud;
  if (!aud) {
    throw new Error("Access アプリの AUD を取得できませんでした");
  }
  logInfo(
    created
      ? `Access アプリを作成しました: ${ACCESS_APP_NAME}`
      : `既存の Access アプリを更新しました: ${app.name}`,
  );
  logInfo(`destination: ${destination}`);
  logInfo(`AUD: ${aud}`);

  const idps = await listIdentityProviders(token, account.id);
  if (idps.length === 0) {
    logInfo(
      "IdP が見つかりません。Zero Trust で One-time PIN か SSO を追加してください。",
    );
  } else {
    logInfo(`IdP: ${idps.map((item) => item.name || item.type).join(", ")}`);
  }

  return { teamDomain: org.auth_domain, aud };
}

async function deployWorkers(prompt, cloudflare, env, { applyMigrations }) {
  logStep(5, "Worker シークレットと初回デプロイ");
  const shouldDeploy = await prompt.confirm(
    "Web をビルドして Worker をデプロイしますか？",
    true,
  );
  if (!shouldDeploy) {
    logInfo(
      "デプロイはスキップしました。シークレットは Worker 作成後に再実行してください。",
    );
    return { deployed: false, sessionSecret: null };
  }

  await runCommand(
    commandName("pnpm"),
    ["--filter", "@miyulabmd/web", "build"],
    {
      cwd: REPO_ROOT,
      inherit: true,
    },
  );

  if (applyMigrations) {
    logInfo("リモート D1 にマイグレーションを適用します。");
    await cloudflare.wrangler(["d1", "migrations", "apply", "DB", "--remote"], {
      env,
      inherit: true,
    });
  }

  await cloudflare.wrangler(["deploy", "-c", "wrangler.og-fetch.toml"], {
    env,
    inherit: true,
  });
  await cloudflare.wrangler(["deploy"], { env, inherit: true });
  return { deployed: true };
}

async function putSecrets(cloudflare, env, { sessionSecret, accessAud }) {
  if (sessionSecret) {
    await putWorkerSecret(cloudflare, {
      name: "SESSION_SECRET",
      value: sessionSecret,
      env,
    });
    logInfo("SESSION_SECRET を Worker に設定しました。");
  }
  if (accessAud) {
    await putWorkerSecret(cloudflare, {
      name: "ACCESS_AUD",
      value: accessAud,
      env,
    });
    logInfo("ACCESS_AUD を Worker に設定しました。");
  }
}

async function setupGitHub(prompt, ghBin, account, apiToken) {
  logStep(6, "GitHub Actions の Secrets");
  if (!(await commandExists(ghBin))) {
    throw new Error(
      "GitHub CLI (gh) がありません。https://cli.github.com/ から入れてください",
    );
  }
  await ensureGhAuth(ghBin, prompt);
  const repo = await detectGitHubRepo(ghBin, REPO_ROOT);
  logInfo(
    `対象リポジトリ: ${repo.nameWithOwner}${repo.isFork ? "（フォーク）" : ""}`,
  );
  const confirmed = await prompt.confirm(
    "このリポジトリに Environment Secrets を登録しますか？",
    true,
  );
  if (!confirmed) {
    return null;
  }
  if (!apiToken) {
    throw new Error("GitHub に登録する Cloudflare API トークンがありません");
  }

  await ensureEnvironment(ghBin, repo.nameWithOwner);
  await setEnvironmentSecret(
    ghBin,
    repo.nameWithOwner,
    "CLOUDFLARE_API_TOKEN",
    apiToken,
  );
  await setEnvironmentSecret(
    ghBin,
    repo.nameWithOwner,
    "CLOUDFLARE_ACCOUNT_ID",
    account.id,
  );
  logInfo(
    `Environment ${GITHUB_ENVIRONMENT} に CLOUDFLARE_API_TOKEN と CLOUDFLARE_ACCOUNT_ID を登録しました。`,
  );
  return repo;
}

async function main(argv) {
  if (argv.includes("-h") || argv.includes("--help")) {
    printHelp();
    return;
  }
  if (!process.stdin.isTTY) {
    throw new Error(
      "対話端末で実行してください。使い方は pnpm setup:deploy -- --help",
    );
  }

  console.log(`MiyulabMD デプロイ環境セットアップ
フォークしたリポジトリでも、手元から Cloudflare と GitHub Actions を揃えられます。
`);

  const prompt = createPrompt();
  try {
    if (
      !(await prompt.confirm(
        "Cloudflare Access / Worker / D1 と GitHub Actions の設定を進めますか？",
        true,
      ))
    ) {
      return;
    }

    if (!(await commandExists(commandName("pnpm")))) {
      throw new Error("pnpm が必要です。corepack enable を推奨します。");
    }
    await ensureDependencies(prompt);

    const cloudflare = createCloudflare({
      wranglerBin: commandName("pnpm"),
      wranglerArgs: ["exec", "wrangler"],
      workerDir: WORKER_DIR,
    });

    const auth = await loginCloudflare(prompt, cloudflare);
    const account = await selectAccount(prompt, auth.token, cloudflare);
    const wranglerEnv = {
      CLOUDFLARE_ACCOUNT_ID: account.id,
      ...(isDurableApiToken(auth) ? { CLOUDFLARE_API_TOKEN: auth.token } : {}),
    };

    const wranglerToml = await readFile(WRANGLER_TOML, "utf8");
    const ogToml = await readFile(OG_TOML, "utf8");
    const names = await collectNames(prompt, wranglerToml, ogToml);

    const configureAccess = await prompt.confirm(
      "Zero Trust Access（ログイン）を設定しますか？",
      true,
    );
    const configureGitHub = await prompt.confirm(
      "GitHub Actions の Environment Secrets を登録しますか？",
      true,
    );

    const { setupToken, githubToken } = await resolveApiTokens(
      prompt,
      auth,
      account.id,
      { needAccess: configureAccess, needGitHub: configureGitHub },
    );
    const durableToken =
      githubToken ?? (isDurableApiToken(auth) ? auth.token : null);
    if (durableToken) {
      wranglerEnv.CLOUDFLARE_API_TOKEN = durableToken;
    }
    const cfToken = setupToken;

    logStep(3, "D1 / R2 / wrangler.toml");
    const d1 = await ensureD1(cfToken, account.id, names.d1Name);
    logInfo(
      d1.created
        ? `D1 を作成しました: ${d1.name} (${d1.id})`
        : `既存の D1 を使います: ${d1.name} (${d1.id})`,
    );
    const r2 = await ensureR2(cfToken, account.id, names.r2Name);
    logInfo(
      r2.created
        ? `R2 バケットを作成しました: ${r2.name}`
        : `既存の R2 バケットを使います: ${r2.name}`,
    );

    const hostMode = await prompt.choose("公開ホスト:", [
      { value: "workers_dev", label: "workers.dev（カスタムドメインなし）" },
      { value: "custom", label: "カスタムドメイン" },
    ]);

    let customHostname = null;
    let hostname;
    if (hostMode === "custom") {
      const zones = await listZones(cfToken, account.id);
      if (zones.length === 0) {
        throw new Error(
          "このアカウントに Zone がありません。workers.dev を選んでください。",
        );
      }
      const zone = await prompt.choose(
        "Zone:",
        zones.map((item) => ({
          value: item,
          label: `${item.name} (${item.id})`,
        })),
      );
      customHostname = normalizeHostname(
        await prompt.ask("ホスト名", `md.${zone.name}`),
      );
      hostname = customHostname;
    } else {
      const fallback = slugifyTeamName(account.name) || names.workerName;
      const subdomain = await ensureWorkersSubdomain(
        cfToken,
        account.id,
        fallback,
      );
      hostname = workersDevHostname(names.workerName, subdomain);
      logInfo(`workers.dev: https://${hostname}`);
    }

    let teamDomain = readTomlQuotedValue(wranglerToml, "ACCESS_TEAM_DOMAIN");
    let accessAud = null;
    if (configureAccess) {
      let loginEmail = "";
      try {
        loginEmail =
          (await cloudflare.wranglerJson(["whoami", "--json"])).email ?? "";
      } catch {
        loginEmail = "";
      }
      const access = await setupAccess(
        prompt,
        cfToken,
        account,
        hostname,
        loginEmail,
      );
      teamDomain = access.teamDomain;
      accessAud = access.aud;
    }

    await writeWorkerConfig({
      wranglerToml,
      ogToml,
      names,
      databaseId: d1.id,
      teamDomain,
      customHostname,
    });
    logInfo(
      "apps/worker/wrangler.toml と wrangler.og-fetch.toml を更新しました。",
    );

    const deployResult = await deployWorkers(prompt, cloudflare, wranglerEnv, {
      applyMigrations: true,
    });

    if (deployResult.deployed) {
      if (customHostname) {
        const zones = await listZones(cfToken, account.id);
        const zone = zones.find((item) => customHostname.endsWith(item.name));
        if (zone) {
          await attachCustomDomain(cfToken, account.id, {
            hostname: customHostname,
            service: names.workerName,
            zoneId: zone.id,
          });
          logInfo(`カスタムドメインを付けました: https://${customHostname}`);
        }
      }

      const rotateSecret = await prompt.confirm(
        "SESSION_SECRET を新規発行して Worker に入れますか？（既存は上書き）",
        true,
      );
      const sessionSecret = rotateSecret
        ? randomBytes(32).toString("base64url")
        : null;
      await putSecrets(cloudflare, wranglerEnv, {
        sessionSecret,
        accessAud,
      });
    }

    let repo = null;
    if (configureGitHub) {
      repo = await setupGitHub(prompt, commandName("gh"), account, githubToken);
    }

    console.log(`
完了しました。

  Cloudflare account : ${account.name} (${account.id})
  Worker             : ${names.workerName}
  D1                 : ${names.d1Name} (${d1.id})
  R2                 : ${names.r2Name}
  公開 URL           : https://${hostname}
  Access チーム      : ${teamDomain ?? "（未設定）"}
  GitHub             : ${repo?.nameWithOwner ?? "（未登録）"}
  Environment        : ${GITHUB_ENVIRONMENT}

次の作業:
  - 変更した wrangler.toml をコミットして main に載せる
  - フォークでは Settings → Actions を有効にする
  - 以降の本番デプロイは main への push、または Actions の workflow_dispatch
`);
  } finally {
    prompt.close();
  }
}

main(process.argv.slice(2)).catch((error) => {
  console.error(`\n失敗しました: ${error.message}`);
  process.exitCode = 1;
});
