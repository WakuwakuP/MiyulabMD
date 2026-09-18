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

-- Counter scopes: `jd:area`, `jd:cat:NN`, `jd:id:NN` were owner-global. They
-- cannot be reused per root (empty roots would inherit the high-water mark and
-- skip IDs), so derive each scoped counter from the folders actually minted
-- under that root: next_value = max existing sibling number + 1. The allocator
-- clamps to its own startAt, so a lower derived value is safe.
DELETE FROM id_counters
 WHERE scope = 'jd:area'
    OR scope GLOB 'jd:cat:[0-9][0-9]'
    OR scope GLOB 'jd:id:[0-9][0-9]';

INSERT OR IGNORE INTO id_counters (owner_id, scope, next_value)
SELECT f.owner_id,
       'jd:area:' || f.scheme_root,
       MAX(CAST(substr(f.scheme_id, 1, 2) AS INTEGER)) / 10 + 1
  FROM folders AS f
 WHERE f.scheme_root IS NOT NULL
   AND f.scheme_id GLOB '[0-9][0-9]-[0-9][0-9]'
 GROUP BY f.owner_id, f.scheme_root;

INSERT OR IGNORE INTO id_counters (owner_id, scope, next_value)
SELECT f.owner_id,
       'jd:cat:' || f.scheme_root || ':' ||
         CAST(CAST(f.scheme_id AS INTEGER) / 10 * 10 AS TEXT),
       MAX(CAST(f.scheme_id AS INTEGER)) + 1
  FROM folders AS f
 WHERE f.scheme_root IS NOT NULL
   AND f.scheme_id GLOB '[0-9][0-9]'
 GROUP BY f.owner_id, f.scheme_root, CAST(f.scheme_id AS INTEGER) / 10;

INSERT OR IGNORE INTO id_counters (owner_id, scope, next_value)
SELECT f.owner_id,
       'jd:id:' || f.scheme_root || ':' || substr(f.scheme_id, 1, 2),
       MAX(CAST(substr(f.scheme_id, 4, 2) AS INTEGER)) + 1
  FROM folders AS f
 WHERE f.scheme_root IS NOT NULL
   AND f.scheme_id GLOB '[0-9][0-9].[0-9][0-9]'
 GROUP BY f.owner_id, f.scheme_root, substr(f.scheme_id, 1, 2);
