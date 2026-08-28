ALTER TABLE notes ADD COLUMN folder TEXT NOT NULL DEFAULT '';
CREATE INDEX notes_owner_folder_idx ON notes (owner_id, folder);
