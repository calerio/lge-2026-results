# South Africa LGE 2026 results

A results page for South Africa's local government elections of 4 November 2026.
It shows national, provincial, municipal and ward results on a clickable map.

**Live site:** https://calerio.github.io/lge-2026-results/

## Where the numbers come from

The Electoral Commission (IEC) publishes the files behind its own results dashboard at
`results.elections.org.za/dashboards/lge/MapsJason/2026/` (the IEC's spelling). A Cloudflare Worker (`worker/`) checks the national file every five minutes and whenever a visitor presses
Refresh (at most once a minute), and serves the results to the page. The GitHub Action
(`.github/workflows/update.yml`) runs `scripts/update.py` as a static fallback. It fetches the national
file, refetches ward results only for municipalities whose report time has changed, and commits
compact JSON to `data/`. Each new IEC report is also kept in `data/history/`, which drives the
page's time slider and trend chart.

Party shares are the IEC's own figures: ward and PR ballots combined. Ward panels show the ward
ballot only. Everything is provisional until the IEC declares the results.

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

## Boundaries

`geo/` holds the IEC's 2026 municipal and ward boundaries (`results.elections.org.za/ElectionMap/MapData/2026/`),
simplified with mapshaper to keep file sizes down. Ward shapes load per municipality on demand.

## Running locally

    python3 scripts/update.py     # fetch the latest results
    python3 -m http.server        # then open http://localhost:8000

No build step. The map uses MapLibre GL with OpenFreeMap tiles.

Not affiliated with the IEC.
