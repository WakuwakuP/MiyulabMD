-- 概念スキーマ。適用は src/db/migrations 経由。
-- 本文のソース・オブ・トゥルースは DocumentRoom Durable Object。

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  short_id TEXT NOT NULL UNIQUE,
  alias TEXT UNIQUE,
  owner_id TEXT NOT NULL REFERENCES users (id),
  title TEXT NOT NULL DEFAULT 'Untitled',
  folder TEXT NOT NULL DEFAULT '',
  permission TEXT NOT NULL,
  read_scope TEXT,
  write_scope TEXT,
  markdown_snapshot TEXT NOT NULL DEFAULT '',
  snapshot_updated_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE note_collaborators (
  note_id TEXT NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id),
  role TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (note_id, user_id)
);

CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  folder TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX folders_owner_folder_idx ON folders (owner_id, folder);

CREATE TABLE folder_policies (
  owner_id TEXT NOT NULL,
  folder TEXT NOT NULL,
  read_scope TEXT NOT NULL,
  write_scope TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, folder)
);

CREATE TABLE access_grants (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_key TEXT NOT NULL,
  email TEXT NOT NULL,
  user_id TEXT,
  can_write INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE images (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  uploader_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);

CREATE INDEX notes_owner_id_idx ON notes (owner_id);
CREATE INDEX notes_owner_folder_idx ON notes (owner_id, folder);
CREATE UNIQUE INDEX access_grants_target_email_idx ON access_grants (target_kind, target_key, email);
CREATE INDEX access_grants_user_id_idx ON access_grants (user_id);
CREATE INDEX access_grants_owner_id_idx ON access_grants (owner_id);
CREATE INDEX notes_updated_at_idx ON notes (updated_at);
CREATE INDEX images_note_id_idx ON images (note_id);
CREATE INDEX api_tokens_user_id_idx ON api_tokens (user_id);
