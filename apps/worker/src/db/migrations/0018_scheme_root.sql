-- Per-directory numbering scopes. scheme_id used to be unique per owner, so
-- the whole drive behaved as a single JD/Zettel system. scheme_root points
-- each minted node at the folder that declares the rule (scheme set, scheme_id
-- NULL); numbering counters and ID uniqueness are scoped to that directory.

ALTER TABLE folders ADD COLUMN scheme_root TEXT;

-- Backfill: the scope root is the nearest ancestor (walking parent paths) that
-- declares a scheme and carries no scheme_id. rtrim(...) strips the last path
-- segment; a path without '/' collapses to '' (the drive root row).
WITH RECURSIVE anc(node_id, owner_id, path) AS (
  SELECT id,
         owner_id,
         rtrim(rtrim(folder, replace(folder, '/', '')), '/')
  FROM folders
  WHERE scheme_id IS NOT NULL
  UNION ALL
  SELECT anc.node_id,
         anc.owner_id,
         rtrim(rtrim(anc.path, replace(anc.path, '/', '')), '/')
  FROM anc
  WHERE anc.path <> ''
)
UPDATE folders
SET scheme_root = (
  SELECT p.id
  FROM anc
  JOIN folders AS p
    ON p.owner_id = anc.owner_id
   AND p.folder = anc.path
   AND p.scheme IS NOT NULL
   AND p.scheme_id IS NULL
  WHERE anc.node_id = folders.id
  ORDER BY length(anc.path) DESC
  LIMIT 1
)
WHERE scheme_id IS NOT NULL;

DROP INDEX IF EXISTS folders_owner_scheme_id_idx;
CREATE UNIQUE INDEX folders_owner_scheme_id_idx
  ON folders (owner_id, scheme_root, scheme_id)
  WHERE scheme_id IS NOT NULL;
