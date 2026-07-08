#!/bin/bash
# 本体(../lucky-pachi)の最新を取り込んでGitHub Pagesへ再デプロイ
set -e
cd "$(dirname "$0")"
cp ../lucky-pachi/index.html ../lucky-pachi/game.js .
mkdir -p assets && cp ../lucky-pachi/assets/*_art.webp assets/ # 本番用に加工済みのアートだけ配布(生成元は含めない)
git add -A
git commit -m "update game" || echo "no changes"
git push
echo "→ 数十秒後に https://mirupurasu-dev.github.io/lucky-pachi/ に反映"
