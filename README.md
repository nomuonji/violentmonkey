# Violentmonkey Userscripts

個人用 Violentmonkey userscript の正本リポジトリです。

このリポジトリは **public** です。  
スクリプトのソースコードは公開情報として扱い、機密情報を一切コミットしません。

## Scripts

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

Bilibiliの既存字幕を日本語・英語で表示するViolentmonkeyスクリプト（v0.6.0）。既存の `bilibili-minimal.user.js` と併用できます。

- Source: [`scripts/bilibili-dual-subtitles.user.js`](./scripts/bilibili-dual-subtitles.user.js)
- Install / update: https://raw.githubusercontent.com/nomuonji/violentmonkey/main/scripts/bilibili-dual-subtitles.user.js
- 対象: `www.bilibili.com/video/BV...` の通常動画（分P対応）。ライブ・番組は対象外。
- **追加API通信はデフォルト0件**: ページ初期表示・再生位置の定期確認・動画切替時にはBilibiliの追加APIリクエストを送信しません。ユーザーが「字幕を取得」を押した時だけ取得します。Chrome翻訳モデルの通信は別扱いです。
- **標準字幕の再利用**: プレイヤー上で後からBilibili標準字幕をONにした場合も、字幕を表示しているDOMを定期的に確認して再利用します。従来の `.bpx-player-subtitle-panel-text` のほか、`.bpx-player-subtitle-panel-major-group` や `.bpx-player-subtitle-wrap .bpx-player-subtitle-item` などのレイアウトにも対応。標準字幕が実際に表示される（発話のある）タイミングで検出します。元字幕は重複を避けるため一時的に隠し、本拡張をOFFにすると戻します。
- **標準字幕の診断**: 動画右上の「字幕設定 ⚙」内に「標準字幕検出」を表示します。「字幕DOMなし」「字幕要素あり・表示テキスト待ち」「セレクタ名で検出」などを表示するため、字幕ONなのに取得できない場合の切り分けに使えます。診断自体はネットワーク通信しません。
- **手動取得**: キャッシュも標準字幕もない場合は「字幕を取得」ボタンを表示。Bilibili側に字幕トラックがあれば取得可能です。ユーザーがクリックしない限り追加APIを使いません。字幕データが全くない動画は文字起こしできません。
- **字幕設定**: 英語＋日本語／日本語のみ／英語のみ、上下・左右位置、文字サイズ、原文表示。
- **追加通信の可視化**: プレイヤー右上に本スクリプトが開始した追加リクエスト数、設定画面に取得元・APIと字幕本文の内訳を表示。Bilibili本体の通信は計上しません。
- **翻訳モデル**: 対応するデスクトップChromeの [Translator API](https://developer.chrome.com/docs/ai/translator-api) を使用。初回は設定画面の「翻訳モデルを準備」をクリックしてください。
- **キャッシュ・制限**: 字幕は6時間・最大5動画分をローカル保存。HTTP 412/429やAPIコード -352/-412時は追加取得を24時間停止。キャッシュと標準字幕は引き続き利用可能。
- **注意**: 字幕を読み込むためのBilibili本体の通常通信と、手動取得時の本スクリプトの追加通信は別です。通信を減らしてもBilibiliの利用規約への適合が保証されるわけではありません。
- **検証**: JavaScript構文、旧字幕要素・major-group・別形式字幕要素の検出、後からの字幕ON、非表示字幕の除外、追加通信0件をモックで確認。Bilibili実動画でのE2E検証は未実施です。

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
│   ├── x-lightweight.user.js
│   └── youtube-lightweight.user.js
├── README.md
└── SECURITY.md
```
