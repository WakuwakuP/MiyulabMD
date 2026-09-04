import { GITHUB_ENVIRONMENT, parseGitHubRemote } from "./helpers.mjs";
import { runCommand } from "./process.mjs";

export async function gh(args, options = {}) {
  return runCommand(options.ghBin, args, {
    cwd: options.cwd,
    inherit: options.inherit,
    allowFail: options.allowFail,
  });
}

export async function ensureGhAuth(ghBin, prompt) {
  const status = await runCommand(ghBin, ["auth", "status"], {
    allowFail: true,
  });
  if (status.code === 0) {
    return;
  }
  console.log("\nGitHub CLI にログインします。ブラウザが開きます。");
  const ok = await prompt.confirm("gh auth login を実行しますか？", true);
  if (!ok) {
    throw new Error("GitHub にログインしてください: gh auth login");
  }
  await runCommand(
    ghBin,
    ["auth", "login", "--web", "--git-protocol", "https"],
    {
      inherit: true,
    },
  );
}

export async function detectGitHubRepo(ghBin, rootDir) {
  try {
    const viewed = await runCommand(ghBin, [
      "repo",
      "view",
      "--json",
      "nameWithOwner,url,isFork",
    ]);
    const repo = JSON.parse(viewed.stdout);
    const [owner, name] = repo.nameWithOwner.split("/");
    return {
      owner,
      name,
      nameWithOwner: repo.nameWithOwner,
      url: repo.url,
      isFork: Boolean(repo.isFork),
    };
  } catch {
    const remote = await runCommand("git", ["remote", "get-url", "origin"], {
      cwd: rootDir,
    });
    const parsed = parseGitHubRemote(remote.stdout);
    return {
      ...parsed,
      nameWithOwner: `${parsed.owner}/${parsed.name}`,
      url: `https://github.com/${parsed.owner}/${parsed.name}`,
      isFork: null,
    };
  }
}

export async function ensureEnvironment(ghBin, nameWithOwner) {
  await runCommand(ghBin, [
    "api",
    "--method",
    "PUT",
    `repos/${nameWithOwner}/environments/${GITHUB_ENVIRONMENT}`,
  ]);
}

export async function setEnvironmentSecret(ghBin, nameWithOwner, name, value) {
  await runCommand(
    ghBin,
    [
      "secret",
      "set",
      name,
      "--env",
      GITHUB_ENVIRONMENT,
      "--repo",
      nameWithOwner,
    ],
    { input: value },
  );
}

export async function setEnvironmentVariable(
  ghBin,
  nameWithOwner,
  name,
  value,
) {
  await runCommand(
    ghBin,
    [
      "variable",
      "set",
      name,
      "--env",
      GITHUB_ENVIRONMENT,
      "--repo",
      nameWithOwner,
    ],
    { input: value },
  );
}
