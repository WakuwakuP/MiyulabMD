CREATE TABLE folders (
  owner_id TEXT NOT NULL,
  folder TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, folder)
);

INSERT OR IGNORE INTO folders (owner_id, folder, created_at)
SELECT owner_id, folder, updated_at FROM folder_policies WHERE folder != '';

INSERT OR IGNORE INTO folders (owner_id, folder, created_at)
SELECT owner_id, folder, created_at FROM notes WHERE folder != '';
