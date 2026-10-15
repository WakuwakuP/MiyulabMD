#!/usr/bin/env node

// lsmcp と TypeScript 7 の `tsc --lsp` の間に入る。
// Windows では node_modules/.bin/tsc が .cmd なので、lsmcp の spawn から起動できない。
// lsmcp は file URI を `file://` + 生パスで作る。ドライブレター付きだと
// `file://G:\...` になり、tsc が panic する。ここでは node から tsc を起動し、
// LSP の file URI を両方向に正規化する。Linux では変換結果は元の URI と同じになる。

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

/**
 * @param {string} uri
 * @returns {string}
 */
export function lsmcpUriToLsp(uri) {
  if (!uri.startsWith("file://")) {
    return uri;
  }
  const raw = uri.slice("file://".length);
  try {
    if (raw.startsWith("/")) {
      return pathToFileURL(fileURLToPath(uri)).href;
    }
    return pathToFileURL(raw).href;
  } catch {
    return uri;
  }
}

/**
 * @param {string} uri
 * @returns {string}
 */
export function lspUriToLsmcp(uri) {
  if (!uri.startsWith("file:")) {
    return uri;
  }
  try {
    return `file://${fileURLToPath(uri)}`;
  } catch {
    return uri;
  }
}

/**
 * @param {unknown} value
 * @param {(uri: string) => string} mapUri
 * @returns {unknown}
 */
function rewriteValue(value, mapUri) {
  if (typeof value === "string") {
    return value.startsWith("file://") ? mapUri(value) : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewriteValue(item, mapUri));
  }
  if (value && typeof value === "object") {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = rewriteValue(item, mapUri);
    }
    return out;
  }
  return value;
}

/**
 * @param {Buffer} body
 * @param {(uri: string) => string} mapUri
 * @returns {Buffer}
 */
function transformBody(body, mapUri) {
  /** @type {unknown} */
  let payload;
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    return body;
  }
  return Buffer.from(JSON.stringify(rewriteValue(payload, mapUri)), "utf8");
}

/**
 * @param {(body: Buffer) => void} onMessage
 * @returns {(chunk: Buffer) => void}
 */
function createParser(onMessage) {
  let buffer = Buffer.alloc(0);
  return (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length > 0) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        return;
      }
      const header = buffer.subarray(0, headerEnd).toString("utf8");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        buffer = buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const start = headerEnd + 4;
      if (buffer.length < start + length) {
        return;
      }
      const body = buffer.subarray(start, start + length);
      buffer = buffer.subarray(start + length);
      onMessage(body);
    }
  };
}

/**
 * @param {NodeJS.WritableStream} output
 * @param {Buffer} body
 */
function writeMessage(output, body) {
  output.write(`Content-Length: ${body.length}\r\n\r\n`);
  output.write(body);
}

function main() {
  const tscJs = path.join(ROOT, "node_modules", "typescript", "bin", "tsc");
  if (!existsSync(tscJs)) {
    console.error(`tsc not found: ${tscJs}`);
    process.exit(1);
  }

  const child = spawn(process.execPath, [tscJs, "--lsp", "--stdio"], {
    cwd: ROOT,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stderr.pipe(process.stderr);
  // tsc が先に終了すると stdin へ書いた時点で EPIPE になる。終了コードの方を見る。
  child.stdin.on("error", (error) => {
    if (error && "code" in error && error.code !== "EPIPE") {
      console.error(error.message);
    }
  });
  child.on("error", (error) => {
    console.error(error.message);
    process.exit(1);
  });
  child.on("exit", (code) => {
    process.exit(code ?? 1);
  });

  process.stdin.on(
    "data",
    createParser((body) => {
      writeMessage(child.stdin, transformBody(body, lsmcpUriToLsp));
    }),
  );
  process.stdin.on("end", () => child.stdin.end());
  child.stdout.on(
    "data",
    createParser((body) => {
      writeMessage(process.stdout, transformBody(body, lspUriToLsmcp));
    }),
  );

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => child.kill(signal));
  }
}

const entryArg = process.argv[1];
if (entryArg) {
  const fromArg = path.resolve(entryArg);
  const fromUrl = fileURLToPath(import.meta.url);
  const same =
    process.platform === "win32"
      ? fromArg.toLowerCase() === fromUrl.toLowerCase()
      : fromArg === fromUrl;
  if (same) {
    main();
  }
}
