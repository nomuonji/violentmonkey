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

Bilibiliの字幕を日本語・英語で表示するViolentmonkeyスクリプト（v0.3.0）。既存の `bilibili-minimal.user.js` と併用できます。

- Source: [`scripts/bilibili-dual-subtitles.user.js`](./scripts/bilibili-dual-subtitles.user.js)
- Install / update: https://raw.githubusercontent.com/nomuonji/violentmonkey/main/scripts/bilibili-dual-subtitles.user.js
- 対象: `www.bilibili.com/video/BV...` の通常動画（分P対応）。ライブ・番組は対象外。
- **設定**: 動画右上の「字幕設定 ⚙」または Violentmonkeyメニュー「Bilibili 字幕設定を開く」。
- **表示**: 「英語＋日本語」「日本語のみ」「英語のみ」を切り替え。上下・左右位置と文字サイズは保存されます。
- **初回翻訳**: Chrome内蔵 [Translator API](https://developer.chrome.com/docs/ai/translator-api) に対応したデスクトップChromeで、設定内の「翻訳モデルを準備」を押してください。未対応のブラウザでは追加の訳文を生成できません。
- **字幕取得の優先順位**:
  1. Violentmonkey内に保存した動画別の字幕キャッシュ（6時間・最大5動画）。追加通信なし。
  2. Bilibiliプレイヤーに**現在表示されている字幕**を読み取る。追加API通信なし。必要ならプレイヤーの字幕をONにしてください。この場合、画面上の元字幕は重複防止のため一時的に隠し、スクリプトをOFFにすると復元します。
  3. 動画ページ内に埋め込まれた字幕URLがあれば利用し、字幕本文だけ取得。
  4. 上記が利用できない場合、動画ページの既存の `aid`・`cid` を優先的に使い、WBI署名付きプレイヤーAPIで必要な字幕トラックだけを取得。取得トラックは最大3本。
- **アクセス制限時**: HTTP 412/429、APIコード -352/-412を受けたら、追加取得を24時間停止（手動の再取得も対象）。キャッシュや表示済みプレイヤー字幕は利用可能です。APIへの自動リトライは行いません。
- ローカルキャッシュには字幕テキストと有効期限だけを保存し、Cookie・アクセストークン・署名・秘密情報は保存しません。
- 既存字幕がない動画の文字起こしには非対応です。サイト側の利用規約・アクセス制限は引き続き適用され、APIの呼び出し削減によって利用が許可されたことにはなりません。
- 検証: 構文解析、キャッシュ再利用、表示済み字幕の再利用、選択言語の取得本数、HTTP 412での停止、ページ情報再利用、WBIフォールバックをモック環境で確認。実動画でのE2E検証は未実施です。

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
