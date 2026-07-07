#!/bin/bash
# 本体(../lucky-pachi)の最新を取り込んでGitHub Pagesへ再デプロイ
set -e
cd "$(dirname "$0")"
cp ../lucky-pachi/index.html ../lucky-pachi/game.js .
git add -A
git commit -m "update game" || echo "no changes"
git push
echo "→ 数十秒後に https://otarumi-cmyk.github.io/lucky-pachi/ に反映"
