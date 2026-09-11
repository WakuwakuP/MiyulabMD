# オフライン共通契約

本書は MiyulabMD のオフライン機能の**正本**である。実装は Issue #93〜#97 で段階的に行う。型・通信結果・保存先・失効規則はここを参照し、他ファイルへ重複定義しない。

## 1. 目的と 3 状態

オフライン対応の目的は、オンラインで取得したデータを同一アカウントの View に復元し、通信断や認証確認失敗を誤って「未作成」「別ユーザー」と解釈しないことである。

| 状態 | 説明 | 本文の正本 |
| --- | --- | --- |
| **既存 View** | サーバー上に存在するノートを閲覧・（権限があれば）編集 | サーバー + Yjs session |
| **一時切断編集** | オンライン編集中に通信が切れた。既存 session の Yjs / y-indexeddb が保持 | Yjs + y-indexeddb（#95） |
| **local 下書き** | オフラインまたは未同期の新規下書き。サーバー ID がない、または `local-*` | drafts store（#96） |

local 本文を複数の正本（Yjs・drafts・メモリ cache）に持たない。種別ごとに保存先を分ける。

## 2. 共通型

定義: `apps/web/src/lib/offline-types.ts`

```ts
type AccountScope = `user:${string}` | 'guest';
type Epoch<Tag extends string> = number & { readonly __epoch: Tag };
type SessionEpoch = Epoch<'session'>;
type RequestGeneration = Epoch<'request'>;
type LockEpoch = Epoch<'lock'>;

type EditorDrain = {
  readDraft(): string;
  drainSync(): { pendingComposition: boolean };
  awaitIdle(): Promise<void>;
};
```

- **`AccountScope`**: 閲覧者（キャッシュ partition）の区分。**サーバーノートの `ownerId` とは別**。draft の `ownerId` は実ユーザー ID のまま保持し、境界で `accountScopeFromOwnerId` により `user:${ownerId}` に変換する。
- **`SessionEpoch`**: アカウント / 認証状態の世代。
- **`RequestGeneration`**: ノート読込・session 生成の世代。
- **`LockEpoch`**: draft 編集 / 同期 lease 所有の世代。
- **`EditorDrain`**: 表示 editor から最新確定 Markdown を読む bridge。`editor-drain.ts` registry と MarkdownEditor / RichMarkdownEditor 登録（#93 D）。#95/#96 が persist から利用。

ヘルパ: `GUEST_SCOPE`, `accountScopeFromUserId`, `accountScopeFromOwnerId`, `nextSessionEpoch`, `nextRequestGeneration`, `nextLockEpoch`。

## 3. 通信結果

定義: `apps/web/src/lib/api.ts` の `ApiResult` / `apiRequest`。

| kind | status | 意味 |
| --- | --- | --- |
| `network` | 0 | 有効な HTTP 応答を得られなかった（fetch 例外、本文読込失敗）。物理オフラインや「未作成」の証明ではない |
| `aborted` | 0 | 意図的 Abort。通信断に変換しない |
| `http` | 実 status | HTTP エラー応答（401, 403, 5xx 等） |
| `invalid-response` | 実 status | 2xx だが JSON 必須 endpoint で非 JSON・構文/schema 不正・空 body。Access ログインページ HTML（302→200）もこれ |

`status: 0` は **network / aborted のみ**。401 や HTML 2xx を guest や別 user に捏造しない。

成功形式は endpoint ごとに `json | empty | raw` を指定する。DELETE の 204 や画像 upload は JSON 必須にしない。

`navigator.onLine` は `online-status.ts` の単一購読値から読み、再試行ヒントにのみ使う。session 状態機械は #93（`offline-session.ts`）。

### 主要 endpoint

- **`fetchMe`**: 成功 = 200 + `{ user: SessionUser | null }`。`{ user: null }` は確認済み guest。401 / 5xx / network / invalid-response は `ApiFailure`。
- **`fetchNotes`**: `ApiResult<NoteSummary[]>`。throw しない。
- **`fetchAuthConfig`**: 失敗を `{ access:false, mock:true }` に潰さない。呼び出し側が明示 fallback する。

## 4. 保存先の分担

| 層 | 技術 | 担当 Issue | 内容 |
| --- | --- | --- | --- |
| アプリシェル | Cache Storage | #92 | HTML / JS / CSS シェル |
| 取得済みデータ | IndexedDB `miyulabmd-offline` | #93 以降 | notes / lists / session |
| 既存編集 session | y-indexeddb（別 DB） | #95 A | オンライン開始済み Yjs の一時切断 |
| local 本文 | drafts store（同一 offline DB） | #96 | `local-*` 下書き |
| メモリ | note-cache / list-cache | #93 以降 | hydrate 前の高速 path |

PWA シェルとデータ cache は分離する。詳細は [design.md §8](./design.md#8-リアルタイム同期yjs)。

## 5. IndexedDB ストア

DB 名: `miyulabmd-offline`。`openDb(): Promise<IDBDatabase | null>` を `offline-db.ts` に集約（#93）。

| ストア | キー | 内容 |
| --- | --- | --- |
| `notes` | `[AccountScope, id]` | 本文・タイトル・表示 metadata・保存日時 |
| `lists` | `[AccountScope, kind, key]` | 一覧 summary、フォルダ子一覧。ルートキー `__root__` |
| `session` | 単一レコード（キー `current`） | active scope、最後の確認済み user、確認時刻、`offlineReadable`、`SessionEpoch` |

インデックス: `[AccountScope, shortId]` unique。`shortId` が optional なレコードは index 外。`local-*` ID は notes / lists に入れない（`isPersistableRemoteId`）。

| `drafts` | `[ownerId, localId]` | local 下書き本文・フォルダ metadata・revision |
| `draft-locks` | `[ownerId, localId]` | 非 `navigator.locks` 環境向け編集 lease |
| `draft-tombstones` | `[ownerId, localId]` | 削除後の復活拒否 |

journal store は #97 で同一 upgrade に追加する。

## 6. キャッシュ型と allowlist

`CachedNote` / `CachedSummary` / `CachedFolder` はサーバー応答型と区別し、表示に必要な項目だけ allowlist で保存する。

- **`access.grants`、共有先メール、認証情報は保存しない**（全経路）。
- 保存済み cache の権限情報で Edit / Admin を認可しない。操作時は GET / WS で再確認。
- **`verifiedForSession`**: 現 `SessionEpoch` の強制 GET 成功時のみ `true`。永続化 hit や memory hit では `false`。

## 7. セッション確認結果

| 結果 | 表示・送信・保存 |
| --- | --- |
| 初期 `unknown` | 旧私有 cache / draft を先行表示しない。送信待ち |
| 同じ non-null user 確認 | `online-confirmed`。認可は GET/WS で別途 |
| network / 5xx + 有効な過去 scope | `offline-known`。同 scope の保存 View と本人 draft のみ。新規リモート操作 / flush 停止 |
| `invalid-response` | `verification-error`。旧私有本文・draft 非表示。再試行案内。データ保持 |
| 401 | `unauthenticated`。旧 user 表示 / 送信停止。`offlineReadable=false` |
| 200 `{ user: null }` | 確認済み guest。旧 user 表示 / 送信停止。guest scope へ。旧 user データは保持 |
| 確定した別 non-null user / 明示 logout | 世代更新後、旧 scope の notes/lists と #95 Yjs を消去。draft は再認証まで非表示で保持 |

wipe は「確定した別 non-null user / 明示 logout」に限る。guest で取得した公開本文は `offline-known('guest')` なら View 可。

## 8. 失効

- **`invalidate*`**（note / list / folder cache）: メモリ無効化のみ。
- **`evictNotesEverywhere(ids, reason)`**: 正規 ID / shortId、本文・summary・フォルダ子一覧、inflight、bootstrap、表示 state を失効。#95 の y-indexeddb adapter へ hook 登録。**draft は消さない**。
- フォルダ削除成功時は Worker が `DELETE /api/folders/:id` で **200 JSON** `{ deletedNoteIds, deletedFolderIds }` を返す。クライアントは `evictNotesEverywhere(deletedNoteIds)` と対象フォルダ cache 失効。

## 9. logout coordinator

`offline-session.ts` に coordinator を一つ置く（#93）。AccountMenu の logout は `beginLogout()` 経由で世代更新・cache 失効後 `/auth/logout` GET へ遷移。#95 が `registerPersistenceCleanup` で cleanup hook を登録。他タブ block 時も認証終了を無期限に待たせず `pendingCleanup` を記録。

## 10. EditorDrain の利用順

1. 通常遷移: `awaitIdle()` → `drainSync()` → 利用側の commit 待ち
2. `pagehide` 等: 同期 `drainSync()` 後に保存開始
3. 終了イベントの非同期完了に無損失を依存しない

bridge 登録は MarkdownEditor / RichMarkdownEditor（#93 D）。persist からの利用は #95/#96。

## 11. 実装済み（#93）

- **`CachedNote` / `CachedSummary` / `CachedFolder`**: `offline-cache-types.ts`。`access.grants`・共有先メール・認証情報は保存しない。権限フラグは表示専用。
- **IDB persist / hydrate**: `offline-cache.ts` + `note-cache.ts` / `list-cache.ts`。`SessionEpoch` 一致時のみ書込。一覧 persist は `local-*` を除外。
- **`loadNotes` 状態**: `getNotesLoadState()` — `unhydrated` / `hydrating` / `ready` / `error`。
- **`loadNote` 詳細**: `loadNoteRecord()` / `getLoadedNoteMeta()` — `source` / `cachedAt` / `verifiedForSession`（強制 GET 成功時のみ `true`）。
- **prefetch**: 一覧取得後、本文未保存を更新順最大 20 件・並列 2。`network` 失敗時は残り prefetch を abort。
- **`evictNotesEverywhere`**: メモリ + IDB + bootstrap + `#95 A` Yjs hook（draft は保持）。
- **Home**: 未取得 / 空 / エラーを `homeListFlags` と `NoteTree` で区別。
- **`EditorDrain` registry**: `editor-drain.ts` + Source/Rich editor 登録。
- **フォルダ削除 ID 返却**: Worker 200 JSON + クライアント cache 失効。

## 12. Yjs persistence（#95 A）

実装: `apps/web/src/lib/collaboration-persistence.ts`。EditorPage / `createYjsSession` への接続と session controller は **スライス B（#95 B）**。

### 保存単位

- **ノート DB**: `miyulabmd-yjs-v1:<encoded AccountScope>:<canonical noteId>`（GET UUID のみ。shortId で別 DB を作らない）
- **カタログ DB**: `miyulabmd-yjs-catalog-v1` — 開く前に `{ scope, noteId, dbName, generation, pendingDelete }` を登録。未表示ノートも列挙・削除可能

### API

| 関数 | 役割 |
| --- | --- |
| `openNotePersistence({ scope, noteId, doc, generation })` | カタログ登録 → shadow doc で IDB 読込 → 世代一致時のみ live doc へ適用。失敗は `null` |
| `NotePersistence.whenSynced` | IDB から doc への読込完了（remote 同期・commit ではない） |
| `NotePersistence.checkpoint()` | `Y.encodeStateAsUpdate` を updates に追加。tx complete でのみ成功。無変更は追加しない |
| `NotePersistence.destroy()` | 接続を閉じるだけ（内容は消さない） |
| `clearDocument(dbName)` / `deleteNotePersistence` / `deleteScopePersistence` | 世代無効化 → pendingDelete → deleteDatabase 待ち → カタログ除去 |
| `listCatalog()` / `retryPendingDeletes()` | 列挙と blocked 後の再試行 |
| `installYjsPersistenceCleanup()` | `offline-session` coordinator へ hook 登録（AppShell で一度） |

### チェックポイントと compaction

通常の編集更新は y-indexeddb に任せる。`checkpoint()` だけ adapter が updates に直接書き、custom store に件数・byte・state vector を記録。独自 checkpoint が 64 件または 4MiB を超えたら、同一 readwrite tx 内で対象キーを merge → 1 件追加 → 読んだキーのみ delete。

y-indexeddb 9.0.12 の内部 schema（`updates` / `custom`）依存は adapter に閉じる。`_dbsize` による自動 trim は checkpoint 追加分には当てない。

### 失効

`installYjsPersistenceCleanup()` 経由で `evictNotesEverywhere` / logout / 別 user 確定時に scope または note 単位で削除。draft store（#96）には触れない。`versionchange` で接続を閉じ、delete が blocked なら `pendingDelete` を残して次回 open / `retryPendingDeletes` で再試行。

## 13. Yjs session controller（#95 B）

実装: `apps/web/src/lib/collaboration-session.ts`。`collaboration-persistence.ts`（#95 A）が y-indexeddb の読込・checkpoint・失効を担当し、controller が **いつ WS に繋ぐか・切断表示・再試行・page lifecycle** を担当する。

### 識別子

```ts
{ scope: AccountScope; noteId: string /* GET UUID */; sessionEpoch: SessionEpoch; generation: RequestGeneration }
```

`shortId` から別 session / DB を作らない。GET 成功の `note.id` を正本とする。

### 状態（controller 内部）

| フィールド | 意味 |
| --- | --- |
| `needsSession` | 検証済み Edit 要求または継続中の編集 session。Y.Doc 寿命 |
| `desiredConnection` | 今ネットワークへ繋ぐ意図。hidden / leave では false でも doc を保持 |
| `everSynced` / `collabReady` | 初回 remote `sync(true)` 完了後に true。それまでは editor 入力不可 |
| `phase` | `initializing` → `connecting` → `syncing` → `synced`、切断時 `disconnected`、意図離脱 `suspended` 等 |
| `disconnectedAt` / `longDisconnect` | 初回切断時刻（再試行でリセットしない）。60s 超で追加バナー |
| `checkpointFailed` | 端末保存失敗（別表示。黙って close しない） |

preview 表示や `navigator.onLine` だけでは doc を破棄しない。`needsSession === false` のときだけ `close()`（`awaitIdle` → `drainSync` → `checkpoint` 待ち）。

### 接続手順（controller）

1. 同 scope の session と GET `canEdit` を確認（guest は `/api/me {user:null}` + ノート権限）
2. `createYjsSession` は `connect: false`, `disableBc: true`, `shouldReconnect: () => false`
3. `openNotePersistence` → `whenSynced` 後に `provider.connect()`
4. REST 本文を空 doc に insert しない
5. provider 自動再接続は使わず、controller の指数バックオフ（1/2/4…秒、上限 30s + jitter）を一本化
6. 各 connect 前に `verifySession` + GET 権限
7. `network` / 5xx: doc 保持。401 / `invalid-response`: 再送と旧私有表示停止（wipe しない）。403/404: `deleteNotePersistence`

### Editor 配線

- `editor-page.ts` の `bindEditorCollab`: `needsSession` / `desiredConnection` を受け取り `createNoteCollabSession` を生成
- 現行 source / split / rich: 両方 `true`。preview のみでは **即 teardown しない**（#94 が preparing-edit 中に preview のまま接続するため）
- `page-lifecycle` は controller 内の `createSessionLifecycle` に統合（二重 leave / reconnect なし）
- `EditorPage.tsx`: `collabBannerMessage(snapshot)` で小さなバナー。`aria-live="polite"` はメッセージ変更時のみ

### #94 が使う API

| 関数 / 型 | 用途 |
| --- | --- |
| `createNoteCollabSession({ noteId, user, generation })` | session 生成 |
| `NoteCollabSession.setNeedsSession` / `setDesiredConnection` | View 状態機械から doc 寿命と WS 意図を制御 |
| `NoteCollabSession.getSnapshot` / `subscribe` | `CollabSessionSnapshot`（phase / everSynced / banner 素材） |
| `collabBannerMessage(snapshot)` | 切断・長時間切断・checkpoint 失敗の文言 |
| `NoteCollabSession.close()` | Edit 取消・ノート遷移時の drain + checkpoint + teardown |
| `NoteCollabSession.retryNow()` | 明示再試行 |

## 14. 既存 View 状態機械（#94）

実装: `apps/web/src/pages/editor-page.ts`（純関数）+ `EditorPage.tsx` / `SharePage.tsx` / `home-page.ts`。

### 表示フェーズ

| フェーズ | 意味 |
| --- | --- |
| `loading` | URL 読込中。server 操作なし |
| `cached-preview` / `revalidating` | 保存済み preview。新規 Edit 不可 |
| `offline-preview` | cache 本文 View のみ。server 操作不可 |
| `server-preview` | force GET 成功。権限に応じた操作可。自動 Edit なし |
| `preparing-edit` | 検証済み preview のまま Yjs 初期同期待ち。入力不可 |
| `editing` | #95 session の Y.Text に bind |
| `uncached` / `denied` / `not-found` / `load-error` | 旧本文を残さずメッセージ |
| `local-editing` | 本人 draft。memory Y.Doc + drafts store 保存。編集 lock 取得タブのみ |
| `local-readonly` | 別タブ編集中など lock 未取得。本文表示のみ |

`loadNoteRecord` の `source` / `cachedAt` / `verifiedForSession` を meta として保持。**`verifiedForSession` が true の server GET 成功まで Edit を許可しない**（cache の `canEdit` は表示専用）。

### Edit 開始

- **`canEdit`（権限）** と **`canStartEdit`（session 確認 + force GET 成功 + 到達性）** を分離
- 流れ: `server-preview` → 明示的 Edit 要求 → `preparing-edit`（`needsSession=true`, preview 表示）→ bind 完了 → `editing`
- オフライン新規 Edit 不可。bind 済み session の継続編集は #95 が担当
- `collabSnapshot.editDenied` で preview へ戻す。`authStopped` / `denied` で本文・Edit 停止

### エラー（force GET）

| 結果 | 扱い |
| --- | --- |
| network + cache | 本文残し offline banner。server 操作不可 |
| network + miss | uncached メッセージ |
| 5xx + cache | read-only + 障害表示 |
| 401 | 旧私有を隠し login 案内 |
| 403/404 | 本文消去 + `evictNotesEverywhere` |
| invalid-response | load-error。session verification-error 時は旧私有非表示 |
| aborted / 古い世代 | 画面を変えない |

SharePage（`/s/:id`）も同一表。従来の「cache hit なら全エラー無視」は廃止。

### UI / mutation 抑制

- オフライン preview: mode 切替・履歴・共有・folder 変更・upload を非表示。folder 名・リンク・TOC は維持
- `taskNoteId` は verified Edit 可能時のみ。`offline-known` では task checkbox HTTP も停止
- Home: フォルダ作成/改名・共有/権限・リモート削除を導線と handler 両方で抑止
- オフラインでも **ログイン済み** なら local 下書きの新規作成可（`persistNewNote` → drafts store → `/n/local-*`）
- フォルダ作成/改名・共有/権限・リモート削除は引き続き offline-known で停止
- server mutation queue は設けない（local 下書きの自動 POST は #97）

### SSR 除去

`removeSsrPreview()` は **`loading` 以外の確定フェーズ**（`revalidating` / terminal 含む）で呼ぶ。空本文でも旧 SSR が残らない。SharePage も同じ。

## 15. local 下書き（#96）

実装: `draft-store.ts` / `draft-lock.ts` / `local-draft-editor.ts` / `home-page.ts` / `editor-page.ts`。

### 作成

- `online-confirmed` / `offline-known` の **non-null user** のみ。guest / `unknown` / `verification-error` / `unauthenticated` では開始しない。
- オフラインまたは `createNote` が `network(status:0)` のとき `# 無題\n` で drafts store に保存し `/n/local-{uuid}` へ遷移。HTTP 4xx/5xx / Abort では draft を増やさない。
- 同一 tick の二重作成は in-flight Promise で 1 件に合流。
- #97: オンライン復帰後の自動 POST は未実装。

### 一覧

- Home は server 一覧 cache と `listDrafts(ownerId)` を **表示時だけ** 合成。server list cache へ書き戻さない。
- draft 行は「未保存」。メニューは「開く」「削除」のみ。削除は server DELETE を呼ばず tombstone + editor 停止。

### 編集

- 表示モデル: `{ kind: 'server', note } | { kind: 'draft', draft }`。
- `local-*` は `fetchNote` / notes cache / #95 WS に送らない。memory Y.Doc / Y.Text / Awareness に一度だけ seed。
- 保存元は `getEditorDrain().readDraft()`。確定入力ごとに直列保存（revision 単調増加）。
- 編集 lock: 優先 `navigator.locks`、非対応は `draft-locks` lease。未取得タブは read-only。
- draft 編集中は共有・履歴・server フォルダ変更・画像 upload・task checkbox HTTP を停止。folder 名表示と TOC は可。

### Service Worker

- `/n/local-*` navigation は server endpoint の次・通常 app navigation より前に分類し、**即 precache `/index.html`** を返す（Worker/D1 障害でもシェル起動）。

## 16. 未実装（後続スライス）

| 項目 | Issue |
| --- | --- |
| 復帰同期（journal / 自動 re-POST / ID 昇格 / server DELETE） | #97 |

## 参照

- [design.md §8](./design.md#8-リアルタイム同期yjs) — Yjs / y-indexeddb と local draft の分担
- [design.md §16](./design.md#16-実装フェーズ) — フェーズ 5
- Issue #91（全体方針）、#93（本 Issue）
