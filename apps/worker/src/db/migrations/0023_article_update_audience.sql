ALTER TABLE article_sources
  ADD COLUMN update_audience TEXT NOT NULL DEFAULT 'self';

UPDATE article_sources
SET update_audience = 'editors'
WHERE owner_id IN (SELECT id FROM shared_drives);
