// config.js をコピーして作り、実際のAPIキーを入れてください（config.js はgit管理対象外）
// 有効化が必要なAPI: 「Maps JavaScript API」「Geocoding API」
// 公開する際は、Google Cloud ConsoleでこのキーにHTTPリファラー制限（自分のドメインのみ許可）をかけてください。
const GOOGLE_MAPS_API_KEY = "YOUR_API_KEY_HERE";

// Google Driveへのバックアップ保存/復元に使うOAuthクライアントID。
// Google Cloud Console > APIとサービス > 認証情報 で「OAuthクライアントID」（ウェブアプリケーション）を作成し、
// 承認済みのJavaScript生成元にこのアプリを開くURL（例: http://localhost:8792 や本番ドメイン）を登録してください。
// あわせて「Google Drive API」の有効化と、OAuth同意画面の設定（スコープ: drive.file）が必要です。
const GOOGLE_OAUTH_CLIENT_ID = "YOUR_OAUTH_CLIENT_ID_HERE";
