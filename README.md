# 行き先帖

行きたい場所をノート（リスト）ごとに集めて、Googleマップ上にピン留めできるメモアプリ。

## ファイル構成

| ファイル | 役割 |
|---|---|
| `index.html` | ページの骨組み。CSS/JSを読み込むだけ |
| `style.css` | 見た目 |
| `app.js` | アプリ本体のロジック（状態管理・画面描画・地図） |
| `config.js` | Google Maps APIキー（**git管理対象外**。各自のローカルにのみ置く） |
| `config.example.js` | `config.js` のひな形。コピーして使う |
| `build.js` / `package.json` / `vercel.json` | Vercelデプロイ用のビルド設定。環境変数からconfig.jsを生成する（後述） |

## セットアップ

1. `config.example.js` を `config.js` にコピーする
2. `config.js` の `GOOGLE_MAPS_API_KEY` を、自分のGoogle Cloud プロジェクトで発行したキーに書き換える
   - 有効化が必要なAPI: **Maps JavaScript API** / **Geocoding API**
3. ローカルサーバーで `index.html` を開く（`file://` 直開きだとブロックされる場合があるため）
   ```
   python -m http.server 8791
   ```
   その後 `http://localhost:8791/` を開く

データはブラウザの `localStorage` に保存される（アプリ内・端末内のみ）。

## Google Driveバックアップ（任意）

「☁️ Google Driveに保存 / から復元」ボタンを使うには、Google Cloud Consoleで別途OAuthクライアントIDの発行が必要です。

1. Google Cloud Console → APIとサービス → ライブラリ で **Google Drive API** を有効化する
2. APIとサービス → OAuth同意画面 を設定する（スコープに `drive.file` を追加。テスト段階なら「テストユーザー」に自分のGoogleアカウントを追加）
3. APIとサービス → 認証情報 → 認証情報を作成 → **OAuthクライアントID**（アプリケーションの種類: ウェブアプリケーション）を作成する
   - 承認済みのJavaScript生成元に、アプリを開くURL（例: `http://localhost:8791`、Vercelの本番ドメイン）を登録する
4. 発行されたクライアントIDを `config.js` の `GOOGLE_OAUTH_CLIENT_ID` に設定する

保存されるファイルは、ボタンを押した本人のGoogleアカウント自身のDrive内に作られます（開発者側のDriveではありません）。
`drive.file` スコープにより、アプリはこのアプリ自身が作成したファイルにしかアクセスできません。

未設定のままでもアプリ自体は問題なく動作します（Driveボタンを押すと設定を促すメッセージが出るだけです）。

## Vercelへのデプロイ

`config.js` はgit管理対象外なので、そのままpushしただけではデプロイ後にAPIキーが存在せず地図が表示されない。
Vercelの環境変数からビルド時に `config.js` を生成する仕組み（`build.js`）を用意している。

1. このフォルダをGitHubリポジトリにpushする（`config.js` は`.gitignore`により自動的に含まれない）
2. VercelでそのGitHubリポジトリをImportする（Framework Preset: **Other** でOK。`vercel.json` がビルドコマンドと出力先を指定済み）
3. Vercelのプロジェクト設定 → **Environment Variables** で `GOOGLE_MAPS_API_KEY`（と、Google Driveバックアップを使う場合は `GOOGLE_OAUTH_CLIENT_ID`）を追加し、値を設定する
4. デプロイすると `build.js` が実行され、環境変数から `dist/config.js` が生成されてサイトに含まれる
5. Google Driveバックアップを使う場合、OAuthクライアントIDの「承認済みのJavaScript生成元」にVercelの本番ドメインも追加しておく

## 公開前にやること

- **APIキーの制限**: Google Cloud Console で、このキーに「HTTPリファラー制限」をかけ、Vercelの公開ドメイン（`*.vercel.app` やカスタムドメイン）のみ許可する（制限をかけないと誰でもキーを使い回せてしまう。Maps JS APIのキーはブラウザに送られる性質上「隠す」ことはできないため、この制限が実質的なセキュリティ対策になる）
- `config.js` は絶対にリポジトリにコミットしない（`.gitignore` 済み）
- 現状は**1人（1ブラウザ）専用**のプロトタイプ（データは`localStorage`のみ）。複数人が使う・複数端末でデータを共有するWebサービスにするには、認証とデータベースを持つバックエンドが別途必要（`app.js` の「ストレージ」セクションにある `load` / `persistLists` / `persistPlaces` がAPI呼び出しに差し替える対象）
