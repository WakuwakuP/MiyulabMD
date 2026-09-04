CREATE TABLE article_sources (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  folder TEXT NOT NULL,
  folder_id TEXT,
  name TEXT NOT NULL,
  schema_json TEXT NOT NULL,
  webhook_url TEXT,
  webhook_authorization TEXT,
  last_dispatched_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (owner_id, folder)
);

CREATE INDEX article_sources_owner_id_idx ON article_sources (owner_id);

ALTER TABLE notes ADD COLUMN article_meta TEXT;
