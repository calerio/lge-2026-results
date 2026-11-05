"""Backtest the projection model on the 2021 election, using 2016 as the baseline.

For each metro and each stage of the count (10/25/50/75% of voting districts in), reveal part of the
2021 count, project the rest from 2016 with scripts/project.py, and compare with the real 2021 final.
Two reporting orders are tested:
  - "worst case": the most pro-DA stations (by 2016 result) report first, with a little noise;
  - "mixed": a weak version of the same tendency, closer to how counts actually arrive.
Also scores the naive baseline (count so far = final result) and whether the real result fell
inside the published range. Writes data/backtest.json for the predictions page.
"""
import json, os, random, sys, urllib.request
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import project as P

B = "https://results.elections.org.za/dashboards/lge/MapsJason/"
CACHE = os.path.join(HERE, "..", "data", "cache2021")  # gitignored
METROS = {3003: "Johannesburg", 9006: "Cape Town", 3004: "Tshwane", 3002: "Ekurhuleni",
          4005: "eThekwini", 1001: "Nelson Mandela Bay", 1117: "Buffalo City", 2207: "Mangaung"}
STAGES = (0.10, 0.25, 0.50, 0.75)
ORDERS = {"worst case": 0.15, "mixed": 0.6}   # noise added to the 2016 DA share when ordering
PARTIES = {52: "DA", 7: "ANC", 945: "EFF"}


def raw(year, ev, mid):
    path = os.path.join(CACHE, f"{year}_{mid}.json")
    if os.path.exists(path):
        return P.vd_votes(json.load(open(path)))
    with urllib.request.urlopen(urllib.request.Request(f"{B}{year}/{ev}Munic{mid}.js", headers=P.UA), timeout=180) as r:
        v = P.vd_votes(json.loads(r.read().decode("utf-8-sig")))
    os.makedirs(CACHE, exist_ok=True)
    json.dump(v, open(path, "w"))
    return v


def main():
    rows, real_cache = [], {}
    for mid, name in METROS.items():
        v16, v21 = raw("2016", "EEID402", mid), raw("2021", "EEID1091", mid)
        fin = defaultdict(float)
        for v in v21.values():
            for p, x in v.items():
                fin[p] += x
        T = sum(fin.values())
        for order_name, noise in ORDERS.items():
            rng = random.Random(11)
            da16 = lambda k: P.shares(v16[k])[0].get(52, 0) if k in v16 and sum(v16[k].values()) else 0.3
            order = sorted(v21, key=lambda k: -da16(k) + rng.gauss(0, noise))
            for stage in STAGES:
                shown = set(order[:int(len(order) * stage)])
                early = {k: (v if k in shown else {p: 0 for p in v}) for k, v in v21.items()}
                P.get = lambda ev, m, cache=False: v16 if cache else early
                r = P.project(mid, dict(PARTIES))
                pr = {p["short"]: p for p in r["parties"]} if r else {}
                for pid, short in PARTIES.items():
                    real = round(100 * fin[pid] / T, 1)
                    p = pr.get(short)
                    row = {"metro": name, "order": order_name, "stage": int(stage * 100), "party": short, "real": real,
                           "count": p["now"] if p else None, "published": bool(r and r["reliable"] and p),
                           "coverage": r["coverage"] if r else 0}
                    if p:
                        lo, md, hi = p["proj"]
                        row.update(proj=md, lo=lo, hi=hi, inside=lo <= real <= hi,
                                   err=round(abs(md - real), 2), baseErr=round(abs(p["now"] - real), 2))
                    rows.append(row)
                print(name, order_name, int(stage * 100), "published" if r and r["reliable"] else "withheld", flush=True)

    def summary(sel):
        pub = [r for r in sel if r["published"]]
        if not pub:
            return {"n": 0, "published": 0}
        errs = sorted(r["err"] for r in pub); base = sorted(r["baseErr"] for r in pub)
        return {"n": len(sel), "published": len(pub), "inside": sum(r["inside"] for r in pub),
                "medianErr": errs[len(errs) // 2], "maxErr": errs[-1], "medianBaseErr": base[len(base) // 2]}

    out = {"note": "2021 predicted from 2016. Errors in percentage points of vote share (all ballots); DA, ANC and EFF.",
           "byStage": {f"{o}|{int(s * 100)}": summary([r for r in rows if r["order"] == o and r["stage"] == int(s * 100)])
                       for o in ORDERS for s in STAGES},
           "rows": rows}
    with open(os.path.join(HERE, "..", "data", "backtest.json"), "w") as f:
        json.dump(out, f, separators=(",", ":"))
    for k, v in out["byStage"].items():
        print(k, v)


if __name__ == "__main__":
    main()
