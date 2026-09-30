-- Deliberately no foreign key to folders: this is the recovery record for a
-- physically deleted empty folder. Keep counters and all metadata snapshots.
CREATE TABLE folder_delete_events (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  path TEXT NOT NULL,
  parent_path TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user', 'agent')),
  actor_user_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  deleted_at INTEGER NOT NULL,
  snapshot TEXT NOT NULL
);
CREATE INDEX folder_delete_events_owner_folder_idx
  ON folder_delete_events (owner_id, folder_id, deleted_at);
