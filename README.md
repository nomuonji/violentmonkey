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

Bilibiliの既存字幕を日本語・英語で表示するViolentmonkeyスクリプト（v0.5.0）。既存の `bilibili-minimal.user.js` と併用できます。

- Source: [`scripts/bilibili-dual-subtitles.user.js`](./scripts/bilibili-dual-subtitles.user.js)
- Install / update: https://raw.githubusercontent.com/nomuonji/violentmonkey/main/scripts/bilibili-dual-subtitles.user.js
- 対象: `www.bilibili.com/video/BV...` の通常動画（分P対応）。ライブ・番組は対象外。
- **追加API通信はデフォルトで発生しません。** 動画読み込み時・再生位置の定期確認・動画切替時にはBilibiliの追加APIリクエストを発行しません。ローカルキャッシュがあれば字幕を表示し、標準字幕が表示されればページ読み込み後でも自動再利用します。
- **手動取得**: キャッシュと標準字幕のどちらも使えない場合は、プレイヤー右上に **「字幕を取得」** ボタンを表示。ユーザーがクリックしたときだけ、必要なBilibili字幕データを取得します。設定画面の「字幕を取得（追加通信）」も同じ操作です。標準字幕が途中でOFFになった場合も、表示がなくなって約3秒後に手動取得ボタンを再表示します。通信エラー後の自動リトライはしません。
- **追加通信の件数表示**: プレイヤー右上に「追加通信 N件」を表示。設定画面では取得元・APIリクエスト件数・字幕本文取得件数・HTTP失敗件数も確認できます。数えるのは**本スクリプトが発行したリクエストのみ**で、Bilibili本体の通信とChrome翻訳モデルのダウンロードは計上しません。
- **字幕設定**: プレイヤー右上「字幕設定 ⚙」またはViolentmonkeyメニュー。「英語＋日本語」「日本語のみ」「英語のみ」、上下・左右位置、文字サイズを変更できます。
- **字幕の取得順**: ローカルキャッシュ（6時間・最大5動画）→ プレイヤーで表示中の標準字幕 → **明示操作時のみ**ページ埋込の字幕URLを使い字幕本文を取得 → 必要ならWBI署名付きプレイヤーAPIで字幕一覧と最大3本の字幕本文を取得。
- **字幕がない動画**: 字幕表示OFFでもBilibili側に字幕データがあれば、手動取得で字幕を使える場合があります。サーバー側にも字幕データがない場合は取得できません。スクリプトに音声認識機能はありません。
- **翻訳モデル**: 対応するデスクトップChromeの [Translator API](https://developer.chrome.com/docs/ai/translator-api)を使用。初回は「翻訳モデルを準備」を押してください。訳文の生成はBilibili字幕APIとは別です。
- **制限時の停止**: HTTP 412/429、APIコード -352/-412でBilibiliへの追加取得を24時間停止。手動クリックでも制限中は追加通信しません。キャッシュと表示中の標準字幕は引き続き利用可能です。
- ローカル字幕キャッシュにCookie・署名・APIキーは保存しません。通信削減はBilibili利用規約への適合を保証しません。
- 検証: 初回読み込み・定期チェック・キャッシュ表示・標準字幕の後からのONが追加通信0件であること、手動クリックでのみ字幕を取得すること、制限中の取得停止などをモック環境で確認。Bilibili実動画でのE2E検証は未実施です。

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
