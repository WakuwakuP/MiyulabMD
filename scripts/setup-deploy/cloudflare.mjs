import { ACCESS_APP_NAME, extractJson } from "./helpers.mjs";
import { runCommand } from "./process.mjs";

const CF_API = "https://api.cloudflare.com/client/v4";

export function createCloudflare({ wranglerBin, wranglerArgs, workerDir }) {
  return {
    workerDir,

    async wrangler(args, options = {}) {
      return await runCommand(
        this.wranglerBin,
        [...this.wranglerArgs, ...args],
        {
          allowFail: options.allowFail,
          cwd: this.workerDir,
          env: options.env,
          inherit: options.inherit,
          input: options.input,
        },
      );
    },
    wranglerArgs,
    wranglerBin,

    async wranglerJson(args, options = {}) {
      const result = await this.wrangler(args, options);
      return extractJson(`${result.stdout}\n${result.stderr}`);
    },
  };
}

export async function cfApi(token, path, options = {}) {
  const { method = "GET", body, query } = options;
  const url = new URL(path.startsWith("http") ? path : `${CF_API}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const response = await fetch(url, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    method,
  });

  const payload = await response.json().catch(() => null);
  if (!payload?.success) {
    const message =
      payload?.errors?.map((item) => item.message).join("; ") ||
      `${response.status} ${response.statusText}`;
    const error = new Error(message);
    error.status = response.status;
    error.errors = payload?.errors ?? [];
    error.payload = payload;
    throw error;
  }
  return payload;
}

export function isNotFound(error) {
  if (error.status === 404) {
    return true;
  }
  return (error.errors ?? []).some((item) => item.code === 7003);
}

export async function cfList(token, path) {
  const items = [];
  let page = 1;
  for (;;) {
    const payload = await cfApi(token, path, {
      query: { page, per_page: 50 },
    });
    const batch = Array.isArray(payload.result) ? payload.result : [];
    items.push(...batch);
    const total = payload.result_info?.total_count;
    if (batch.length < 50 || (total && items.length >= total)) {
      break;
    }
    page += 1;
  }
  return items;
}

export async function verifyToken(token) {
  const payload = await cfApi(token, "/user/tokens/verify");
  return payload.result;
}

export async function listAccounts(token) {
  return await cfList(token, "/accounts");
}

export async function ensureD1(token, accountId, name) {
  const databases = await cfList(token, `/accounts/${accountId}/d1/database`);
  const existing = databases.find((item) => item.name === name);
  if (existing) {
    return {
      created: false,
      id: existing.uuid ?? existing.id,
      name: existing.name,
    };
  }
  const payload = await cfApi(token, `/accounts/${accountId}/d1/database`, {
    body: { name },
    method: "POST",
  });
  return { created: true, id: payload.result.uuid, name: payload.result.name };
}

export async function listR2Buckets(token, accountId) {
  const buckets = [];
  let cursor;
  for (;;) {
    const payload = await cfApi(token, `/accounts/${accountId}/r2/buckets`, {
      query: { per_page: 50, ...(cursor ? { cursor } : {}) },
    });
    const page = payload.result?.buckets ?? [];
    buckets.push(...page);
    const next = payload.result_info?.cursor;
    if (!(payload.result_info?.is_truncated && next)) {
      break;
    }
    cursor = next;
  }
  return buckets;
}

export async function ensureR2(token, accountId, name) {
  const buckets = await listR2Buckets(token, accountId);
  const existing = buckets.find((item) => item.name === name);
  if (existing) {
    return { created: false, name };
  }
  await cfApi(token, `/accounts/${accountId}/r2/buckets`, {
    body: { name },
    method: "POST",
  });
  return { created: true, name };
}

export async function ensureWorkersSubdomain(token, accountId, fallback) {
  try {
    const payload = await cfApi(
      token,
      `/accounts/${accountId}/workers/subdomain`,
    );
    if (payload.result?.subdomain) {
      return payload.result.subdomain;
    }
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }
  }

  const payload = await cfApi(
    token,
    `/accounts/${accountId}/workers/subdomain`,
    {
      body: { subdomain: fallback },
      method: "PUT",
    },
  );
  return payload.result.subdomain;
}

export async function listZones(token, accountId) {
  const items = [];
  let page = 1;
  for (;;) {
    const payload = await cfApi(token, "/zones", {
      query: { "account.id": accountId, page, per_page: 50 },
    });
    const batch = Array.isArray(payload.result) ? payload.result : [];
    items.push(...batch);
    if (batch.length < 50) {
      break;
    }
    page += 1;
  }
  return items;
}

export async function attachCustomDomain(
  token,
  accountId,
  { hostname, service, zoneId },
) {
  const existing = await cfList(
    token,
    `/accounts/${accountId}/workers/domains`,
  );
  const found = existing.find((item) => item.hostname === hostname);
  if (found) {
    return found;
  }
  const payload = await cfApi(token, `/accounts/${accountId}/workers/domains`, {
    body: { hostname, service, zone_id: zoneId },
    method: "PUT",
  });
  return payload.result;
}

export async function getAccessOrganization(token, accountId) {
  try {
    const payload = await cfApi(
      token,
      `/accounts/${accountId}/access/organizations`,
    );
    return payload.result;
  } catch (error) {
    if (
      isNotFound(error) ||
      /not (been )?set up|does not exist/i.test(error.message)
    ) {
      return null;
    }
    throw error;
  }
}

export async function createAccessOrganization(
  token,
  accountId,
  { name, authDomain },
) {
  const payload = await cfApi(
    token,
    `/accounts/${accountId}/access/organizations`,
    {
      body: {
        auth_domain: authDomain,
        name,
        session_duration: "24h",
      },
      method: "POST",
    },
  );
  return payload.result;
}

export async function listAccessApps(token, accountId) {
  return await cfList(token, `/accounts/${accountId}/access/apps`);
}

function destinationUri(app) {
  const destinations = app.destinations ?? [];
  const fromDest = destinations
    .map((item) => item.uri)
    .filter(Boolean)
    .join(" ");
  const domains = (app.self_hosted_domains ?? []).join(" ");
  return `${fromDest} ${app.domain ?? ""} ${domains}`;
}

export async function ensureAccessApp(
  token,
  accountId,
  { destination, includes },
) {
  const apps = await listAccessApps(token, accountId);
  const existing = apps.find(
    (app) =>
      app.name === ACCESS_APP_NAME ||
      destinationUri(app).includes(destination.replace(/\/auth\*$/, "/auth")),
  );

  const body = {
    app_launcher_visible: false,
    auto_redirect_to_identity: false,
    destinations: [{ type: "public", uri: destination }],
    name: ACCESS_APP_NAME,
    policies: [
      {
        decision: "allow",
        include: includes,
        name: "Allow MiyulabMD login",
        precedence: 1,
      },
    ],
    session_duration: "24h",
    type: "self_hosted",
  };

  if (existing) {
    try {
      const payload = await cfApi(
        token,
        `/accounts/${accountId}/access/apps/${existing.id}`,
        { body, method: "PUT" },
      );
      return { app: payload.result, created: false };
    } catch {
      return { app: existing, created: false };
    }
  }

  try {
    const payload = await cfApi(token, `/accounts/${accountId}/access/apps`, {
      body,
      method: "POST",
    });
    return { app: payload.result, created: true };
  } catch {
    const payload = await cfApi(token, `/accounts/${accountId}/access/apps`, {
      body: {
        app_launcher_visible: false,
        destinations: [{ type: "public", uri: destination }],
        name: ACCESS_APP_NAME,
        session_duration: "24h",
        type: "self_hosted",
      },
      method: "POST",
    });
    try {
      await cfApi(
        token,
        `/accounts/${accountId}/access/apps/${payload.result.id}/policies`,
        {
          body: {
            decision: "allow",
            include: includes,
            name: "Allow MiyulabMD login",
          },
          method: "POST",
        },
      );
    } catch (policyError) {
      console.warn(
        `  Access ポリシーの追加に失敗しました: ${policyError.message}`,
      );
    }
    return { app: payload.result, created: true };
  }
}

export async function listIdentityProviders(token, accountId) {
  try {
    return await cfList(
      token,
      `/accounts/${accountId}/access/identity_providers`,
    );
  } catch {
    return [];
  }
}

export async function putWorkerSecret(
  cloudflare,
  { name, value, env, config },
) {
  const args = ["secret", "put", name];
  if (config) {
    args.push("-c", config);
  }
  await cloudflare.wrangler(args, {
    env,
    input: `${value}\n`,
  });
}
