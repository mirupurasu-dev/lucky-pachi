#!/bin/bash
# 本体(../lucky-pachi)の最新を取り込んでGitHub Pagesへ再デプロイ
set -e
cd "$(dirname "$0")"
cp ../lucky-pachi/index.html ../lucky-pachi/game.js ../lucky-pachi/manifest.json ../lucky-pachi/sw.js .
mkdir -p assets && cp ../lucky-pachi/assets/*_art.webp assets/ # 本番用に加工済みのアートだけ配布(生成元は含めない)
cp ../lucky-pachi/assets/icon-*.png ../lucky-pachi/assets/favicon-*.png assets/ # PWA/Androidアイコン一式
cp ../lucky-pachi/assets/nikumaru.woff2 assets/ # 本文＆見出しフォント(にくまる 07NikumaruFont)
mkdir -p .well-known && cp ../lucky-pachi/.well-known/assetlinks.json .well-known/ # TWA用Digital Asset Links
git add -A
git commit -m "update game" || echo "no changes"
git push
echo "→ 数十秒後に https://mirupurasu-dev.github.io/lucky-pachi/ に反映"
