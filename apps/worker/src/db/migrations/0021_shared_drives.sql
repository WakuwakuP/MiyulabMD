-- Shared drives are a subject distinct from users. owner_id keeps the
-- subject id; owner_kind says whether that id is a user or a drive.
-- The notes.owner_id and medallion_sets.owner_user_id foreign keys are
-- removed so a drive id can live in the same namespace. Child rows keep
-- their note ids. defer_foreign_keys lets D1 drop a referenced table
-- inside the migration transaction; node:sqlite tests keep foreign keys off.

PRAGMA defer_foreign_keys = ON;
PRAGMA foreign_keys = OFF;

CREATE TABLE notes_new (
  id TEXT PRIMARY KEY,
  short_id TEXT NOT NULL UNIQUE,
  alias TEXT UNIQUE,
  owner_id TEXT NOT NULL,
  owner_kind TEXT NOT NULL DEFAULT 'user',
  title TEXT NOT NULL DEFAULT 'Untitled',
  folder TEXT NOT NULL DEFAULT '',
  permission TEXT NOT NULL,
  read_scope TEXT,
  write_scope TEXT,
  markdown_snapshot TEXT NOT NULL DEFAULT '',
  snapshot_updated_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  article_meta TEXT,
  edit_locked INTEGER NOT NULL DEFAULT 0,
  layer TEXT NOT NULL DEFAULT 'bronze',
  gold_unlocked_until INTEGER
);

INSERT INTO notes_new (
  id, short_id, alias, owner_id, owner_kind, title, folder, permission,
  read_scope, write_scope, markdown_snapshot, snapshot_updated_at,
  created_at, updated_at, article_meta, edit_locked, layer, gold_unlocked_until
)
SELECT
  id, short_id, alias, owner_id, 'user', title, folder, permission,
  read_scope, write_scope, markdown_snapshot, snapshot_updated_at,
  created_at, updated_at, article_meta, edit_locked, layer, gold_unlocked_until
FROM notes;

DROP TABLE notes;
ALTER TABLE notes_new RENAME TO notes;

CREATE INDEX notes_owner_id_idx ON notes (owner_id);
CREATE INDEX notes_updated_at_idx ON notes (updated_at);
CREATE INDEX notes_owner_folder_idx ON notes (owner_id, folder);
CREATE INDEX notes_owner_layer_idx ON notes (owner_id, layer);
CREATE INDEX idx_notes_edit_locked ON notes (owner_id) WHERE edit_locked = 1;

CREATE TABLE medallion_sets_new (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  layers TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);

INSERT INTO medallion_sets_new (id, owner_user_id, name, layers, created_at)
SELECT id, owner_user_id, name, layers, created_at FROM medallion_sets;

DROP TABLE medallion_sets;
ALTER TABLE medallion_sets_new RENAME TO medallion_sets;

CREATE INDEX idx_medallion_sets_owner ON medallion_sets (owner_user_id);

ALTER TABLE folders ADD COLUMN owner_kind TEXT NOT NULL DEFAULT 'user';

CREATE TABLE shared_drives (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE shared_drive_members (
  id TEXT PRIMARY KEY,
  drive_id TEXT NOT NULL REFERENCES shared_drives (id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  user_id TEXT,
  role TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX shared_drive_members_drive_email_idx
  ON shared_drive_members (drive_id, email);
CREATE INDEX shared_drive_members_user_idx
  ON shared_drive_members (user_id);

PRAGMA foreign_keys = ON;
