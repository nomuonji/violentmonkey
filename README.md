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

Bilibiliの既存字幕を日本語・英語で表示するViolentmonkeyスクリプト（v0.4.0）。既存の `bilibili-minimal.user.js` と併用できます。

- Source: [`scripts/bilibili-dual-subtitles.user.js`](./scripts/bilibili-dual-subtitles.user.js)
- Install / update: https://raw.githubusercontent.com/nomuonji/violentmonkey/main/scripts/bilibili-dual-subtitles.user.js
- 対象: `www.bilibili.com/video/BV...` の通常動画（分P対応）。ライブ・番組は対象外。
- **字幕設定**: 動画右上の「字幕設定 ⚙」またはViolentmonkeyメニューから開けます。「英語＋日本語」「日本語のみ」「英語のみ」、上下・左右位置、文字サイズを変更できます。
- **追加通信の見える化**: プレイヤー右上に「追加通信 N件」を常時表示。設定内では取得元、API通信件数、字幕本文取得件数、HTTP失敗件数（該当時）を表示します。このスクリプトが発行した `GM_xmlhttpRequest` の数のみ計上し、Bilibili自身の通常通信やChrome翻訳モデルの取得は含みません。動画の切替／手動再取得で件数をリセットします。
- **後から標準字幕をONにした場合**: 再生中にBilibili標準字幕のDOM表示を監視し、表示されたらプレイヤー上の字幕を再利用します。字幕APIを既に取得済みでも切り替わります。切替後は取得予定の追加字幕リクエストを中止（送信済みの通信は取り消せません）。標準字幕は視聴中にONにすればよく、ページ読み込み時にONである必要はありません。
- **字幕取得の優先順位**:
  1. Violentmonkeyの動画別字幕キャッシュ（6時間・最大5動画）。追加通信なし。
  2. Bilibiliプレイヤーに現在表示されている標準字幕。追加通信なし。字幕が後から表示された場合も再利用。元字幕は重複防止のため一時的に非表示になり、スクリプトをOFFにすると元に戻ります。
  3. 動画ページに埋め込まれた字幕URLから必要な字幕本文のみ取得。
  4. 上記が利用できなければ、WBI署名付きプレイヤーAPIを使って字幕一覧を調べ、最大3本を取得。
- **「字幕がない」場合**: 視聴画面で字幕OFFでもBilibili側が字幕データを保持していれば取得可能です。サーバー側にも字幕トラックがなければ取得不可です。スクリプト自体には音声認識・文字起こし機能はありません。
- **翻訳モデル**: デスクトップ版Chrome内蔵の [Translator API](https://developer.chrome.com/docs/ai/translator-api)を利用。初回は設定画面の「翻訳モデルを準備」をクリックしてください。未対応ブラウザでは訳文を生成できません。
- **制限時の停止**: HTTP 412/429、APIコード -352/-412が返ると追加通信を24時間停止します。キャッシュや標準字幕は利用可能です。追加取得への自動リトライは行いません。
- 字幕テキストのキャッシュにはCookie・署名・秘密情報を含めません。追加通信の削減によりBilibiliの利用が許可されるわけではなく、サイトの利用規約やアクセス制限は引き続き適用されます。
- 検証: JavaScriptの構文、キャッシュ利用時の通信0件、字幕本文取得時の件数、後から標準字幕をONにした場合の切替、HTTP 412での停止をモック環境で確認。Bilibili実動画でのE2E検証は未実施です。

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
