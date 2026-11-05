"""Project the final result of a municipality from the voting districts counted so far.

Method (the same idea as the CSIR's model): group every voting district (VD) by how it voted in
2021, measure how each counted VD changed since 2021 (every party's share, and turnout), then give
each uncounted VD the change of a randomly drawn counted VD from its own group. Repeating that a
few thousand times gives a likely final share per party with a range.

Shares are "all ballots combined" (the IEC's TotalValidVotes), to match the rest of the site.
Usage: python3 scripts/project.py 3003 [more MunicIds]   (prints JSON)
"""
import json, os, random, sys, time, urllib.request
from collections import defaultdict

BASE = "https://results.elections.org.za/dashboards/lge/MapsJason/"
NOW, THEN = ("2026", "EEID1887"), ("2021", "EEID1091")
UA = {"User-Agent": "lge2026-results-dashboard"}
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "cache2021")
SIMS = 2000
MODEL_VERSION = "v1.1"   # bump when the method changes; older projections keep their version
DA = 52  # IEC party ID of the Democratic Alliance


def get(year_ev, mid, cache=False):
    path = os.path.join(CACHE, f"{mid}.json")
    if cache and os.path.exists(path):
        return vd_votes(json.load(open(path)))   # JSON keys come back as text
    url = f"{BASE}{year_ev[0]}/{year_ev[1]}Munic{mid}.js?rnd={int(time.time())}"
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
        d = json.loads(r.read().decode("utf-8-sig"))
    if cache:
        os.makedirs(CACHE, exist_ok=True)
        json.dump(vd_votes(d), open(path, "w"), separators=(",", ":"))
        return vd_votes(d)
    return d


def vd_votes(d):
    """{vd_id: {party_id: votes}} over all ballots; already-compact dicts pass through."""
    if "WardResults" not in d:
        return {int(k): {int(p): v for p, v in ps.items()} for k, ps in d.items()}
    out = {}
    for w in d["WardResults"]:
        for v in w.get("VotingDistrictResults", []):
            out[v["VotingDistrictID"]] = {p["ID"]: p.get("TotalValidVotes", 0) for p in v["PartyBallotResults"]}
    return out


def shares(votes):
    t = sum(votes.values())
    return ({k: x / t for k, x in votes.items()}, t) if t else ({}, 0)


def project(mid, names, seed=1):
    raw = get(NOW, mid)
    if "WardResults" in raw:   # party names straight from the IEC file
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import update
        for w in raw["WardResults"]:
            for p in w["PartyBallotResults"]:
                names.setdefault(p["ID"], update.short(p["Name"]))
    now, then = vd_votes(raw), get(THEN, mid, cache=True)
    counted = {k: v for k, v in now.items() if sum(v.values()) > 0}
    pending = [k for k in now if k not in counted]

    ANC = 7
    def group(s):  # 2021 profile: DA share and ANC share, each in 20-point bands
        return (min(int(s.get(DA, 0) * 5), 4), min(int(s.get(ANC, 0) * 5), 4))

    def pool_for(g):  # donors from the same group, else the nearest groups that have any
        if by_group.get(g):
            return by_group[g]
        for dist in range(1, 9):
            near = [d for (a, b), ds in by_group.items() if abs(a - g[0]) + abs(b - g[1]) == dist for d in ds]
            if near:
                return near
        return donors

    # change since 2021 for every counted VD that existed in 2021
    donors, by_group = [], defaultdict(list)
    for k, v in counted.items():
        if k not in then or not sum(then[k].values()):
            continue
        s0, t0 = shares(then[k]); s1, t1 = shares(v)
        d = {"delta": {p: s1.get(p, 0) - s0.get(p, 0) for p in set(s0) | set(s1)}, "turnout": t1 / t0}
        donors.append(d); by_group[group(s0)].append(d)

    base = defaultdict(float)
    for v in counted.values():
        for p, x in v.items():
            base[p] += x
    if not donors:
        return None

    pend_votes = [(sum(then[k].values()), group(shares(then[k])[0])) for k in pending if k in then and sum(then[k].values())]
    total_pend = sum(v for v, _ in pend_votes) or 1
    coverage = sum(v for v, g in pend_votes if len(by_group.get(g, [])) >= 5) / total_pend
    all_2021 = sum(sum(v.values()) for v in then.values()) or 1
    mostly_counted = total_pend / all_2021 < 0.10   # under a tenth of the 2021 vote left to estimate

    rng = random.Random(seed)
    med_votes = sorted(sum(v.values()) for v in counted.values())[len(counted) // 2]
    sims = []
    for _ in range(SIMS):
        tot = dict(base)
        for k in pending:
            if k in then and sum(then[k].values()):
                s0, t0 = shares(then[k])
                pool = pool_for(group(s0))
                d = rng.choice(pool)
                proj = {p: max(0.0, s0.get(p, 0) + d["delta"].get(p, 0)) for p in set(s0) | set(d["delta"])}
                n = sum(proj.values()) or 1
                votes = t0 * d["turnout"]
            else:  # new VD since 2021: borrow a counted VD's result outright
                proj, _ = shares(rng.choice(list(counted.values()))); n = 1; votes = med_votes
            for p, x in proj.items():
                tot[p] = tot.get(p, 0) + votes * x / n
        t = sum(tot.values())
        # Backtests on Joburg missed by up to ~1 point when a fifth of the vote was hidden, more than
        # donor resampling alone allows; add noise that grows with the share still uncounted.
        sd = 4.0 * (1 - sum(base.values()) / t)
        sims.append({p: max(0.0, 100 * x / t + rng.gauss(0, sd * (100 * x / t) ** 0.5 / 6)) for p, x in tot.items()})

    def band(p):
        xs = sorted(s.get(p, 0) for s in sims)
        return [round(xs[int(SIMS * q)], 1) for q in (0.05, 0.5, 0.95)]

    top = sorted(sims[0], key=lambda p: -sorted(s.get(p, 0) for s in sims)[SIMS // 2])[:5]
    cur, _ = shares(dict(base))
    return {
        "munic": mid, "vdCounted": len(counted), "vdTotal": len(now), "donors": len(donors),
        "votesCounted": int(sum(base.values())),
        "parties": [{"short": names.get(p, str(p)), "now": round(100 * cur.get(p, 0), 1), "proj": band(p)} for p in top],
        "coverage": round(coverage, 3), "reliable": coverage >= 0.9 or mostly_counted,
    }


METROS = {3003: "City of Johannesburg", 9006: "City of Cape Town", 4005: "eThekwini", 3004: "City of Tshwane",
          3002: "Ekurhuleni", 1001: "Nelson Mandela Bay", 1117: "Buffalo City", 2207: "Mangaung"}


def write_all():
    """Project every metro; save data/projections.json and append to data/projections_history.json."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import update
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
    latest = json.load(open(os.path.join(root, "latest.json")))
    hist_p = os.path.join(root, "projections_history.json")
    hist = json.load(open(hist_p)) if os.path.exists(hist_p) else []
    same = hist and hist[-1]["reportDate"] == latest["reportDate"]
    if same and "--force" not in sys.argv:
        print("projections unchanged"); return
    from datetime import datetime, timezone
    out = {"reportDate": latest["reportDate"], "modelVersion": MODEL_VERSION,
           "publishedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "metros": []}
    for mid, name in METROS.items():
        try:
            r = project(mid, {})
        except Exception as e:
            print("projection failed", mid, e, file=sys.stderr); continue
        if r:
            r["name"] = name
            out["metros"].append(r)
    update.write(os.path.join(root, "projections.json"), out)
    # evidence trail: what was published, when, from which IEC snapshot and model version
    if same:   # re-run on the same IEC snapshot (e.g. a model fix): refresh the file, keep one history entry
        hist.pop()
    hist.append({"reportDate": out["reportDate"], "publishedAt": out["publishedAt"], "modelVersion": MODEL_VERSION,
                 "metros": {str(r["munic"]): {
        "vdPct": round(100 * r["vdCounted"] / r["vdTotal"], 1), "reliable": r["reliable"], "coverage": r["coverage"],
        "parties": {p["short"]: [p["now"]] + p["proj"] for p in r["parties"][:4]}} for r in out["metros"]}})
    update.write(hist_p, hist)
    print("projections written", out["reportDate"], len(out["metros"]))


if __name__ == "__main__":
    if sys.argv[1:2] == ["--write"]:
        write_all(); sys.exit()
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import update
    nat = update.get(f"{NOW[1]}LiteMapsNational")
    names = {p["ID"]: update.short(p["Name"]) for p in nat["PartyBallotResults"]}
    for pr in nat["ProvinceResults"]:
        for m in pr["MunicipalityResults"]:
            for p in m["PartyBallotResults"]:
                names[p["ID"]] = update.short(p["Name"])
    print(json.dumps([project(int(m), names) for m in sys.argv[1:]], indent=1))
