# Miyulab ブランド整理

公式のブランド定義は公開されていない。GitHub・公式サイト・ブログ・関連プロダクトから読み取った事実と、アイコン制作に使う暫定トークン。

## 出典

| 出典 | URL | 読み取ったこと |
| --- | --- | --- |
| 公式サイト | https://www.miyulab.dev/ | 表記はヘッダーで `MiyuLab`、フッターで `Miyulab (WakuwakuP)`。本文色 `#464646`、背景白。アクセントは CSS 変数のマゼンタ（`--primary-color: #fcf`、`--link-text-color: #f7f`）。フォントは M PLUS 1p。背景にパステルの円。キャラクターイラスト（cat ear / パーカー）がビジュアルの中心。カテゴリは development / hobby / review。 |
| 公式リポジトリ | https://github.com/WakuwakuP/miyulab-officialsite | 個人サイト。homepage は `miyulab.dev`。ブランドキットやロゴ定義は無し。 |
| GitHub プロフィール | https://github.com/WakuwakuP | Naoki Fujisawa / WakuwakuP。サイトは miyulab.dev。Fediverse は `@miyu@pl.waku.dev`。 |
| Fediverse 自己紹介 | https://pl.waku.dev/users/miyu | みゆ / Wakuwaku。フロントエンドエンジニア。個人ラボの主体が「みゆ」。 |
| ブログ | https://www.miyulab.dev/content/detail/* | 開発メモ・趣味・レビュー。一人の作業場としてのトーン。 |
| MiyulabMD | 本リポジトリ / https://md.miyulab.dev | 共同編集 Markdown。UI フォントは M PLUS 2（公式と同系統）。現状の UI アクセントは `#2563eb`（アプリ実装値であり、公式サイトのマゼンタとは別）。 |
| Miyulab Bot | https://bot.miyulab.dev/ | Discord 向けレイド日程ボット。 |
| miyulab-fe | https://github.com/WakuwakuP/miyulab-fe | 複数 Fediverse を横断する Web クライアント。 |

混同しないもの: `miyulab.com`（無関係のスキンケア）、`MYULAB`（無関係の法人ブランド）。

## 読み取った人格

- **名前**: Miyu + Lab。みゆの実験室 / 作業場。法人ブランドではなく個人ラボ。
- **トーン**: きれいめのサンセリフと余白。キャラクターとパステルで親しみを残す（テック × かわいい）。
- **プロダクト群**: ブログ、Markdown、Fediverse クライアント、Discord ボット、ゲーム向けツール。共通項は「自分用の道具を公開する」。
- **MiyulabMD の位置**: ラボの公開ノート。フォルダと共同編集が本体。

## 暫定トークン（アイコン用）

公式 CSS と画面から採った値。ガイドラインではなく制作用の寄せ。

| 役割 | 値 | 根拠 |
| --- | --- | --- |
| Ink | `#464646` | `--main-color` |
| Paper | `#FFFFFF` | `--main-bg-color` |
| Pink soft | `#FFCCFF` | `--primary-color: #fcf` |
| Pink | `#FF77FF` | `--link-text-color: #f7f` |
| Pink hot | `#FF44FF` | `--link-hover-text-color: #f4f` |
| Orb pink / lavender / sky / lemon | `#F3B8F3` `#D4C4F8` `#C0E8F0` `#F0E8B0` | 公式トップの背景円 |
| Type | M PLUS | 公式 1p、MD アプリ 2 |

マスコットのパーカーにある浅葱（ティール）ストライプはキャラ衣装であり、サイトの UI 色ではない。アイコンではモチーフとして抽象化し、色は公式マゼンタに寄せる。

## キャラクター記号（ブランドベース）

公式イラストを模写せず、次だけを幾何化する。

- 濃紫の長髪（`#2E2438`）
- ぱっつん前髪
- 三角の猫耳
- 顔は肌色楕円 + 赤みの瞳
- 前髪のハートクリップ（小さく）

MiyulabMD では **MD の2文字**か **折り角のあるノート**を必ず入れる。

## アイコン候補

`docs/brand/app-icons/` の SVG。Gallery には同内容の PNG を載せている。

幾何マーク（初期案）:

1. `01-m-tile.svg` — マゼンタタイルにインクの M。
2. `02-pastel-orbs.svg` — 公式トップの円 + M。
3. `03-cat-ear.svg` — 耳だけの記号。
4. `04-md-note.svg` — ノートと `#`。
5. `05-stripe-lab.svg` — 斜め三本 + M。

キャラクター + Markdown（ブランドベース案）:

6. `06-head-md.svg` — 頭（耳・前髪・サイドヘア）の下に MD。
7. `07-note-peek.svg` — ノートの後ろから髪と耳が見える。ページ上に MD。
8. `08-hair-frame.svg` — 髪を枠にして、中に折り角ノートと MD。
9. `09-head-badge.svg` — バストアップ + 右下の MD ノートバッジ。
10. `10-doc-portrait.svg` — ドキュメント形の中に肖像と MD。

04ノート + 姫カット（髪型を作り直した案）:

11. `11-note-hime.svg` — 04のノートに、上だけ丸いぱっつんと細い毛先。
12. `12-note-hime-strands.svg` — 11と同じ型。切り口に短い束の切れ込み。
13. `13-note-hime-wrap.svg` — 11と同じ型。長い髪がページの後ろから覗く。
