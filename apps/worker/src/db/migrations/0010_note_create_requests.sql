CREATE TABLE note_create_requests (
  owner_id TEXT NOT NULL,
  client_draft_id TEXT NOT NULL,
  note_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER,
  PRIMARY KEY (owner_id, client_draft_id)
);

CREATE INDEX note_create_requests_note_id_idx ON note_create_requests (note_id);
