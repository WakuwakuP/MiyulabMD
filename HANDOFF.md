# 作業引き継ぎメモ

最終更新: 2026-09-17。#112 まで実装済み。**実装作業は親リポジトリで直接行う**（worktree は参照のみ。ユーザー指示）。

## リポジトリ構成

- **親リポジトリ（本ファイルの場所）**: `G:\ghq\github.com\wakuwakup\MiyulabMD` — 現在 `feat/folder-entries` をチェックアウト中
- **作業中 worktree（参照のみ）**: `G:\ghq\github.com\wakuwakup\MiyulabMD\.delta\worktrees\89fzdryv85c3\MiyulabMD`
- **delta clone**: `.delta\clones\89fzdryv85c3\MiyulabMD.git`（`local` remote が親の `.git` を指す）

## ブランチ状態（親リポジトリ側・origin 未 push）

| ブランチ | 先頭 | 内容 |
|---|---|---|
| `feat/offline-pwa` | `39540e9` | オフライン/PWA 基盤一式（196 commits、origin/main 比） |
| `feat/folder-entries` | `909ccf7` | ↑に積層。フォルダ entries API + 遅延ツリー UI（#108） |
| `main` | `origin/main` | 無変更 |

`feat/folder-entries` は `feat/offline-pwa` の上に積んでいる。offline-pwa が未マージのため独立ブランチ化は不可。

## タスク台帳: GitHub Issues

このリポジトリに Issue #108〜#115 を作成済み（リサーチパック `md.miyulab.dev/n/5b449285-9e0d-442a-8209-8d2311f8a0ac` 由来）。

| Issue | 内容 | 優先度 | 状態 |
|---|---|---|---|
| #108 | フォルダ entries 一覧 API + サイドバーツリー | P0 | **実装完了**（API/MCP/UI/テスト済。close 判断は要ユーザー確認） |
| #109 | `grep_notes` + `search_notes` 強化 | P0 | **実装完了**（worker/MCP/REST/UI/テスト済。`para`/`layer`/`jd_category` フィルタは #112-114 のフィールド未存在のため後送り） |
| #110 | エディタ Tab = インデント | P0 | **実装完了**（CM/リッチ/設定UI/ヒント/テスト済） |
| #111 | wiki-link / backlinks | P1 | **実装完了**（パーサ/DB/再索引/REST/MCP/プレビュー/LinksPanel/オートコンプリート/テスト済。close 判断は要ユーザー確認） |
| #112 | フォルダ一括移動（PARA 土台） | P1 | **実装完了**（move 系 + PARA + REST/MCP/UI + テスト済。close 判断は要ユーザー確認） |
| #113 | Johnny.Decimal 採番 | P2 | **実装完了**（汎用命名規則基盤 + JD/Zettel + REST/MCP/UI + テスト済。close 判断は要ユーザー確認） |
| #114 | メダリオン層 + gold ロック | P2 | 未着手 |
| #115 | 検索 DSL / FTS・日本語 | P2-3 | 未着手（#109 の後） |

### 依存グラフ

```
#108 entries API ─→ #112 一括移動、#113 JD、オフライン prefetch の契約
#109 grep ─→ #115 DSL/FTS
#110 Tab（完全独立）
#111 wikilink ─→ #114 promote ゲート（broken link 0 条件）
```

## #108 の完了分と残り

**完了（`feat/folder-entries` = 6c03892）:**

- `GET /api/folders/:id/children` — 子フォルダ＋直下ノートを1レスポンス。folders-first・`ja` ソート・オフセット cursor（default 50 / max 200）
- `listFolderChildren`（`apps/worker/src/services/access.ts`）— `projectVisibleChildFolder` に可視性判定を共通化。link-only 子・未許可子孫を列挙しない。非オーナー応答から ancestor ID・grants・noteCount を除外
- `listFolderNotes`（`services/notes.ts`）— `canView` + 発見可能性（既知フォルダ継承ノートは列挙可、link/非公開は不可）
- MCP: `list_folder_entries` 新規、`list_notes` に `folder_id`/`recursive`/`query`
- Web: `NoteTree.tsx` フォルダ行に直下ノート数バッジ
- テスト: `services/folder-children.test.ts` 新規6件（`node:sqlite` + D1 アダプタで実 DB 検証）

**追加分（`feat/folder-entries` = 909ccf7）:**

- `NoteTree` 遅延展開ツリー — フォルダ行の chevron で `GET /api/folders/:id/children` をその場取得。ネスト再帰・空/loading/error/リトライ行・`さらに表示` ページング対応
- `lib/folder-entries.ts` — 展開状態の pure reducer（`startFolderExpansion`/`resolveFolderExpansion`/`failFolderExpansion`/`expansionRefreshLimit`）+ 単体6件
- `DriveRow` に `depth`（1.5rem 刻みインデント）と `toggle`（chevron or `"leaf"` スペーサ）スロット
- `fetchFolderChildren`（`lib/api.ts`）— `viewerId` 付きでセッション同一性検証
- `useFolderExpansions`（NoteTree 内）— requestSeq 世代ガードで遅延応答の巻き戻し防止。`notes`/`childrenFolders` 差し替え時に展開中ノードを全件再検証（`refresh`、読み込み済み幅を limit で保持）
- `CachedDriveView` は `loadChildren` を渡さない → readonly/オフライン側はトグル非表示のまま
- Playwright: `folder-tree-expansion.spec.ts` 4件（展開/畳む/ネスト/空/ページング/エラーリトライ）

**セマンティクス注意（継続）:**

- API `noteCount` は**再帰**カウント。トップレベル行のバッジは**直下**カウント（notes から算出）を維持、遅延行のバッジは API の再帰 `noteCount` をそのまま表示 — 同一 UI 内で意味が混在する点は要レビュー
- 遅延ノート行のコンテキストメニュー/スコープ表示は `notes` prop 内の `NoteSummary` を id で引いて解決。引けない場合はその行だけ readonly（メニュー非表示）

## #109 の実装内容

**Worker / MCP:**

- `services/search.ts`（新規）— `createLineMatcher`（固定文字列 default、`fixedString=false` で JS regex、case 指定可）、`globToRegExp`、`grepRows`（権限フィルタ済み行のみ走査。maxMatchesPerNote/maxNotes/scanChars/scanNotes/deadline で打ち切り `truncated` 明示）
- `services/notes.ts` — `grep`（folderId サブツリー絞り込み + not_found/bad_request）、`searchNotes`（scope=title|body|all + folderId + limit/cursor ページング + snippet）、`searchWorkspace`（title ヒット + 行ヒット合成）。`NOTE_COLUMNS` に `snapshot_updated_at` 追加
- `routes/search.ts`（新規）— `GET /api/search`（合成）、`/api/search/notes`、`/api/search/grep`。REST は camelCase、MCP は snake_case
- MCP — `grep_notes` 新規（pattern/case_sensitive/fixed_string/folder_id/glob_title/max_* /context_*）、`search_notes` に scope/folder_id/limit/cursor 追加
- テスト `services/search.test.ts` 9件（権限除外/folder サブツリー/glob/case/regex/truncate/scope/ページング/guest）

**Web:**

- `lib/api.ts` — `searchWorkspace(query, {context, signal, viewerId})`
- `lib/note-toc.ts` — `TocEntry` に `line`（1-based・frontmatter 込み行番号、grep と一致）追加 + `headingAnchorForLine`
- `components/search/SearchPalette.tsx`（新規）— Ctrl+K/ヘッダーボタンで開くパレット。タイトルヒット優先 + 行ヒット `L{n}` 表示、↑↓/Enter/クリックで `/n/:id?line=N` へ遷移、truncated 表示
- `AppShell`/`AppHeader` — グローバル Ctrl+K/Cmd+K トグル + 検索アイコンボタン
- `EditorPage` — `?line=` をパースし `focusLine` 配線。source/split は CM `scrollIntoView`+selection、preview は `headingAnchorForLine` で直前見出しへ scrollIntoView（見出し無し→先頭）。rich モードは未対応
- Playwright `search-palette.spec.ts` 2件（palette→行ジャンプ scrollY>0、Enter/Escape）
- 新規 fixture `search-palette.html/.tsx`（AppShell + HomeStub + EditorPage ルート）

## #110 の実装内容

- `lib/editor-tab.ts`（新規）— `tabKey: indent|focus`・インデント幅 `2|4|tab`・初回ヒント既読フラグの localStorage プリファレンス + `indentUnitText`/`indentTabSize` ヘルパー。単体テスト 6 件
- `MarkdownEditor.tsx` — `tabKey=indent` 時に `EditorState.tabSize` + `indentUnit` + `keymap([indentWithTab, Ctrl-m→toggleTabFocusMode])` を追加。Esc→Tab の 2 秒パススルーと Ctrl-M 永続切替は CM 内蔵機構を利用。`focus` 時はキーマップを付けずブラウザ既定のまま。`@codemirror/commands` を直接依存に追加
- `RichMarkdownEditor.tsx` — `handleDOMEvents.keydown`（PM 内蔵 keymap より先に実行される）で同等処理。list 上は sinkListItem/liftListItem（tiptap v3 list 拡張が内蔵する Tab を focus モードでも抑止）、非 list はインデント文字列挿入/行頭空白削除。Esc ウィンドウ・Ctrl-M・IME 中スキップ・readonly パススルー対応
- `pages/settings/EditorSettingsPage.tsx`（新規）+ `/settings/editor` ルート + SettingsLayout に「エディタ」グループ。Tab 動作・インデント幅の Select + 「フォーカスを外す: Esc → Tab、または Ctrl-M」説明文
- `TabIndentHint.tsx`（新規）— 編集モード初回表示の使い捨てバナー（閉じるまで `role=note` で表示、localStorage で既読管理）
- Playwright `editor-tab.spec.ts` 6 件（indent/dedent・focus 保持・Esc→Tab 脱出・Ctrl-M トグル・focus 設定・rich・設定画面）。WS モックは SyncStep1+Step2 応答で provider.synced を立てる

## #111 の実装内容

**Shared / Markdown:**

- `packages/shared/src/wikilinks.ts`（新規）— `parseWikiLinks`（`[[Title]]`/`[[Folder/Title]]`/`[[Title|Alias]]`/`[[Title#Heading]]` + `/n/{uuid}` Markdown リンク検出。fenced code・inline code をマスク除外、1-based 行番号・オフセット保持）、`parseWikiLinkInner`。単体テストあり
- `packages/markdown/src/wikilinks.ts`（新規）— `remarkWikiLinks`。`file.data.wikiLinks`（`Map<target, noteId|null>`）で解決結果を受け取り、解決済みは `/n/{id}`（+ heading フラグメント）の anchor、未解決は印付き span、マップ未供給時はリテラルのまま
- `renderMarkdownHtml` に `wikiLinks` オプション追加

**Worker:**

- `db/migrations/0010_note_links.sql` + `schema.sql` — `note_links` テーブル（source/target_text/target_id/kind/display/heading/offset/line/status/時刻）+ source/target/status 索引
- `services/links.ts`（新規）— parse→resolve→reindex→list。解決優先度: 同フォルダ title > グローバル title > alias > UUID/short ID。`canView` 外は missing 扱い（存在漏洩防止）、ambiguous/deleted も unresolved。テスト 10 件
- `services/notes.ts` — create/update/updateMeta/remove/persistMarkdownSnapshot/renameFolder/move/removeFolder に再索引フック。内部 `toSummary`/`findNoteRow`/`listAccessibleRows` を export
- `routes/notes.ts` — `GET /api/notes/:id/links`（viewer の `canView` スコープ内のみ返却）
- MCP 4 ツール — `list_note_links`/`list_backlinks`/`list_broken_links`/`resolve_wikilink`
- 既存テスト 4 件の MIGRATIONS リストに 0010 を追加

**Web:**

- `lib/note-links.ts` — `fetchNoteLinks`（`viewerId` 付き identity 検証）+ `useNoteLinks` + `wikiLinkMapFor`（`outgoing` 非配列は防御的に undefined 返却）
- `components/editor/LinksPanel.tsx` — outgoing/backlinks/broken の3セクション、解決済みは遷移リンク
- `EditorPage` — ヘッダーに「リンク」ボタン + LinksPanel 配線 + `wikiLinks` をプレビューへ。**重要**: `useNoteLinks` は `readSource === "network"` の時のみ起動（キャッシュ/オフライン読み出し中に `/links` へ出ると identity mismatch で回復フローを起こし選択状態が壊れる回帰があった）
- `lib/wikilink-complete.ts` — `[[` トリガーの CM オートコンプリート。`fetchNotes`（権限フィルタ済み）から最大20件、重複 title は folder 修飾、閉じ `]]` 自動挿入。`@codemirror/autocomplete` を直接依存に追加
- Playwright `wikilinks.spec.ts` 3 件（解決リンク描画+遷移/パネルの outgoing+backlinks/オートコンプリート挿入）

**回帰修正の経緯:** `useNoteLinks` が cached/offline 表示中に発火し `ApiIdentityError`→本人確認再実行で選択が消える（viewer-recovery ×3）+ fixture catch-all の応答形不足（network-only-preview-image）で計5件失敗 → `readSource` ゲート + fixture ヘッダ補完で解消

## #112 の実装内容

**Shared:**

- `packages/shared/src/move.ts`（新規）— `PARA_BUCKETS`（projects/areas/resources/archives 安定キー + 既定名）、`ParaBucket`/`ParaListResult`、`MOVE_MAX_ITEMS=500`、`MovePlan`/`MoveItemStatus`/`MoveItemReason`、`MoveFolderResult`/`MoveNotesResult`/`MoveFolderContentsResult`

**Worker:**

- `db/migrations/0011_para_buckets.sql` + `schema.sql` — `folders.para_bucket`（`key IS NULL OR key IN (4キー)` 制約付き）
- `services/move.ts`（新規）— `moveFolder`（循環検知 = dest が src パス配下・same_folder・conflict・dry_run・500 上限、`relocateFolderTree` に委譲）、`moveFolderContents`（直下ノート + `include_subfolders` で直下子フォルダ、per-item moved/skipped/failed + reason）、`moveNotes`（note_ids[] + destFolderId + dry_run、inaccessible は `not_found` で存在漏洩なし、canView→owner→canAdmin の順に判定）
- `services/para.ts`（新規）— `ensureParaBuckets`（para_bucket キーで冪等 materialize）/`paraList`/`paraArchiveProject`（Projects 直下のみ、`dated` で `Archives/YYYY-MM-name`、dry_run 対応、moveFolder へ委譲）
- `services/notes.ts` — `relocateFolderTree` を**D1 batch 原子化**（5 SELECT → 文収集 `relocationStatements` → `db.batch()` → links 再索引）。`renameFolderTree`/`rewriteArticleSourceFolders`/`rewriteOwnedNoteFolders` はそこへ統合して削除。`article_sources.folder_id` はフォルダ行の新旧パス写像から解決
- REST — `POST /api/folders/:id/move`・`/:id/move-contents`、`POST /api/notes/move`、`GET /api/para`（`?bucket=` で直下 children 付き）、`POST /api/para/archive`
- MCP 5 ツール — `move_folder`/`move_folder_contents`/`move_notes`/`para_list`/`para_archive_project`
- テスト `services/move.test.ts` 6 件。6 ファイルの `D1DatabaseAdapter` に `batch`（BEGIN/COMMIT/ROLLBACK）を追加

**Web:**

- `lib/dnd.ts`（新規）— `TREE_DRAG_MIME` + `TreeDragItem` encode/decode
- `DriveRow` — `dragPayload`（draggable + dataTransfer 書込）/`onDropPayload`（drop 対象 + ハイライト）スロット。ハンドラは `dndHandlers` に切り出し
- `NoteTree` — `onMove` prop で行 D&D 有効化（readonly/未指定時は無効）、`paraBuckets` prop で PARA 固定セクション（バケツ行はメインリストから除外、展開・D&D ドロップ可）、`MenuTarget` folder に `path?` 追加（遅延行は expansion.path + name で合成）
- `lib/folder-entries.ts` — `FolderExpansion.path` 追加（children 応答の `folder.path` から）
- `home-page.ts` — `handleItemMenu` に `para` 引数。Projects 配下フォルダに「完了してアーカイブ（PARA）」項目（canAdmin のみ）
- `HomePage` — `fetchPara`（sign-in 時・drive root 表示時のみセクション描画）+ `onTreeMove`（note→`moveNotes`、folder→`moveFolder`）+ `onArchiveProject`（dated:true）+ 成功時 `invalidateNotesCache`/`invalidateFolderCache` + reload + PARA 再取得
- Playwright `para-move.spec.ts` 4 件（PARA 表示/ノート D&D/バケツへのフォルダ D&D/アーカイブ項目）

**回帰修正:** HomePage が `/api/para` を毎回叩くため、ヘッダ無し catch-all の fixture が `ApiIdentityError` → 3 spec 失敗。home-metadata（2 箇所、bob 切替対応込み）と mydrive-prefetch の catch-all にセッションヘッダを追加して解消

**留意点:**

- パス書き換え自体は 1 batch で原子的だが、その後の links 再索引は batch 外（派生索引なので失敗しても整合性は保てる範囲）。moveFolderContents の複数子フォルダは子ごとに batch（全体 atomic ではない）
- `para_archive_project` の dated 名は `YYYY-MM-{name}`。Web UI は常に dated:true
- ルート直下ノートの `folderId` は `null` ではなく root フォルダ id（fixture では `"alice-root"`）— テストで嵌った

## #113 の実装内容

**方針（ユーザー承認済み・Issue #113 に記録）:** JD 専用ではなく**フォルダ単位 opt-in の命名規則スキーム基盤**として実装。`folders.scheme`（コンテナ宣言: 直下の子の命名規則）+ `scheme_id`/`scheme_title`（採番済みノード側）。scheme 無し配下は従来どおり自由命名、既存データの遡及リネーム無し、scheme 後変更は以降の新規にのみ適用。最初のスキームとして `jd`（Johnny.Decimal）と `zettel`（Zettelkasten タイムスタンプ `YYYYMMDDHHmm`）を実装。

**Shared:**

- `packages/shared/src/schemes.ts`（新規）— `NAMING_SCHEMES`/`NamingScheme`/`isNamingScheme`/`NAMING_SCHEME_LABELS`、JD パース系（`parseJdArea`/`parseJdCategory`/`parseJdId`/`formatJdArea`/`jdLevelOf`/`jdChildLevel`/`formatSchemeFolderName`、area=`10-19`…`90-99`・item=`15.22`・予約 `.00–.10`・自動採番 `.11` 開始・上限 `.99`）、`zettelStamp`/`isZettelId`/`looksLikeSchemeId`、`SchemeSuggestion`/`SchemeValidationIssue`/`SchemeValidateResult` 型
- `note.ts` — `FolderRecord`/`FolderEntryFolder`/`FolderAccess` に `scheme`/`schemeId`/`schemeTitle`（owner のみ投影）
- `mcp.ts` — `MCP_TOOLS` に 7 ツール追加

**Worker:**

- `db/migrations/0012_naming_schemes.sql` + `schema.sql` — `folders.scheme`/`scheme_id`/`scheme_title`、部分 UNIQUE `folders_owner_scheme_id_idx`（owner×scheme_id）、`id_counters(owner_id, scope, next_value)`
- `services/schemes.ts`（新規）— `setFolderScheme`（owner のみ・`null` で解除）、`suggestSchemeChild`（カウンタを消費しない次番号ヒント）、`createSchemeChild`（explicit ID 検証 or 自動採番、UNIQUE 競合時は再試行、名前は `<scheme_id> <title>`、title 省略時 `無題`）、`jdAllocateId`（`id_counters` UPSERT で単調採番・欠番は埋めない・カテゴリローカル scope）、`jdCreateIdFolder`/`jdGet`/`jdListCategory`/`jdValidateTree`（JD ルートからの再帰 + 孤立ノード検査: name_mismatch/wrong_parent/reserved/duplicate_id/id_range/area_count/category_count/invalid_scheme）、`schemeGet`（裸 ID でも `{scheme}:{id}` でも解決）
- `services/notes.ts` — `markdownForCreate` に `schemeNoteTitlePrefix` フック（フォルダの `scheme === "zettel"` なら `YYYYMMDDHHmm ` をタイトル先頭に付与。article source 併用時もプレフィックス込みタイトルで schema 適用）
- `services/access.ts` — `FolderRow` に scheme 3 列追加 + `listFolderChildren` で owner のみ scheme メタ投影（複雑度対策で `folderEntryOf`/`visibleChildFolders`/`childNoteCounts`/`noteEntryVisible` に分割）
- `routes/schemes.ts`（新規）— `GET /api/schemes`（一覧）/`/api/schemes/suggest`・`/api/schemes/resolve`・`/api/schemes/jd/allocate`・`/api/schemes/jd/validate`、`GET /api/schemes/jd/category/:categoryId`
- `routes/folders.ts` — `POST /:id/scheme`（規則設定）、`POST /` が `useScheme:true` なら `createSchemeChild` 経路（parentId 必須、`schemeId` 明示可）
- MCP 7 ツール — `set_folder_scheme`/`scheme_get`/`jd_allocate_id`/`jd_create_id_folder`/`jd_get`/`jd_list_category`/`jd_validate_tree`（要認証・owner のみ）
- テスト `services/schemes.test.ts` 13 件 + 既存 6 ファイルの MIGRATIONS に 0012 追加

**Web:**

- `lib/api.ts` — `fetchNamingSchemes`/`fetchSchemeSuggestion`/`setFolderScheme`/`resolveSchemeId` 等
- `lib/scheme-sort.ts`（新規）— `compareSchemeFolders`（JD/Zettel ID は数値比較、それ以外は `ja` localeCompare）
- `components/notes/SchemeDialog.tsx`（新規）— フォルダの命名規則を Select で設定/解除（「なし」選択可、既存名は変えない旨を説明）
- `NoteTree` — フォルダ行・遅延行とも `compareSchemeFolders` でソート、`MenuTarget.folder` に `scheme?` を伝播
- `FolderCreateModal` — `suggestion` prop で「次の番号は `15.22`」ヒント表示。空タイトルでも suggestion があれば submit 可（`useScheme` 経路で自動採番）
- `HomePage` — フォルダコンテキストメニューに「命名規則…」項目、作成モーダルに `fetchSchemeSuggestion` の結果を渡す、`useScheme:true` で作成
- `SearchPalette` — `looksLikeSchemeId`（`15.22`/`202609171230` 等）の入力で `resolveSchemeId` → フォルダへ直接遷移、解決しない場合は通常検索へフォールバック
- Playwright `naming-schemes.spec.ts` 4 件（規則設定/次番号ヒント/数値ソート/ID クイックオープン）

**留意点:**

- `jd_list_category`・`jd_get` は owner のみ（非 owner の scheme メタはレスポンスから除外維持）
- JD の3段（area→category→item）は `createSchemeChild` 内で親の `jdChildLevel` と整合チェック。非規則フォルダを JD ルート直下に混ぜても validate は numbered だけを見る
- zettel 採番は `YYYYMMDDHHmm`、分内衝突は `+1分` 繰り上げで UNIQUE を回避
- `moveFolder` で採番済みノードを規則外へ動かすと `wrong_parent` として `jd_validate_tree` が検出（移動禁止はしない）

**search/get/list への統合（後追い追加分）:**

- `Note`/`NoteSummary` に `folderSchemeId`/`folderSchemeTitle`（所属フォルダの採番 ID。`folderId` が見える閲覧者にのみ付与 — 非 owner で folderId が隠れる場合は同様に隠す）
- `folderIdForSchemeId`（`services/schemes.ts`）— owner 配下で scheme_id → フォルダ UUID を解決
- REST `GET /api/search/notes`・`/api/search/grep` に `schemeId` パラメータ（フォルダサブツリー絞り込み、未解決は 404）
- MCP `list_notes`/`search_notes`/`grep_notes` に `scheme_id` パラメータ（`folder_id` と排他）— エージェントが `scheme_get` で UUID を引かずに `15.22` 直接指定で絞り込める

## 検証コマンドと最新結果

```sh
pnpm --filter @miyulabmd/web typecheck      # web（tsc × 2）
pnpm --filter @miyulabmd/worker typecheck   # worker
pnpm -r typecheck                           # 全ワークスペース
pnpm --filter @miyulabmd/worker test        # node:test。122/122 ✓（+15 schemes）
pnpm --filter @miyulabmd/web test           # node:test。129/129 ✓
pnpm --filter @miyulabmd/markdown test      # node:test。26/26 ✓
pnpm --filter @miyulabmd/shared test        # wikilinks パーサテスト等
cd apps/web && node scripts/playwright.mjs test  # ブラウザ全量 280/280 ✓（+4 naming-schemes）
```

注意: `vitest` は存在しない。テストは Node 組み込みランナー。Playwright は `apps/web/scripts/playwright.mjs` 経由。

## オフライン基盤の重要な不変条件（再掲）

`apps/web/src/lib/offline-cache.ts` が権威。いじるときは以下を壊さない:

- `applyFolderOperation` の `check` は orderingToken 鮮度チェックを**早期 return より前**に行う。ただし投げるのは「denied マーカーの世代が token より新しい時のみ」（`clear`/`putFolder` の世代進行では投げない — 投げると正常再検証が壊れる。回帰として6件の失敗が出た経緯あり）
- `readVisibleNoteList` で拒否フォルダ内ノートを隠すのは `note.access?.inherit !== false` の場合のみ。`access.inherit === false` の独立ノートは残す（access 無しレコードは fail-closed で除外側）
- 上記は `470e1d5` で一度壊れて `39540e9` で修正済み。対応 spec: `offline-epoch-terminal` / `folder-denial-http` / `mounted-folder-denial`

## 方針メモ

- オフライン対応は**後回し**決定済み。再開時は本文層を Yjs レプリカ（既存 IDB へ update 保存）に載せ替える案を検討。それまで OPFS 本文層に新規投資しない
- 推奨順序: #108 完結 → #109 → #110（隙間で）→ #111 → #112 → #113/#114 → #115 → オフライン再開（prefetch → 編集/Yjs）
- 未 push の積層ブランチが伸びている。区切りで origin への push / PR 化を検討すること
