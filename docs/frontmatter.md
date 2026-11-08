# YAML frontmatter と記事の検証

一般ノートの YAML frontmatter は任意で、必須キーはない。未知キー・入れ子・コメントを含む Markdown 原文を保存し、再読込や MCP `get_note` でも保持する。`readArticleFrontmatter` は名前にかかわらず汎用の安全な読み取りで、記事 schema の検証はしない。新しいパーサやメタデータ形式は追加しない。

閉じた frontmatter が不正 YAML の場合も、閉じ区切りの後を本文として表示する。閉じ区切りがなければ Markdown 全体を本文として扱う。いずれも原文を自動修復・削除せず、読み取り時に問題を返す。`article_meta` は YAML がない・不正な場合の既存フォールバックで、スナップショット保存時には同期しない。

## 記事ソース配下

既存の `ArticleSchemaField` と `validateArticleDocument` を使う。エディタは一致する記事ソースがある場合だけ必須・型・enum・fixed の問題を警告する。default や fixed による値の補完は従来の規則を維持する。新規記事は `ensureArticleMarkdown` で同じ schema のテンプレートを付与する。

| 操作 | 不正な frontmatter の扱い |
| --- | --- |
| 通常保存・Yjs スナップショット | 保存を拒否しない。共同編集中の一時的な不正を許容する |
| エディタ | 記事ソース配下のみ警告する |
| サイト更新 `POST /api/article-sources/:id/dispatch` | 保存済み記事を検証し、不備があれば HTTP 422 で拒否する |
| 記事 API 一覧・本文 | 従来どおり取得できる。必須欠落を理由に拒否しない |

サイト更新は、そのソースの所有者・共有ドライブに属するソース直下と全子孫のノートを、記事 API と同じ範囲・schema で検証する。下書きも対象に含む。100 件ずつ走査し、最初に不備が見つかった時点で Webhook 送信を中止し、更新日時・最終送信日時は変更しない。閲覧可能なノートは名前・パス・問題をエラーに含め、既存のサイト更新 UI に表示する。閲覧できないノートの詳細は返さない。修正して保存完了を待ち、再度サイト更新する。

検証対象は D1 に保存済みの Markdown であり、未同期の Yjs 編集や検証後の共同編集を固定する公開スナップショットではない。空のソースは更新できる。Webhook 未設定・権限不足・送信失敗の扱いは従来どおり。

Astro 向け記事 API の `entry.markdown` は従来どおり frontmatter を除いた本文で、`data` は schema による公開メタデータの投影となる。ここに未知キーが含まれなくても、保存済み Markdown やノート API・MCP の原文からは削除しない。

## 回帰確認

```sh
node --experimental-strip-types --test packages/shared/src/frontmatter.test.ts apps/worker/src/services/articles.test.ts apps/worker/src/services/persist-snapshot.test.ts
```

通常ノートの原文保持、壊れた YAML と閉じ忘れ、記事テンプレート、必須・型・fixed 検証、ページをまたぐ検証、所有者・フォルダ・閲覧権限の境界、Webhook の副作用、記事 API の互換性を確認する。MCP テストは実際の読み取りハンドラを通し、DocumentRoom の読み取りだけ保存済みスナップショットで代替する。

手動では一般ノートと記事ノートに同じ任意 YAML を保存して再読込し、記事ノートだけ警告されることを確認する。不正な記事でサイト更新するとエラーが表示され、修正・保存後に更新できることを確認する。
