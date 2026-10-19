CREATE TABLE shared_drive_domains (
  id TEXT PRIMARY KEY,
  drive_id TEXT NOT NULL REFERENCES shared_drives (id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX shared_drive_domains_drive_domain_idx
  ON shared_drive_domains (drive_id, domain);

CREATE TABLE shared_drive_domain_exclusions (
  drive_id TEXT NOT NULL REFERENCES shared_drives (id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  PRIMARY KEY (drive_id, email)
);
