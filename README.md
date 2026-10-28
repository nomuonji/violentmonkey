# Violentmonkey Userscripts

個人用 Violentmonkey userscript の正本リポジトリです。

このリポジトリは **public** です。  
スクリプトのソースコードは公開情報として扱い、機密情報を一切コミットしません。

## Scripts

### Language Reactor Don't Learn Translations

Language Reactorの字幕で、Don't Learn に設定された紫色の単語の辞書訳を常時表示します。

- Source: [`scripts/language-reactor-dont-learn-translation.user.js`](./scripts/language-reactor-dont-learn-translation.user.js)
- Install / update: https://raw.githubusercontent.com/nomuonji/violentmonkey/main/scripts/language-reactor-dont-learn-translation.user.js
- **対象**: YouTube / Netflix 上の Language Reactor 字幕。
- **動作**: 動画上の字幕で、色が Don't Learn の紫色（`rgb(184, 148, 197)` 付近）の単語を検出し、その単語の上に日本語の意味（最大3つ）を常時表示します。字幕が切り替わると自動で付け替え、隣り合う単語のラベルは重ならないよう段積みします。
- **仕組み**: Language Reactorの辞書ポップは実際のマウス操作でしか開かないため、ホバーの偽装はせず、LRがホバー辞書に使っている辞書API（`api-cdn-plus.dioco.io`）を単語ごとに直接引いています（同じ単語は1回だけ取得してキャッシュ）。
- **設定**: スクリプト冒頭の `TARGET_LANG`（訳の言語）、`TARGET_COLOR`（紫色）、`MAX_MEANINGS` で調整できます。
- **注意**: 対象は動画上の字幕（`#lln-subs`）で、右側のサイドバー字幕は対象外です。Language Reactor側のAPI・色・DOM構造が変わると調整が必要です。YouTubeでは実ブラウザで表示を確認済み、Netflixは未確認です。

### YouTube Preference Pusher

YouTubeのおすすめを**自分の好みで採点し直す**スクリプトです。YouTube側のアルゴリズムはそのままに、画面に出てきた動画を並べ替え・薄表示・非表示し、好きなチャンネルの新着やキーワード検索から集めた「好み枠」をホーム上部に差し込みます。

- Source: [`scripts/youtube-preference-pusher.user.js`](./scripts/youtube-preference-pusher.user.js)
- Install / update: https://raw.githubusercontent.com/nomuonji/violentmonkey/main/scripts/youtube-preference-pusher.user.js
- **好みの入れ方（併用）**
  - 手動: 好きなチャンネル（`@handle`・URL・`UC…`・名前）、好きなキーワード（`/正規表現/` 可）、NGチャンネル、NGキーワード。末尾 ` | 2` で重み。
  - 自動学習: 高評価した動画、選んだ再生リスト（他人の公開リストも可）、登録チャンネル、任意で「後で見る」と視聴履歴。タイトルの語は、普段フィードに流れてくる動画と比べて「自分の好みに特有な語」だけを重み付けします（「動画」「解説」のような汎用語は自動的に弱くなる）。
  - カード上の 👍 / 👎 / 🚫 ボタンで少しずつ育てる。
- **表示**: スコアが高い動画は緑枠＋上へ、好み要素がない動画は薄く（設定で「隠す」も可）、NGは非表示。ホームと関連動画は「読み込まれた塊ごと」に並べ替えるので、見ている途中の上の方は動きません。検索結果はNG非表示とスコア表示だけ。
- **好み枠**: 好きなチャンネル・学習したチャンネルのRSS新着と、好きなキーワード・学習した語での「今月/今週」の検索結果から、採点上位を1チャンネル最大2本まで並べます（既定4時間ごとに更新、見た動画と✕で外した動画は出さない）。検索はログインなしで送るので、自分の検索履歴には残らず、パーソナライズもされません。
- **「興味なし」の送信（C）**: 👎 は「興味なし」、🚫 は「チャンネルをおすすめに表示しない」を、そのカードのメニューからYouTubeにも送ります。設定パネルの「操作」タブから、いま画面にある薄い動画へ一括で送ることもできます（押したときだけ、1件ずつ間隔をあけて実行）。
- **しないこと**: 自動再生・自動高評価などでYouTubeを「調教」する操作はしません。通信は youtube.com 内だけで、外部サーバーには何も送りません。
- **設定**: 画面左下の 🎯 ボタン、またはViolentmonkeyのメニュー。データ（設定・学習結果）はこのブラウザのViolentmonkeyにだけ保存され、「データ」タブでエクスポート／インポートできます。
- **初回**: インストール後しばらくすると自動で一度学習します（以後は既定7日ごと）。高評価が少ない場合は「学習」タブで視聴履歴や再生リストを足してください。
- **注意**: YouTubeのDOMや内部APIが変わると調整が必要です。2026-10時点のホーム（`yt-lockup-view-model` 系の新UI）・メニュー構造・内部APIの応答形式は実ブラウザで確認済み。動画ページの関連動画と検索結果は、視聴・検索履歴を汚さないため実ページでの確認は未実施です。

### Language Reactor Word Stock

Language Reactorの字幕で、覚えたい英単語を **Alt+クリック**（MacはOption+クリック）すると、Googleスプレッドシートにストックします。

- Source: [`scripts/language-reactor-word-stock.user.js`](./scripts/language-reactor-word-stock.user.js)
- Install / update: https://raw.githubusercontent.com/nomuonji/violentmonkey/main/scripts/language-reactor-word-stock.user.js
- 受け口: [`apps-script/word-stock/Code.gs`](./apps-script/word-stock/Code.gs)
- **保存される列**: 単語 / 意味（LRの辞書から最大3つ）/ 例文（その字幕の文）/ 動画タイトル / リンク（YouTubeはその場面の2秒前から再生）/ 追加日時 / 回数 / 最終保存 / メモ（自由記入）。
- **重複**: 同じ単語は新しい行を作らず「回数」と「最終保存」を更新し、別の例文なら最大3つまで追記します。
- **対象**: 動画上の字幕と右サイドバーの字幕の両方。Alt+クリックはLR側には渡さないので、通常クリックの動作（一時停止や辞書）はそのままです。

#### 初回セットアップ

1. 新しいGoogleスプレッドシートを作り、`拡張機能 > Apps Script` を開く。
2. `Code.gs` の中身を [`apps-script/word-stock/Code.gs`](./apps-script/word-stock/Code.gs) で置き換えて保存。
3. `デプロイ > 新しいデプロイ` → 種類「ウェブアプリ」、実行するユーザー「自分」、アクセスできるユーザー「全員」でデプロイし、表示された権限を許可。
4. 表示されたウェブアプリURL（`…/exec`）をコピー。
5. YouTubeでViolentmonkeyのメニュー → `単語ストック: 保存先URLを設定` に貼り付け（未設定のまま初めてAlt+クリックしたときも聞かれます）。

- **注意**: ウェブアプリURLはViolentmonkeyのスクリプト用ストレージにだけ保存し、このリポジトリには入れません。URLを知っている人はシートに行を追加できてしまうので、URLは共有しないでください。`Code.gs` を変更したときは「デプロイを管理」から同じデプロイの新バージョンを作るとURLが変わりません。Netflixでは未確認です。

### X Inline Translator（Chrome組み込みAI）

Xのタイムライン上で投稿を日本語へ翻訳し、選択した英単語・フレーズの日本語訳をポップアップ表示します。既存の `X Lightweight` と併用できます。

- Source: [`scripts/x-inline-translator.user.js`](./scripts/x-inline-translator.user.js)
- Install / update: https://raw.githubusercontent.com/nomuonji/violentmonkey/main/scripts/x-inline-translator.user.js
- **対応**: デスクトップ版 Chrome 138以降で、組み込み `Translator` APIが利用できる環境。モデルや言語ペアはChrome側の対応状況によります。スマートフォンには非対応です。
- **操作**: 各投稿下の「日本語訳」をクリックすると、原文を残して訳文を表示します。投稿本文の英単語を**1クリック**すると、その単語の日本語訳をすぐにポップアップ表示します（ポスト詳細への遷移は抑止）。リンク・ハッシュタグ・メンションのクリックやCtrl/Shift等の修飾クリックは元のままです。単語をダブルクリックしても翻訳でき、フレーズをドラッグ選択すると「訳す」ボタンが表示されます。英単語の発音読み上げに加え、ポップアップ内の「Google検索 ↗」を1回押すと、その英単語を新しいタブでGoogle検索できます。検索ボタンを押したときだけ検索語をGoogleへ送信します。
- **通信と費用**: 非公式Google翻訳エンドポイントや外部翻訳APIは呼びません。ブラウザ組み込みモデルで翻訳します。初回はChromeによるモデルダウンロードが必要な場合があります。APIキー・課金・外部サーバーは不要です。
- **辞書との違い**: 選択語の訳語は機械翻訳であり、辞書的な語義・品詞・発音記号の網羅ではありません。読み上げにはブラウザの音声合成を使用します。
- **非対応時**: オンライン翻訳への自動フォールバックは行わず、利用不可の理由を表示します。端末・ブラウザ条件による制約があり、Xでの実機E2E検証は未実施です。

### X Lightweight

X の不要 UI や画面効果を減らし、動画をクリックしただけでポスト詳細 URL に遷移する挙動を抑止します。

- Source: [`scripts/x-lightweight.user.js`](./scripts/x-lightweight.user.js)
- Install / update: https://raw.githubusercontent.com/nomuonji/violentmonkey/main/scripts/x-lightweight.user.js

### ChatGPT Lightweight

ChatGPT のアニメーションや装飾を抑え、画面外メッセージ等の描画負荷を軽減します。

- Source: [`scripts/chatgpt-lightweight.user.js`](./scripts/chatgpt-lightweight.user.js)
- Install / update: https://raw.githubusercontent.com/nomuonji/violentmonkey/main/scripts/chatgpt-lightweight.user.js

### YouTube Lightweight

YouTube のアンビエント効果・販促枠・Shorts 等を整理し、ホームや検索結果の画面外描画を軽量化します。

- Source: [`scripts/youtube-lightweight.user.js`](./scripts/youtube-lightweight.user.js)
- Install / update: https://raw.githubusercontent.com/nomuonji/violentmonkey/main/scripts/youtube-lightweight.user.js

### Bilibili Minimal Viewing

Bilibili の広告・大型バナー・コメント等を整理しつつ、動画ページの関連動画は残します。

- Source: [`scripts/bilibili-minimal.user.js`](./scripts/bilibili-minimal.user.js)
- Install / update: https://raw.githubusercontent.com/nomuonji/violentmonkey/main/scripts/bilibili-minimal.user.js

### Bilibili Dual Subtitles (English + Japanese)

Bilibiliの既存字幕を日本語・英語で表示するViolentmonkeyスクリプト（v0.6.2）。既存の `bilibili-minimal.user.js` と併用できます。

- Source: [`scripts/bilibili-dual-subtitles.user.js`](./scripts/bilibili-dual-subtitles.user.js)
- Install / update: https://raw.githubusercontent.com/nomuonji/violentmonkey/main/scripts/bilibili-dual-subtitles.user.js
- 対象: `www.bilibili.com/video/BV...` の通常動画（分P対応）。ライブ・番組は対象外。
- **追加API通信はデフォルト0件**: ページ初期表示・再生位置の定期確認・動画切替時にはBilibiliの追加APIリクエストを送信しません。ユーザーが「字幕を取得」を押した時だけ取得します。Chrome翻訳モデルの通信は別扱いです。
- **標準字幕の再利用**: プレイヤー上で後からBilibili標準字幕をONにした場合も、字幕を表示しているDOMを定期的に確認して再利用します。従来のBilibili字幕クラスに加え、公開済みユーザースクリプトで利用されている `.bili-subtitle-x-subtitle-panel-major-group .bili-subtitle-x-subtitle-panel-text` と minor-group の字幕文字列を優先して読み取ります。無関係な動画UIを字幕として扱う危険があるため、動画領域内の任意テキストを位置だけで拾う処理は採用しません。字幕スタイルプレビューの「字幕样式测试」は除外します。標準字幕が実際に表示される（発話のある）タイミングで検出します。元字幕は重複を避けるため一時的に隠し、本拡張をOFFにすると戻します。
- **標準字幕の診断**: 動画右上の「字幕設定 ⚙」内に「標準字幕検出」を表示します。専用クラスによる実字幕・字幕要素ありで実字幕テキスト待ち・検出不可を区別し、字幕ONなのに取得できない場合の切り分けに使えます。診断自体はネットワーク通信しません。canvas、iframe、閉じたShadow DOM内の文字はDOMから取得できません。
- **手動取得**: キャッシュも標準字幕もない場合は「字幕を取得」ボタンを表示。Bilibili側に字幕トラックがあれば取得可能です。ユーザーがクリックしない限り追加APIを使いません。字幕データが全くない動画は文字起こしできません。
- **字幕設定**: 英語＋日本語／日本語のみ／英語のみ、上下・左右位置、文字サイズ、原文表示。
- **追加通信の可視化**: プレイヤー右上に本スクリプトが開始した追加リクエスト数、設定画面に取得元・APIと字幕本文の内訳を表示。Bilibili本体の通信は計上しません。
- **翻訳モデル**: 対応するデスクトップChromeの [Translator API](https://developer.chrome.com/docs/ai/translator-api) を使用。初回は設定画面の「翻訳モデルを準備」をクリックしてください。
- **キャッシュ・制限**: 字幕は6時間・最大5動画分をローカル保存。HTTP 412/429やAPIコード -352/-412時は追加取得を24時間停止。キャッシュと標準字幕は引き続き利用可能。
- **注意**: 字幕を読み込むためのBilibili本体の通常通信と、手動取得時の本スクリプトの追加通信は別です。通信を減らしてもBilibiliの利用規約への適合が保証されるわけではありません。
- **実ブラウザ調査**: `https://www.bilibili.com/video/BV1EXRcBME3W/` で再生中にプレイヤー字幕をOFFからONにし、「中文」を選択。映像に焼き込まれた中英字幕とは別に「字幕样式测试」が表示され、ページ本文にも同じテキストが現れました。一方、従来版の取得状況は「字幕DOMなし」のままでした。v0.6.2では字幕専用の新旧クラスを参照し、表示用テスト文字列を字幕から除外します。元の『字幕样式测试』はスタイル確認のサンプルであり、実際の字幕テキスト取得に成功した証拠ではありません。
- **検証**: JavaScript構文チェックと、主要/副字幕DOMの検出、スタイルプレビュー除外、非表示要素の除外、無関係な動画UIの誤検出防止、途中ON、通常表示時の追加通信ゼロをモックで確認済み。v0.6.2の実ブラウザでのOFF→ON、字幕空白区間、動画切替、全画面のE2E確認は未実施のため、PRはDraftのままです。

## Installation

Violentmonkey がインストール済みのブラウザで、各スクリプトの **Install / update** の Raw URL を開いてインストールしてください。

以後は userscript 内の `@updateURL` / `@downloadURL` と `@version` を使って GitHub 上の最新版を取得します。

## Migration note

2026-09-24 に Stylus から以下を userscript 化しました。

- Bilibili Minimal Viewing
- ChatGPT Lightweight
- YouTube Lightweight

Stylus バックアップ内にも X Lightweight が含まれていましたが、GitHub 側の `x-lightweight.user.js` の方が新しいため、旧 Stylus 版では上書きしていません。

## 運用方針

- GitHub を userscript の正本とする。
- 端末ごとに同じ GitHub Raw URL からインストールする。
- 修正時は GitHub 上のソースを更新し、必ず `@version` を上げる。
- Violentmonkey 側だけで行ったローカル編集は正本にしない。
- API キー、アクセストークン、Cookie、パスワード、秘密鍵、個人情報などはコードへ直書きしない。
- URL の query parameter や header 値に埋め込まれた token もコミットしない。
- Violentmonkey のバックアップや export データは、保存値や個人情報を含む可能性があるため、そのままこの public repository に置かない。
- 外部サービスの認証が必要になった場合は、公開リポジトリに秘密を置かない設計を先に選ぶ。

詳細は [SECURITY.md](./SECURITY.md) を参照してください。

## Structure

```text
violentmonkey/
├── scripts/
│   ├── bilibili-dual-subtitles.user.js
│   ├── bilibili-minimal.user.js
│   ├── chatgpt-lightweight.user.js
│   ├── x-inline-translator.user.js
│   ├── x-lightweight.user.js
│   ├── youtube-preference-pusher.user.js
│   └── youtube-lightweight.user.js
├── README.md
└── SECURITY.md
```
