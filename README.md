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
│   ├── bilibili-minimal.user.js
│   ├── chatgpt-lightweight.user.js
│   ├── x-lightweight.user.js
│   └── youtube-lightweight.user.js
├── README.md
└── SECURITY.md
```
