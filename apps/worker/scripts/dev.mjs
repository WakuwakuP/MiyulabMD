import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// Wrangler does not read portless's PORT environment variable.
// Invoke its Node entry point directly so this also works on Windows.
const child = spawn(
  process.execPath,
  [
    require.resolve("wrangler"),
    "dev",
    "-c",
    "wrangler.toml",
    "-c",
    "wrangler.og-fetch.toml",
    "--ip",
    "127.0.0.1",
    "--port",
    process.env.PORT || "8787",
    ...process.argv.slice(2),
  ],
  { stdio: "inherit" },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode =
    code ?? (signal === "SIGINT" || signal === "SIGTERM" ? 0 : 1);
});
