# South Africa LGE 2026 results

A results page for South Africa's local government elections of 4 November 2026.
It shows national, provincial, municipal and ward results on a clickable map.

**Live site:** https://calerio.github.io/lge-2026-results/

## Where the numbers come from

The Electoral Commission (IEC) publishes the files behind its own results dashboard at
`results.elections.org.za/dashboards/lge/MapsJason/2026/` (the IEC's spelling). A GitHub Action
(`.github/workflows/update.yml`) runs `scripts/update.py` about every ten minutes. It fetches the national
file, refetches ward results only for municipalities whose report time has changed, and commits
compact JSON to `data/`. Each new IEC report is also kept in `data/history/`, which drives the
page's time slider and trend chart.

Party shares are the IEC's own figures: ward and PR ballots combined. Ward panels show the ward
ballot only. Everything is provisional until the IEC declares the results.

## Boundaries

`geo/` holds the IEC's 2026 municipal and ward boundaries (`results.elections.org.za/ElectionMap/MapData/2026/`),
simplified with mapshaper to keep file sizes down. Ward shapes load per municipality on demand.

## Running locally

    python3 scripts/update.py     # fetch the latest results
    python3 -m http.server        # then open http://localhost:8000

No build step. The map uses MapLibre GL with OpenFreeMap tiles.

This is an independent project, not affiliated with the IEC.
