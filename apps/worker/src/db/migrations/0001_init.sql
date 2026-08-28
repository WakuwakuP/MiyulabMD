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
  permission TEXT NOT NULL,
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
CREATE INDEX notes_updated_at_idx ON notes (updated_at);
CREATE INDEX images_note_id_idx ON images (note_id);
CREATE INDEX api_tokens_user_id_idx ON api_tokens (user_id);
