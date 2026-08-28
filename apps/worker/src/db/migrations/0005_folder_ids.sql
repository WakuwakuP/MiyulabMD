CREATE TABLE folders_new (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  folder TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX folders_owner_folder_idx ON folders_new (owner_id, folder);

INSERT INTO folders_new (id, owner_id, folder, created_at)
SELECT lower(hex(randomblob(16))), owner_id, folder, created_at FROM folders;

DROP TABLE folders;
ALTER TABLE folders_new RENAME TO folders;
