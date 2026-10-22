#!/bin/sh
# Sestaví dist/ a nasadí ho na větev gh-pages (GitHub Pages webhunter-navrhy/navigace).
set -e
cd "$(dirname "$0")/.."
python3 tools/build.py
REPO=https://github.com/webhunter-navrhy/navigace.git
cd dist
rm -rf .git
git init -q -b gh-pages
git add -A
git commit -qm "Nasazení $(date '+%Y-%m-%d %H:%M')"
git push -qf "$REPO" gh-pages
rm -rf .git
echo "nasazeno: https://webhunter-navrhy.github.io/navigace/"
