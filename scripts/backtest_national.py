"""National backtest: predict the 2021 national result from 2016 at 10/25/50/75% of districts counted,
in a mixed and a worst-case reporting order (see scripts/backtest.py). Writes data/backtest_national.json.
Run with: uv run --with numpy python scripts/backtest_national.py"""
import json, os, random, sys
from collections import defaultdict
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import backtest as BT, project as P, project_national as N

ids = [f["properties"]["MunicId"] for f in json.load(open(os.path.join(HERE, "..", "geo", "munics.json")))["features"]]
prov = {int(f[:-5]): json.load(open(os.path.join(N.DATA, "cache2026", f))).get("prov") or 0 for f in os.listdir(os.path.join(N.DATA, "cache2026"))}
v16, v21 = {}, {}
for mid in ids:
    try: v16[mid] = BT.raw("2016", "EEID402", mid); v21[mid] = BT.raw("2021", "EEID1091", mid)
    except Exception as e: print("skip", mid, e, flush=True)
fin = defaultdict(float)
for vds in v21.values():
    for v in vds.values():
        for p, x in v.items(): fin[p] += x
T = sum(fin.values()); real = {p: 100 * fin[p] / T for p in (52, 7, 945)}
rows = []
for order, noise in BT.ORDERS.items():
    rng = random.Random(11)
    keys = [(m, k) for m, vds in v21.items() for k in vds]
    da16 = lambda m, k: P.shares(v16[m][k])[0].get(52, 0) if k in v16.get(m, {}) and sum(v16[m][k].values()) else 0.3
    keys.sort(key=lambda mk: -da16(*mk) + rng.gauss(0, noise))
    for stage in BT.STAGES:
        shown = set(keys[:int(len(keys) * stage)])
        early = {m: {k: (v if (m, k) in shown else {p: 0 for p in v}) for k, v in vds.items()} for m, vds in v21.items()}
        r = N.project_national(early, v16, {m: prov.get(m, 0) for m in early}, sims=300)
        for p in r["parties"]:
            if p["id"] in real:
                lo, md, hi = p["proj"]; rv = real[p["id"]]
                rows.append({"order": order, "stage": int(stage * 100), "party": {52: "DA", 7: "ANC", 945: "EFF"}[p["id"]],
                             "count": p["now"], "proj": md, "lo": lo, "hi": hi, "real": round(rv, 1), "published": r["reliable"],
                             "inside": lo <= rv <= hi, "err": round(abs(md - rv), 2), "baseErr": round(abs(p["now"] - rv), 2)})
        print(order, int(stage * 100), "coverage", r["coverage"], " | ".join(f"{x['party']} {x['count']}→{x['proj']} [{x['lo']}–{x['hi']}] real {x['real']}" for x in rows[-3:]), flush=True)
json.dump({"rows": rows, "real2021": {k: round(v, 1) for k, v in real.items()}}, open(os.path.join(N.DATA, "backtest_national.json"), "w"))
