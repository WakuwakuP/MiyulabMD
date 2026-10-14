import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { upsertUserByEmail } from "../db/users.ts";
import { createNoteService } from "../services/notes.ts";
import { catalogListRequest, handleCatalogList } from "./catalog-list.ts";

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

test("catalog list request drops display names that headers cannot carry", () => {
  const request = catalogListRequest({
    displayName: "宮",
    email: "owner@example.com",
    id: "11111111-1111-1111-1111-111111111111",
  });
  const raw = request.headers.get("x-catalog-user");
  assert.equal(typeof raw, "string");
  assert.deepEqual(JSON.parse(raw ?? ""), {
    email: "owner@example.com",
    id: "11111111-1111-1111-1111-111111111111",
  });
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
