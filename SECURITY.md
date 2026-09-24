# Security Policy

このリポジトリは public repository です。コミットされた内容は第三者に閲覧・複製され得るものとして扱います。

## 絶対にコミットしないもの

以下は userscript、README、設定例、ログ、バックアップを含め、このリポジトリへ保存しません。

- API keys
- OAuth access / refresh tokens
- Personal access tokens
- Session cookies
- Passwords
- Private keys / signing keys
- 認証済み URL に含まれる token や secret
- 個人を特定できる不要な情報
- Violentmonkey の export / backup に含まれる秘密の保存値
- サービスの管理画面からコピーした credential 一式

## Userscript で認証情報が必要になった場合

秘密値をソースコードへ埋め込む実装は採用しません。

必要に応じて、次のような方式を用途ごとに検討します。

1. 各端末でユーザーがローカル設定する。
2. userscript のローカル保存領域に初回入力して保持する。
3. OAuth 等の正式な認証フローを利用する。
4. 秘密値を必要としない公開 API / 公開データ設計へ変更する。

どの方式でも、GitHub 上のコード・URL・ログから秘密値を復元できないことを前提にします。

## Commit 前チェック

- 文字列中に token / key / password / cookie がないか。
- URL に credential が埋め込まれていないか。
- デバッグログに個人情報や認証情報がないか。
- export / JSON / ZIP 等を追加する場合、中身が公開可能か。
- `@require`, `@resource`, `@connect` 等の外部依存先が意図したものか。

秘密情報を誤って commit した場合、単に後続 commit で削除するだけでは不十分です。該当 credential を直ちに revoke / rotate し、必要に応じて Git 履歴からも除去します。
