// Vercelのビルド時に実行される。環境変数 GOOGLE_MAPS_API_KEY / GOOGLE_OAUTH_CLIENT_ID から
// config.js を生成し、index.html / style.css / app.js とあわせて dist/ に出力する。
// ローカル開発では使わない（ローカルはリポジトリ直下の config.js をそのまま読む）。
const fs = require('fs');
const path = require('path');

const apiKey = process.env.GOOGLE_MAPS_API_KEY || '';
if(!apiKey){
  console.warn('警告: 環境変数 GOOGLE_MAPS_API_KEY が設定されていません。Vercelのプロジェクト設定 > Environment Variables で追加してください。');
}
const oauthClientId = process.env.GOOGLE_OAUTH_CLIENT_ID || '';
if(!oauthClientId){
  console.warn('警告: 環境変数 GOOGLE_OAUTH_CLIENT_ID が設定されていません（未設定でもアプリは動作しますが、Google Driveバックアップ機能は使えません）。');
}

const outDir = path.join(__dirname, 'dist');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir);

for (const file of ['index.html', 'style.css', 'app.js']) {
  fs.copyFileSync(path.join(__dirname, file), path.join(outDir, file));
}

fs.writeFileSync(
  path.join(outDir, 'config.js'),
  `const GOOGLE_MAPS_API_KEY = ${JSON.stringify(apiKey)};\n` +
  `const GOOGLE_OAUTH_CLIENT_ID = ${JSON.stringify(oauthClientId || 'YOUR_OAUTH_CLIENT_ID_HERE')};\n`
);

console.log('ビルド完了: dist/ に config.js（環境変数から生成）を含めて出力しました。');
