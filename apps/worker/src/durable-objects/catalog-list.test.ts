import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { upsertUserByEmail } from "../db/users.ts";
import { createNoteService } from "../services/notes.ts";
import {
  catalogListRequest,
  catalogObjectName,
  catalogQueryName,
  handleCatalogList,
  readCatalogUser,
} from "./catalog-list.ts";
import { handleCatalogSearch, handleCatalogTree } from "./catalog-read.ts";
import { handleCatalogTool } from "./catalog-tool.ts";

test("catalog query objects stay off the shared guest list", () => {
  const user = {
    displayName: null,
    email: "owner@example.com",
    id: "11111111-1111-1111-1111-111111111111",
  };
  assert.equal(catalogObjectName(user), user.id);
  assert.equal(catalogQueryName(user), `${user.id}:query`);
  const guestNames = new Set(
    Array.from({ length: 64 }, () => catalogQueryName(null)),
  );
  for (const name of guestNames) {
    assert.match(name, /^guest:query:([0-9]|1[0-5])$/);
  }
  assert.ok(guestNames.size > 1);
});

const MIGRATIONS = [
  "0001_init.sql",
  "0002_folders.sql",
  "0003_access_scopes.sql",
  "0004_folders_registry.sql",
  "0005_folder_ids.sql",
  "0006_article_sources.sql",
  "0007_user_root_folders.sql",
  "0008_split_link_and_public_scopes.sql",
  "0009_note_history.sql",
  "0010_note_links.sql",
  "0011_para_buckets.sql",
  "0012_naming_schemes.sql",
  "0013_medallion_layers.sql",
  "0014_notes_fts.sql",
  "0015_user_settings.sql",
  "0016_para_spaces.sql",
  "0017_medallion_sets_edit_lock.sql",
  "0018_scheme_root.sql",
  "0021_shared_drives.sql",
];

function applyMigrations(db: DatabaseSync): void {
  for (const migration of MIGRATIONS) {
    const sql = readFileSync(
      new URL(`../db/migrations/${migration}`, import.meta.url),
      "utf8",
    );
    db.exec(sql);
  }
}

type BoundStatement = {
  bind: (...values: unknown[]) => BoundStatement;
  all: <T = Record<string, unknown>>() => Promise<{ results: T[] }>;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  run: () => Promise<{ success: true }>;
};

class StatementAdapter implements BoundStatement {
  private readonly db: DatabaseSync;
  private readonly query: string;
  private readonly binds: unknown[];

  constructor(db: DatabaseSync, query: string, binds: unknown[] = []) {
    this.db = db;
    this.query = query;
    this.binds = binds;
  }

  bind(...values: unknown[]): BoundStatement {
    return new StatementAdapter(this.db, this.query, values);
  }

  all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    const rows = this.db.prepare(this.query).all(...this.binds);
    return Promise.resolve({ results: rows as T[] });
  }

  first<T = Record<string, unknown>>(): Promise<T | null> {
    const row = this.db.prepare(this.query).get(...this.binds);
    return Promise.resolve((row as T | null) ?? null);
  }

  runSync(): { success: true } {
    this.db.prepare(this.query).run(...this.binds);
    return { success: true };
  }

  run(): Promise<{ success: true }> {
    return Promise.resolve(this.runSync());
  }
}

class D1Adapter {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  prepare(query: string): BoundStatement {
    return new StatementAdapter(this.db, query);
  }

  batch(statements: BoundStatement[]) {
    this.db.exec("BEGIN");
    try {
      const results = statements.map((statement) =>
        (statement as StatementAdapter).runSync(),
      );
      this.db.exec("COMMIT");
      return Promise.resolve(results);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

async function createEnv() {
  const sqlite = new DatabaseSync(":memory:");
  applyMigrations(sqlite);
  const env = {
    ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com",
    ALLOW_ANONYMOUS: "false",
    ALLOW_ANONYMOUS_EDITS: "true",
    ALLOW_ANONYMOUS_VIEWS: "true",
    DB: new D1Adapter(sqlite),
    DEFAULT_PERMISSION: "editable",
    DEV_AUTH: "false",
  } as unknown as Env;
  const owner = await upsertUserByEmail(env, "owner@example.com", "Owner");
  const viewer = await upsertUserByEmail(env, "viewer@example.com", "Viewer");
  const notes = createNoteService(env);
  const secret = await notes.create(owner, {
    markdown: "# Secret",
    permission: "private",
    title: "Secret",
  });
  const visible = await notes.create(owner, {
    markdown: "# Public",
    readScope: "public",
    title: "Public",
    writeScope: "self",
  });
  if ("error" in secret || "error" in visible) {
    throw new Error("seed failed");
  }
  return { env, owner, sqlite, viewer };
}

function titles(body: { notes?: Array<{ title: string }> }): string[] {
  return (body.notes ?? []).map((note) => note.title).sort();
}

test("catalog list uses listForUser for the header user and listForGuest otherwise", async (t) => {
  const { env, owner, sqlite, viewer } = await createEnv();
  t.after(() => sqlite.close());

  const asOwner = await handleCatalogList(
    env,
    new Request("https://catalog.internal/list", {
      headers: {
        "x-catalog-user": JSON.stringify({
          displayName: owner.displayName,
          email: owner.email,
          id: owner.id,
        }),
      },
    }),
  );
  assert.equal(asOwner.status, 200);
  assert.deepEqual(titles(await asOwner.json()), ["Public", "Secret"]);

  const asViewer = await handleCatalogList(
    env,
    new Request("https://catalog.internal/list", {
      headers: {
        "x-catalog-user": JSON.stringify({
          displayName: viewer.displayName,
          email: viewer.email,
          id: viewer.id,
        }),
      },
    }),
  );
  assert.deepEqual(titles(await asViewer.json()), ["Public"]);

  const asGuest = await handleCatalogList(
    env,
    new Request("https://catalog.internal/list"),
  );
  assert.deepEqual(titles(await asGuest.json()), ["Public"]);
});

test("catalog user header carries a percent-encoded display name", () => {
  const request = catalogListRequest({
    displayName: "宮",
    email: "owner@example.com",
    id: "11111111-1111-1111-1111-111111111111",
  });
  const raw = request.headers.get("x-catalog-user");
  assert.equal(typeof raw, "string");
  assert.deepEqual(JSON.parse(raw ?? ""), {
    displayName: encodeURIComponent("宮"),
    email: "owner@example.com",
    id: "11111111-1111-1111-1111-111111111111",
  });
  const user = readCatalogUser(request);
  assert.ok(user && user !== "invalid");
  assert.equal(user.displayName, "宮");
});

test("catalog list rejects a bad user header and a guest tool query", async (t) => {
  const { env, sqlite } = await createEnv();
  t.after(() => sqlite.close());

  const invalid = await handleCatalogList(
    env,
    new Request("https://catalog.internal/list", {
      headers: { "x-catalog-user": "{" },
    }),
  );
  assert.equal(invalid.status, 400);

  const guestTool = await handleCatalogList(
    env,
    new Request("https://catalog.internal/list", {
      body: JSON.stringify({ query: "Public" }),
      method: "POST",
    }),
  );
  assert.equal(guestTool.status, 401);
});

function userHeader(user: { email: string; id: string }) {
  return {
    "content-type": "application/json",
    "x-catalog-user": JSON.stringify({ email: user.email, id: user.id }),
  };
}

function toolCall(name: string, args: object, id: number | string = 7) {
  return JSON.stringify({
    id,
    jsonrpc: "2.0",
    method: "tools/call",
    params: { arguments: args, name },
  });
}

function rpcText(body: string): {
  result?: { content?: { text: string }[]; isError?: boolean };
} {
  const line = body.split("\n").find((item) => item.startsWith("data: "));
  assert.ok(line);
  return JSON.parse(line.slice("data: ".length));
}

test("catalog tool returns list_notes as SSE without a worker parse", async (t) => {
  const { env, owner, sqlite, viewer } = await createEnv();
  t.after(() => sqlite.close());

  const response = await handleCatalogTool(
    env,
    new Request("https://catalog.internal/tool", {
      body: toolCall("list_notes", { query: "public" }),
      headers: userHeader(owner),
      method: "POST",
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  const payload = rpcText(await response.text());
  const notes = JSON.parse(payload.result?.content?.[0]?.text ?? "{}") as {
    notes: { title: string }[];
  };
  assert.deepEqual(
    notes.notes.map((note) => note.title),
    ["Public"],
  );

  const hidden = await handleCatalogTool(
    env,
    new Request("https://catalog.internal/tool", {
      body: toolCall("list_notes", {}),
      headers: userHeader(viewer),
      method: "POST",
    }),
  );
  const viewerNotes = JSON.parse(
    rpcText(await hidden.text()).result?.content?.[0]?.text ?? "{}",
  ) as { notes: { title: string }[] };
  assert.deepEqual(
    viewerNotes.notes.map((note) => note.title),
    ["Public"],
  );
});

test("catalog tool keeps validation errors inside the tool result", async (t) => {
  const { env, owner, sqlite } = await createEnv();
  t.after(() => sqlite.close());
  const response = await handleCatalogTool(
    env,
    new Request("https://catalog.internal/tool", {
      body: toolCall("list_folder_entries", { limit: 0 }),
      headers: userHeader(owner),
      method: "POST",
    }),
  );
  const payload = rpcText(await response.text());
  assert.equal(payload.result?.isError, true);
  assert.match(
    payload.result?.content?.[0]?.text ?? "",
    /Input validation error/,
  );
});

test("catalog tool reads get_note from the document room", async (t) => {
  const { env, owner, sqlite, viewer } = await createEnv();
  t.after(() => sqlite.close());
  const rows = sqlite.prepare("SELECT id, title FROM notes").all() as {
    id: string;
    title: string;
  }[];
  const visible = rows.find((row) => row.title === "Public");
  const secret = rows.find((row) => row.title === "Secret");
  assert.ok(visible);
  assert.ok(secret);
  const seen: { displayName: string; userId: string }[] = [];
  Object.assign(env, {
    DOCUMENT_ROOM: {
      get: () => ({
        readForAgent: (
          _noteId: string,
          agent: { displayName: string; userId: string },
        ) => {
          seen.push(agent);
          return Promise.resolve("# Public\n");
        },
      }),
      idFromName: (name: string) => name,
    },
  });

  const response = await handleCatalogTool(
    env,
    new Request("https://catalog.internal/tool", {
      body: toolCall("get_note", { id: visible.id, numbered: true }),
      headers: {
        "content-type": "application/json",
        "x-catalog-user": JSON.stringify({
          displayName: encodeURIComponent("宮"),
          email: owner.email,
          id: owner.id,
        }),
      },
      method: "POST",
    }),
  );
  const payload = rpcText(await response.text());
  const text = payload.result?.content?.[0]?.text ?? "";
  const body = JSON.parse(text) as {
    note: { markdown: string };
    numberedMarkdown: string;
    outline: { text: string }[];
  };
  assert.equal(body.note.markdown, "# Public\n");
  assert.equal(body.outline[0]?.text, "Public");
  assert.match(body.numberedMarkdown, /1\|# Public/);
  assert.deepEqual(seen, [{ displayName: "宮", userId: owner.id }]);

  const hidden = await handleCatalogTool(
    env,
    new Request("https://catalog.internal/tool", {
      body: toolCall("get_note", { id: secret.id }),
      headers: userHeader(viewer),
      method: "POST",
    }),
  );
  const denied = rpcText(await hidden.text());
  assert.equal(denied.result?.isError, true);
  assert.equal(denied.result?.content?.[0]?.text, "Forbidden");
});

test("catalog search and tree run for the header user", async (t) => {
  const { env, owner, sqlite } = await createEnv();
  t.after(() => sqlite.close());
  const search = await handleCatalogSearch(
    env,
    new Request(
      "https://catalog.internal/search/notes?query=Public&scope=title",
      {
        headers: userHeader(owner),
      },
    ),
  );
  assert.equal(search.status, 200);
  const body = (await search.json()) as { notes: { title: string }[] };
  assert.ok(body.notes.some((note) => note.title === "Public"));

  const tree = await handleCatalogTree(
    env,
    new Request("https://catalog.internal/tree", {
      headers: userHeader(owner),
    }),
  );
  assert.equal(tree.status, 200);
  const folders = (await tree.json()) as { folders: unknown[] };
  assert.ok(folders.folders.length > 0);
});
