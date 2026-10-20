ALTER TABLE article_sources
  ADD COLUMN update_audience TEXT NOT NULL DEFAULT 'self';
