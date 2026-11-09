# South Africa LGE 2026 results

A results page for South Africa's local government elections of 4 November 2026.
It shows national, provincial, municipal and ward results on a clickable map.

**Live site:** https://calerio.github.io/lge-2026-results/

## Where the numbers come from

The Electoral Commission (IEC) publishes the files behind its own results dashboard at
`results.elections.org.za/dashboards/lge/MapsJason/2026/` (the IEC's spelling). A Cloudflare Worker (`worker/`) checks the national file every five minutes and whenever a visitor presses
Refresh (at most once a minute), and serves the results to the page. `scripts/publish-local.sh` runs `scripts/update.py`, the projections and the archive refresh
every five minutes and pushes the small static files (ward summaries, projections) that the pages read.
The GitHub Action in `.github/workflows/update.yml` does the same job but is currently disabled. When enabled, it fetches the national
file, refetches ward results only for municipalities whose report time has changed, and commits
compact JSON to `data/`. Each new IEC report is also kept in `data/history/`, which drives the
page's time slider and trend chart.

Party shares are the IEC's own figures: ward and PR ballots combined. Ward panels show the ward
ballot only. The live page marks results as provisional until the IEC declares them, and as final
once `data/archive/2026/FINAL` exists.

## Projections

`predictions.html` projects the final vote share nationally and for the eight metros from the
voting districts counted so far. Every district is grouped by how it voted in 2021 (province, DA
share, ANC share); each uncounted district borrows the change since 2021 of a counted district from
its own group, and the whole thing is simulated (2,000 runs per metro, 600 nationally). Ranges cover 90% of the runs.
It projects vote share only, not seats or who runs a council. The approach is similar in spirit to the
CSIR's election-night model, not a reimplementation of it.
A projection is only published once at least 90% of the uncounted vote has five or more counted
districts with a similar 2021 result, or when under a tenth of the vote is left.

- `scripts/project.py`: metros (pure Python)
- `scripts/project_national.py`: all ~23,700 districts (numpy; `uv run --with numpy python ...`)
- `scripts/backtest.py`, `scripts/backtest_national.py`: predict 2021 from 2016 at 10/25/50/75% of
  districts counted, in a typical and a worst-case reporting order, and score against the real
  2021 result and against the naive "count so far" baseline. Results are in `data/backtest*.json`.

Every published projection is kept in `data/projections_history.json` and
`data/projection_national_history.json`, with the IEC snapshot it used, the model version and the
time it was published, so it can be scored against the final result afterwards.

## Results archive

`scripts/archive.py` builds `data/archive/<year>/` for 2016, 2021 and 2026 from the IEC's
"Downloadable detailed results" files (one CSV per province: every voting district, ballot type and
party). It stores municipality totals by ballot and per-municipality files with ward and voting
district results. The analysis pages read it from here (party-list ballot by default; The shift and
Every result can also show the ward ballot). 2026 stays marked
provisional until `data/archive/2026/FINAL` exists.

## Analysis pages

`shift.html` (The shift), `explore.html` (Every result) and `votes.html` (Where votes changed) read the
archive above and share `assets/core.js` (calculations, search, CSV), `assets/atlas.js` (the map) and
`assets/charts.js` (chart layout: label placement, beeswarm, slope and arrow charts). Charts come
first; full tables sit behind a "Show the full table" toggle with a CSV download.
`scripts/compare.py` decides which places can be compared with 2021 and 2016 and writes
`data/archive/compare.json`, plus label points (`geo/points.json`) and province outlines
(`geo/provinces.json`). A municipality is compared only if no voting district moved across its
boundary; a ward only if it has exactly the same voting districts as an earlier ward. Re-run it after
rebuilding the archive: `uv run -q --with shapely python scripts/compare.py`.

## Boundaries

`geo/` holds the IEC's 2026 municipal and ward boundaries (`results.elections.org.za/ElectionMap/MapData/2026/`),
simplified with mapshaper to keep file sizes down. Ward shapes load per municipality on demand.

## Running locally

    python3 scripts/update.py     # fetch the latest results
    python3 -m http.server        # then open http://localhost:8000

No build step. The map uses MapLibre GL with OpenFreeMap tiles.

Not affiliated with the IEC.
