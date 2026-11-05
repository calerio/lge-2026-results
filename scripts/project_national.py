"""National projection: the metro method (scripts/project.py) applied to all ~23,700 voting districts.

Groups are (province, 2021 DA band, 2021 ANC band); an uncounted district borrows the change since
2021 of a counted district from its own group, else the nearest group in its province, else the
nearest group nationally. Vectorised with numpy so a few hundred simulations take seconds.

Run with:  uv run --with numpy python scripts/project_national.py [--write]
Inputs (gitignored, kept fresh by scripts/update.py): data/cache2026/<MunicId>.json, data/cache2021/<MunicId>.json
"""
import json, os, sys, time
from collections import defaultdict
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
DA, ANC = 52, 7
SIMS = 600
MODEL_VERSION = "v1.1-national"


def _int_keys(d):
    return {int(k): {int(p): v for p, v in ps.items()} for k, ps in d.items()}


def load_inputs():
    now, then, prov = {}, {}, {}
    for f in os.listdir(os.path.join(DATA, "cache2026")):
        mid = int(f[:-5]); d = json.load(open(os.path.join(DATA, "cache2026", f)))
        now[mid] = _int_keys(d["vd"]); prov[mid] = d.get("prov") or 0
        p21 = os.path.join(DATA, "cache2021", f)
        then[mid] = _int_keys(json.load(open(p21))) if os.path.exists(p21) else {}
    return now, then, prov


def project_national(now, then, prov, sims=SIMS, seed=1):
    # party columns: the 30 biggest parties across both elections, the rest pooled
    totals = defaultdict(float)
    for src in (now, then):
        for vds in src.values():
            for v in vds.values():
                for p, x in v.items():
                    totals[p] += x
    parties = [p for p, _ in sorted(totals.items(), key=lambda t: -t[1])[:30]]
    col = {p: i for i, p in enumerate(parties)}; P = len(parties) + 1

    def vec(v):
        a = np.zeros(P)
        for p, x in v.items():
            a[col.get(p, P - 1)] += x
        return a

    counted_sum = np.zeros(P)
    donors_delta, donors_turn, donor_key = [], [], []
    pend_base, pend_votes, pend_key, new_vds = [], [], [], []
    for mid, vds in now.items():
        old = then.get(mid, {})
        for k, v in vds.items():
            a = vec(v); t = a.sum()
            o = old.get(k); ob = vec(o) if o else None
            ot = ob.sum() if ob is not None else 0
            key = None
            if ot:
                s0 = ob / ot
                key = (prov[mid], min(int(s0[col[DA]] * 5), 4), min(int(s0[col[ANC]] * 5), 4))
            if t > 0:
                counted_sum += a
                if ot:
                    donors_delta.append(a / t - s0); donors_turn.append(t / ot); donor_key.append(key)
            elif ot:
                pend_base.append(s0); pend_votes.append(ot); pend_key.append(key)
            else:
                new_vds.append(mid)
    if not donors_delta:
        return None
    D = np.array(donors_delta); TR = np.array(donors_turn)
    by_key = defaultdict(list)
    for i, k in enumerate(donor_key):
        by_key[k].append(i)
    by_key = {k: np.array(v) for k, v in by_key.items()}

    def pool(key):
        if key in by_key and len(by_key[key]) >= 1:
            return by_key[key]
        pr, a, b = key
        for dist in range(1, 9):   # nearest group in the same province, then anywhere
            for same_prov in (True, False):
                near = [i for (p2, a2, b2), ids in by_key.items() if (p2 == pr) == same_prov and abs(a2 - a) + abs(b2 - b) == dist for i in ids]
                if near:
                    return np.array(near)
        return np.arange(len(D))

    groups = defaultdict(list)
    for i, k in enumerate(pend_key):
        groups[k].append(i)
    pools = {k: pool(k) for k in groups}
    B = np.array(pend_base) if pend_base else np.zeros((0, P)); V = np.array(pend_votes) if pend_votes else np.zeros(0)
    coverage = sum(V[idx].sum() for k, idx in groups.items() if k in by_key and len(by_key[k]) >= 5) / (V.sum() or 1)

    # uncounted new districts: an average counted district's result and size
    mean_share = counted_sum / counted_sum.sum()
    new_votes = len(new_vds) * (counted_sum.sum() / max(1, len(D)))

    rng = np.random.default_rng(seed)
    out = np.zeros((sims, P))
    for s in range(sims):
        tot = counted_sum.copy() + new_votes * mean_share
        for k, idx in groups.items():
            d = rng.choice(pools[k], size=len(idx))
            sh = np.clip(B[idx] + D[d], 0, None)
            sh /= sh.sum(axis=1, keepdims=True).clip(1e-9)
            tot += (sh * (V[idx] * TR[d])[:, None]).sum(axis=0)
        pct = 100 * tot / tot.sum()
        sd = 4.0 * (1 - counted_sum.sum() / tot.sum())
        out[s] = np.clip(pct + rng.normal(0, 1, P) * sd * np.sqrt(pct) / 6, 0, None)
    lo, md, hi = np.percentile(out, [5, 50, 95], axis=0)
    now_pct = 100 * counted_sum / counted_sum.sum()
    order = np.argsort(-md)
    res = [{"id": parties[i] if i < len(parties) else None, "now": round(float(now_pct[i]), 1),
            "proj": [round(float(lo[i]), 1), round(float(md[i]), 1), round(float(hi[i]), 1)]} for i in order[:8] if i < len(parties)]
    vd_total = sum(len(v) for v in now.values())
    vd_counted = sum(1 for v in now.values() for x in v.values() if sum(x.values()) > 0)
    left = V.sum() / max(1.0, sum(sum(x.values()) for vds in then.values() for x in vds.values()))
    return {"parties": res, "coverage": round(float(coverage), 3), "reliable": bool(coverage >= 0.9 or left < 0.10),
            "vdCounted": vd_counted, "vdTotal": vd_total}


def write():
    from datetime import datetime, timezone
    sys.path.insert(0, HERE)
    import update
    t0 = time.time()
    latest = json.load(open(os.path.join(DATA, "latest.json")))
    cur = os.path.join(DATA, "projection_national.json")
    if "--force" not in sys.argv and os.path.exists(cur) and json.load(open(cur)).get("reportDate") == latest["reportDate"]:
        print("national projection unchanged"); return
    now, then, prov = load_inputs()
    names = {p["id"]: p["short"] for p in latest["national"]["parties"]}
    for m in latest["munics"].values():
        pass
    r = project_national(now, then, prov)
    if not r:
        print("national: no data"); return
    for p in r["parties"]:
        p["short"] = names.get(p.pop("id"), "Other")
    r.update(reportDate=latest["reportDate"], modelVersion=MODEL_VERSION, seconds=round(time.time() - t0, 1),
             publishedAt=datetime.now(timezone.utc).isoformat(timespec="seconds"), munics=len(now))
    update.write(os.path.join(DATA, "projection_national.json"), r)
    hp = os.path.join(DATA, "projection_national_history.json")
    hist = json.load(open(hp)) if os.path.exists(hp) else []
    if not hist or hist[-1]["reportDate"] != r["reportDate"]:
        hist.append({k: r[k] for k in ("reportDate", "publishedAt", "modelVersion", "coverage", "reliable", "vdCounted", "vdTotal", "parties")})
        update.write(hp, hist)
    print("national projection", r["reportDate"][:16], f"{r['seconds']}s", "coverage", r["coverage"],
          " | ".join(f"{p['short']} {p['now']}→{p['proj'][1]}" for p in r["parties"][:4]))


if __name__ == "__main__":
    write()
