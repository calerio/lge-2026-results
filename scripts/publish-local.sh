#!/bin/zsh
# Run the updater on this machine and push new results (stand-in for the GitHub Action).
cd "$(dirname "$0")/.." || exit 1
git pull -q --rebase --autostash || exit 1
python3 -I scripts/update.py || exit 1
python3 -I scripts/project.py --write || true
uv run -q --with numpy python scripts/project_national.py || true
for f in data/latest.json data/history data/wards data/projections.json data/projections_history.json \
         data/projection_national.json data/projection_national_history.json; do
  [ -e "$f" ] && git add "$f"
done
git diff --cached --quiet && exit 0
git commit -qm "Results: $(python3 -I -c 'import json;print(json.load(open("data/latest.json"))["reportDate"][:16])')"
git push -q
