import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, normalizePath } from "vite";

// Candidate files are authoritative. Nothing in this runner writes to src or
// copies generated files back into the candidate directory.
const webRoot = fileURLToPath(new URL("../", import.meta.url));
const repoRoot = path.resolve(webRoot, "../..");
const candidateRoot = path.resolve(process.argv[2] ?? "");
const mode = process.argv[3] ?? "all";
const relative = path.relative(repoRoot, candidateRoot);
if (
  !process.argv[2] ||
  relative.startsWith("..") ||
  path.isAbsolute(relative) ||
  !["all", "browser", "typecheck", "lint"].includes(mode)
) {
  throw new Error(
    "Usage: node check-offline-candidate.mjs <worktree-candidate-dir> [all|browser|typecheck|lint] [specs...]",
  );
}
if (candidateRoot === path.join(webRoot, "src/lib")) {
  throw new Error("Use a candidate directory, not the live source directory");
}

const files = (await readdir(candidateRoot)).filter((name) =>
  name.endsWith(".ts"),
);
for (const required of ["offline-cache.ts", "note-read-session.ts"]) {
  if (!files.includes(required)) {
    throw new Error(`Missing candidate: ${required}`);
  }
}
const contents = new Map();
for (const name of files) {
  contents.set(name, await readFile(path.join(candidateRoot, name), "utf8"));
}
const digest = (text) => createHash("sha256").update(text).digest("hex");
const sources = new Map(
  [...contents].map(([name, text]) => [
    normalizePath(path.join(webRoot, "src/lib", name)),
    text,
  ]),
);
const liveBefore = new Map();
async function readLive(name) {
  try {
    return await readFile(path.join(webRoot, "src/lib", name), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}
for (const name of files) {
  liveBefore.set(name, await readLive(name));
}

const cacheRoot = path.join(webRoot, "node_modules/.cache/offline-candidate");
await mkdir(cacheRoot, { recursive: true });
const runRoot = await mkdtemp(path.join(cacheRoot, "run-"));

async function runNode(args) {
  const child = spawn(process.execPath, args, {
    cwd: webRoot,
    stdio: "inherit",
  });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0) {
    throw new Error(`Validation exited ${code}: ${args.join(" ")}`);
  }
}

async function packageBin(packageName, command) {
  const manifestPath = fileURLToPath(
    import.meta.resolve(`${packageName}/package.json`),
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  return path.resolve(path.dirname(manifestPath), manifest.bin[command]);
}

async function typecheck() {
  // TypeScript 7 uses a native CLI rather than the old compiler-host API.
  // A disposable tree preserves relative module resolution without touching
  // either live sources or canonical candidates.
  await cp(path.join(webRoot, "src"), path.join(runRoot, "src"), {
    recursive: true,
  });
  for (const [name, text] of contents) {
    await writeFile(path.join(runRoot, "src/lib", name), text);
  }
  const config = path.join(runRoot, "tsconfig.json");
  await writeFile(
    config,
    JSON.stringify({
      exclude: ["src/**/*.test.ts"],
      extends: path.join(webRoot, "tsconfig.json"),
      include: ["src"],
    }),
  );
  await runNode([
    await packageBin("typescript", "tsc"),
    "--project",
    config,
    "--noEmit",
  ]);
}

async function lint() {
  await runNode([
    await packageBin("@biomejs/biome", "biome"),
    "check",
    ...files.map((name) => path.join(candidateRoot, name)),
  ]);
}

async function browser() {
  const loaded = new Set();
  const server = await createServer({
    plugins: [
      {
        enforce: "pre",
        load(id) {
          const key = normalizePath(id.split("?")[0]);
          if (!sources.has(key)) {
            return null;
          }
          loaded.add(key);
          return sources.get(key);
        },
        name: "offline-candidate",
        resolveId(source, importer) {
          let resolved = source;
          if (source.startsWith("/src/")) {
            resolved = path.join(webRoot, source.slice(1));
          } else if (source.startsWith(".") && importer) {
            resolved = path.resolve(
              path.dirname(importer.split("?")[0]),
              source,
            );
          }
          const key = normalizePath(resolved);
          return sources.has(key) ? key : null;
        },
      },
    ],
    root: webRoot,
    server: { host: "127.0.0.1", port: 0 },
  });
  try {
    await server.listen();
    const port = server.httpServer.address().port;
    const config = path.join(runRoot, "playwright.config.mjs");
    await writeFile(
      config,
      `export default ${JSON.stringify({
        outputDir: path.join(runRoot, "results"),
        projects: [{ name: "chromium", use: { browserName: "chromium" } }],
        reporter: "list",
        retries: 0,
        testDir: path.join(webRoot, "tests/browser"),
        use: { baseURL: `http://127.0.0.1:${port}` },
      })};`,
    );
    const specs = process.argv.slice(4);
    await runNode([
      path.join(webRoot, "scripts/playwright.mjs"),
      "test",
      "--config",
      config,
      ...(specs.length
        ? specs
        : [
            "offline-direct-denial.spec.ts",
            "note-denial-entry-ordering.spec.ts",
            "user-cache-write-lifecycle.spec.ts",
            "user-cache-suspension.spec.ts",
            "note-denial-ordering.spec.ts",
            "note-denial-failure.spec.ts",
            "note-read-denial.spec.ts",
            "note-read-session.spec.ts",
            "note-read-publication.spec.ts",
            "viewer-context.spec.ts",
            "offline-cache.spec.ts",
            "offline-cache-cleanup.spec.ts",
            "offline-folder-cache.spec.ts",
            "offline-note-list-cache.spec.ts",
            "storage-platform.spec.ts",
          ]),
    ]);
    if (loaded.size === 0) {
      throw new Error("The selected tests did not load any candidate module");
    }
    const required = specs.length
      ? []
      : ["offline-cache.ts", "note-read-session.ts"];
    for (const name of required) {
      if (!loaded.has(normalizePath(path.join(webRoot, "src/lib", name)))) {
        throw new Error(`Candidate was not loaded: ${name}`);
      }
    }
  } finally {
    await server.close();
  }
}

async function verifyUnchanged() {
  for (const [name, text] of contents) {
    if ((await readFile(path.join(candidateRoot, name), "utf8")) !== text) {
      throw new Error(`Candidate changed during validation: ${name}`);
    }
    if ((await readLive(name)) !== liveBefore.get(name)) {
      throw new Error(`Live source changed during validation: ${name}`);
    }
  }
}

try {
  for (const [name, text] of contents) {
    console.log(`Candidate SHA256 ${digest(text)} ${name}`);
  }
  if (mode === "all" || mode === "typecheck") {
    await typecheck();
  }
  if (mode === "all" || mode === "lint") {
    await lint();
  }
  if (mode === "all" || mode === "browser") {
    await browser();
  }
} finally {
  // Always check the authoritative files, including after a failed test.
  try {
    await verifyUnchanged();
  } finally {
    await rm(runRoot, { force: true, recursive: true });
  }
}
