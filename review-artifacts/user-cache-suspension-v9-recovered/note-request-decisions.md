# D101：ノート本文 GET の request-sharing 候補

- **状態**：候補実装中。ライブソースには反映しない。
- **対象**：同一ページ内で、同じ authenticated viewer scope と note ID を持つ
  進行中の本文 GET。
- **選択**：`src/lib/note-request.ts` の viewer ごとの note map で進行中の
  `requestJson<Note>` だけを共有する。`viewerId` は送信せず、HTTP の認証や
  URL の一部にも使わない。
- **理由**：単なる Promise 共有では subscriber の中断が結合し、global response
  cache では viewer 分離と読み取り寿命を壊すため。各 subscriber は独立した
  AbortSignal と成功値の deep copy を持ち、保存・拒否・公開は既存の session／
  prefetch の寿命に残す。
- **未指定 scope**：`viewerId` が undefined または空文字なら従来どおり独立した
  transport request とする。cached viewer の cache ID から scope を推定しない。
- **対象外**：異なる viewer／note、alias 推定、folder/list、legacy hover、
  cross-tab、settled response cache、保存処理の重複統合。
- **中断規則**：一人の中断は他の subscriber に伝播しない。全員が中断した場合
  のみ underlying request を abort し、entry を直ちに削除する。settle 後は entry
  を保持せず、古い cleanup は後続の同じ key を削除しない。
