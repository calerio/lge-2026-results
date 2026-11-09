"""Which places can be compared between 2026 and an earlier local election, and where to draw them.

Reads the results archive (data/archive/<year>/municipality/<code>.json, built by archive.py) and the
2026 municipal boundaries (geo/munics.json). Writes:

  data/archive/compare.json  for each baseline year (2021, 2016):
      munics[code] = {"ok": true} or {"ok": false, "reason": ...}
      wards[code][ward2026] = baseline ward id, only where the 2026 ward is made of exactly the same
                              voting districts as one baseline ward (otherwise the ward is left out)
  geo/points.json            a label/symbol point inside every municipality, plus province label points

Rules (no estimates):
- A municipality is comparable only if no voting district moved between it and another municipality
  (in either direction) between the two elections. New voting districts inside the same municipality
  are fine: the municipality's outer boundary is what matters for its total.
- A ward is comparable only if its set of voting districts equals the set of one baseline ward. A
  same-numbered ward with different districts is not a comparison.

Usage: uv run -q --with shapely python scripts/compare.py
"""
import json, os
from shapely.geometry import shape
from shapely.ops import unary_union

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
ARCH = os.path.join(ROOT, "data", "archive")


def load(year, code):
    with open(os.path.join(ARCH, str(year), "municipality", code + ".json")) as f:
        return json.load(f)


def main():
    with open(os.path.join(ARCH, "2026", "municipalities.json")) as f:
        meta = json.load(f)
    codes = [m["code"] for m in meta]
    cur = {c: load(2026, c) for c in codes}
    cur_vd = {v: c for c, d in cur.items() for w in d["wards"].values() for v in w["vds"]}
    out = {"note": "Comparability of 2026 places with earlier local elections. See scripts/compare.py.", "baselines": {}}
    for year in (2021, 2016):
        old = {c: load(year, c) for c in codes}
        old_vd = {v: c for c, d in old.items() for v in d["vds"]}
        munics, wards = {}, {}
        for c in codes:
            moved_in = sum(1 for v, m in cur_vd.items() if m == c and v in old_vd and old_vd[v] != c)
            moved_out = sum(1 for v, m in old_vd.items() if m == c and v in cur_vd and cur_vd[v] != c)
            if moved_in or moved_out:
                munics[c] = {"ok": False, "reason": f"Boundary changed: {moved_in + moved_out} voting district{'s' if moved_in + moved_out > 1 else ''} moved to or from a neighbouring municipality"}
            else:
                munics[c] = {"ok": True}
            sets = {frozenset(w["vds"]): wid for wid, w in old[c]["wards"].items() if w["vds"]}
            wards[c] = {wid: sets[frozenset(w["vds"])] for wid, w in cur[c]["wards"].items()
                        if w["vds"] and frozenset(w["vds"]) in sets}
        # Province totals are comparable if no voting district crossed a province line.
        prov = {c: d for c, d in ((m["code"], m["province"]) for m in meta)}
        provs = {}
        for name in set(prov.values()):
            crossed = sum(1 for v, m in cur_vd.items() if v in old_vd and (prov[m] == name) != (prov[old_vd[v]] == name))
            provs[name] = {"ok": True} if not crossed else {"ok": False, "reason": f"{crossed} voting districts crossed the province boundary"}
        out["baselines"][str(year)] = {"munics": munics, "wards": wards, "provinces": provs}
        print(year, "municipalities comparable:", sum(m["ok"] for m in munics.values()), "of", len(codes),
              "| wards comparable:", sum(len(w) for w in wards.values()), "of", sum(len(d["wards"]) for d in cur.values()))
    with open(os.path.join(ARCH, "compare.json"), "w") as f:
        json.dump(out, f, separators=(",", ":"))

    with open(os.path.join(ROOT, "geo", "munics.json")) as f:
        geo = json.load(f)
    pts, byprov = {}, {}
    for ft in geo["features"]:
        p, g = ft["properties"], shape(ft["geometry"]).buffer(0)
        c = g.centroid
        pt = c if g.contains(c) else g.representative_point()
        pts[p["MunicCode"]] = [round(pt.x, 4), round(pt.y, 4)]
        byprov.setdefault(p["Province"], []).append(g)
    provs, outlines = {}, []
    for name, gs in byprov.items():
        u = unary_union(gs)
        outlines.append({"type": "Feature", "properties": {"Province": name},
                         "geometry": json.loads(json.dumps(u.simplify(0.003).boundary.__geo_interface__))})
        c = u.centroid
        pt = c if u.contains(c) else u.representative_point()
        provs[name] = [round(pt.x, 3), round(pt.y, 3)]
    with open(os.path.join(ROOT, "geo", "points.json"), "w") as f:
        json.dump({"munics": pts, "provinces": provs}, f, separators=(",", ":"))
    with open(os.path.join(ROOT, "geo", "provinces.json"), "w") as f:
        json.dump({"type": "FeatureCollection", "features": outlines}, f, separators=(",", ":"))
    print("points:", len(pts), "municipalities,", len(provs), "provinces")


if __name__ == "__main__":
    main()
