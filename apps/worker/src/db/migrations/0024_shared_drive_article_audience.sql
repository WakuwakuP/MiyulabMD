-- 共有ドライブの記事ソースは、マイドライブの self / editors とは別の実行範囲を持つ。
UPDATE article_sources
SET update_audience = CASE update_audience
  WHEN 'editors' THEN 'managers_or_editors'
  WHEN 'self' THEN 'managers'
  ELSE update_audience
END
WHERE owner_id IN (SELECT id FROM shared_drives);
