#!/bin/zsh
# Run the updater on this machine and push new results (stand-in for the GitHub Action).
cd "$(dirname "$0")/.." || exit 1
git pull -q --rebase || exit 1
python3 -I scripts/update.py || exit 1
git add data
git diff --cached --quiet && exit 0
git commit -qm "Results: $(python3 -I -c 'import json;print(json.load(open("data/latest.json"))["reportDate"][:16])')"
git push -q
