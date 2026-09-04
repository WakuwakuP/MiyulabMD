import { spawn } from "node:child_process";

export function runCommand(command, args, options = {}) {
  const { cwd, env, inherit = false, input, allowFail = false } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      stdio: inherit
        ? "inherit"
        : [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    if (!inherit) {
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
    }

    if (input !== undefined && child.stdin) {
      child.stdin.end(input);
    }

    child.on("error", reject);
    child.on("close", (code) => {
      const result = { code: code ?? 1, stdout, stderr };
      if (code !== 0 && !allowFail) {
        const detail = (stderr || stdout || `exit ${code}`).trim();
        const error = new Error(detail);
        error.result = result;
        reject(error);
        return;
      }
      resolve(result);
    });
  });
}

export async function commandExists(command) {
  const probe = process.platform === "win32" ? "where" : "which";
  const result = await runCommand(probe, [command], { allowFail: true });
  return result.code === 0;
}
