-- 編集イベント（誰がどこをどう変えたか）とリビジョンメタ（復元の単位）。
-- 本文は R2（notes/{noteId}/revisions/{id}.md）。相互参照は後から埋めるため FK にしない。

CREATE TABLE note_edit_events (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
  revision_id TEXT,
  actor_kind TEXT NOT NULL,
  actor_user_id TEXT,
  actor_name TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  op TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE note_revisions (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
  event_id TEXT,
  r2_key TEXT NOT NULL UNIQUE,
  byte_size INTEGER NOT NULL,
  actor_kind TEXT NOT NULL,
  actor_user_id TEXT,
  actor_name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX note_edit_events_note_created_idx ON note_edit_events (note_id, created_at);
CREATE INDEX note_revisions_note_created_idx ON note_revisions (note_id, created_at);
