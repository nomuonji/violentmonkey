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

Bilibili に既存字幕がある動画で、日本語のみ・英語のみ・日英併記を切り替えて表示します。既存の `bilibili-minimal.user.js` と併用できます。

- Source: [`scripts/bilibili-dual-subtitles.user.js`](./scripts/bilibili-dual-subtitles.user.js)
- Install / update: https://raw.githubusercontent.com/nomuonji/violentmonkey/main/scripts/bilibili-dual-subtitles.user.js
- 対象: `www.bilibili.com/video/BV...` の通常動画（分P対応）。番組・ライブは対象外。
- **設定場所**: 動画プレイヤーの右上にある **「字幕設定 ⚙」**、または Violentmonkey アイコン → このスクリプト → **「Bilibili 字幕設定を開く」**。
- **表示言語**: 「英語＋日本語」「日本語のみ」「英語のみ」の3種類。
- **位置・サイズ**: 「上下位置」「左右位置」のスライダーおよび文字サイズ。変更は保存され、次の動画でも維持されます。
- **翻訳中のままの場合**: 設定内の **「翻訳モデルを準備」** をクリック。Chrome内蔵Translator APIのモデルがないときは初回ダウンロードが発生します。処理状況・エラー理由は設定内の「翻訳状態」に表示します。翻訳が使えない場合は「翻訳中…」と表示し続けません。
- 字幕取得: `bvid` / `cid` に紐づくWBI署名付きBilibiliプレイヤーAPIを利用。未署名の旧APIは利用しません。
- Chrome内蔵翻訳: デスクトップChrome 138以降の [Translator API](https://developer.chrome.com/docs/ai/translator-api) を利用。外部翻訳サービスやAPIキーは不要。初回言語モデルの取得にはブラウザ・端末の対応とユーザー操作が必要な場合があります。
- 翻訳できない場合、字幕がない場合、地域・ログイン制限のある動画では字幕を生成できません。実際のBilibili動画でのE2E検証は未実施です。
- [Violentmonkeyの実行コンテキスト](https://violentmonkey.github.io/posts/inject-into-context/) の仕様に基づいてページ側で翻訳APIへアクセスします。個人情報・認証情報はソースに含めません。

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
