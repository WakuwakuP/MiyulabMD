import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { lsmcpUriToLsp, lspUriToLsmcp } from "./lsmcp-tsc.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

test("round-trips a workspace path through file URIs", () => {
  const abs = path.join(ROOT, "a file.ts");
  const lsmcp = `file://${abs}`;
  const lsp = pathToFileURL(abs).href;

  assert.match(lsp, /%20/);
  assert.equal(lsmcpUriToLsp(lsmcp), lsp);
  assert.equal(lspUriToLsmcp(lsp), lsmcp);
});

test("converts Windows drive-letter URIs that tsc rejects", () => {
  if (process.platform !== "win32") {
    return;
  }
  const lsmcp = "file://G:\\ghq\\github.com\\wakuwakup\\MiyulabMD";

  assert.equal(
    lsmcpUriToLsp(lsmcp),
    "file:///G:/ghq/github.com/wakuwakup/MiyulabMD",
  );
  assert.equal(
    lspUriToLsmcp("file:///G:/ghq/github.com/wakuwakup/MiyulabMD"),
    lsmcp,
  );
});

test("keeps POSIX file URIs unchanged", () => {
  if (process.platform === "win32") {
    return;
  }
  const uri = "file:///home/user/proj";

  assert.equal(lsmcpUriToLsp(uri), uri);
  assert.equal(lspUriToLsmcp(uri), uri);
});

test("tsc --lsp stays up when lsmcp sends a raw file URI", async () => {
  const script = fileURLToPath(new URL("./lsmcp-tsc.mjs", import.meta.url));
  const child = spawn(process.execPath, [script], {
    cwd: ROOT,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const rootUri = `file://${ROOT}`;
  const init = {
    id: 1,
    jsonrpc: "2.0",
    method: "initialize",
    params: {
      capabilities: {},
      processId: process.pid,
      rootPath: ROOT,
      rootUri,
      workspaceFolders: [{ name: "workspace", uri: rootUri }],
    },
  };
  writeMessage(child.stdin, init);

  const response = await readUntil(child, (message) => message.id === 1);
  assert.equal(response.id, 1, stderr);
  assert.ok(response.result?.capabilities, stderr);
  assert.equal(response.error, undefined, stderr);

  writeMessage(child.stdin, {
    jsonrpc: "2.0",
    method: "initialized",
    params: {},
  });
  await new Promise((resolve) => setTimeout(resolve, 1000));

  assert.equal(child.exitCode, null, stderr);
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
});

/**
 * @param {import("node:stream").Writable} output
 * @param {unknown} payload
 */
function writeMessage(output, payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  output.write(`Content-Length: ${body.length}\r\n\r\n`);
  output.write(body);
}

/**
 * @param {import("node:child_process").ChildProcess} child
 * @param {(message: { id?: number, result?: { capabilities?: unknown }, error?: unknown }) => boolean} match
 */
/**
 * @param {Buffer} buffer
 * @returns {{ buffer: Buffer, messages: Array<{ id?: number, result?: { capabilities?: unknown }, error?: unknown }> }}
 */
function consumeMessages(input) {
  const messages = [];
  let buffer = input;
  while (buffer.length > 0) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      break;
    }
    const header = buffer.subarray(0, headerEnd).toString("utf8");
    const found = /Content-Length:\s*(\d+)/i.exec(header);
    if (!found) {
      buffer = buffer.subarray(headerEnd + 4);
      continue;
    }
    const length = Number(found[1]);
    const start = headerEnd + 4;
    if (buffer.length < start + length) {
      break;
    }
    const body = buffer.subarray(start, start + length);
    buffer = buffer.subarray(start + length);
    messages.push(JSON.parse(body.toString("utf8")));
  }
  return { buffer, messages };
}

function readUntil(child, match) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const timeout = setTimeout(() => {
      reject(new Error("timed out waiting for tsc"));
    }, 15_000);
    child.stdout?.on("data", (chunk) => {
      const consumed = consumeMessages(Buffer.concat([buffer, chunk]));
      buffer = consumed.buffer;
      for (const message of consumed.messages) {
        if (match(message)) {
          clearTimeout(timeout);
          resolve(message);
        }
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`tsc exited with ${code}`));
    });
  });
}
