# オフライン共通契約

本書は MiyulabMD のオフライン機能の**正本**である。実装は Issue #93〜#97 で段階的に行う。型・通信結果・保存先・失効規則はここを参照し、他ファイルへ重複定義しない。

## 1. 目的と 3 状態

オフライン対応の目的は、オンラインで取得したデータを同一アカウントの View に復元し、通信断や認証確認失敗を誤って「未作成」「別ユーザー」と解釈しないことである。

| 状態 | 説明 | 本文の正本 |
| --- | --- | --- |
| **既存 View** | サーバー上に存在するノートを閲覧・（権限があれば）編集 | サーバー + Yjs session |
| **一時切断編集** | オンライン編集中に通信が切れた。既存 session の Yjs / y-indexeddb が保持 | Yjs + y-indexeddb（#95） |
| **local 下書き** | オフラインまたは未同期の新規/複製下書き。サーバー ID がない、または `local-*` | drafts store（#96） |

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
- **`EditorDrain`**: 表示 editor から最新確定 Markdown を読む bridge。**型のみ**（#93 スライス A）。実装は #95/#96。

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
| 既存編集 session | y-indexeddb（別 DB） | #95 | オンライン開始済み Yjs の一時切断 |
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

drafts / journal store は #96/#97 で同一 upgrade に追加する。

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
- フォルダ削除成功時は Worker が `{ deletedNoteIds, deletedFolderIds }` を返す（次スライス）。

## 9. logout coordinator

`offline-session.ts` に coordinator を一つ置く（#93）。AccountMenu の logout は `beginLogout()` 経由で世代更新・cache 失効後 `/auth/logout` GET へ遷移。#95 が `registerPersistenceCleanup` で cleanup hook を登録。他タブ block 時も認証終了を無期限に待たせず `pendingCleanup` を記録。

## 10. EditorDrain の利用順

1. 通常遷移: `awaitIdle()` → `drainSync()` → 利用側の commit 待ち
2. `pagehide` 等: 同期 `drainSync()` 後に保存開始
3. 終了イベントの非同期完了に無損失を依存しない

bridge 実装は MarkdownEditor / RichMarkdownEditor（#95/#96）。

## 11. 実装済み（#93 スライス C）

- **`CachedNote` / `CachedSummary` / `CachedFolder`**: `offline-cache-types.ts`。`access.grants`・共有先メール・認証情報は保存しない。権限フラグは表示専用。
- **IDB persist / hydrate**: `offline-cache.ts` + `note-cache.ts` / `list-cache.ts`。`SessionEpoch` 一致時のみ書込。
- **`loadNotes` 状態**: `getNotesLoadState()` — `unhydrated` / `hydrating` / `ready` / `error`。
- **`loadNote` 詳細**: `loadNoteRecord()` / `getLoadedNoteMeta()` — `source` / `cachedAt` / `verifiedForSession`（強制 GET 成功時のみ `true`）。
- **prefetch**: 一覧取得後、本文未保存を更新順最大 20 件・並列 2。
- **`evictNotesEverywhere`**: メモリ + IDB + bootstrap + `#95` hook（draft は保持）。
- **Home**: 未取得 / 空 / エラーを `homeListFlags` と `NoteTree` で区別。

## 12. 未実装（後続スライス）

| 項目 | Issue |
| --- | --- |
| EditorDrain bridge | #95/#96 |
| Service Worker / PWA シェル | #92 |

## 参照

- [design.md §8](./design.md#8-リアルタイム同期yjs) — Yjs / y-indexeddb と local draft の分担
- [design.md §16](./design.md#16-実装フェーズ) — フェーズ 5
- Issue #91（全体方針）、#93（本 Issue）
