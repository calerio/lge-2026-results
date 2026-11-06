"""Build the static results archive used by the post-election pages (The shift, Every result,
Where votes changed) from the IEC's official "Downloadable detailed results" files.

Source: https://results.elections.org.za/home/LGEPublicReports/<event>/Downloadable Party Results/<prov>.csv
One row per voting district x ballot type (PR / Ward / DC 40%) x party, with registered voters and
spoilt votes. Events: 2026 = 1887, 2021 = 1091, 2016 = 402.

Writes, per year, under data/archive/<year>/:
  manifest.json            source time (the IEC's DateGenerated), fetch time, status, snapshot id
  municipalities.json      per municipality: totals by ballot (valid, spoilt, registered) and party votes
  municipality/<code>.json per ward and per voting district: votes by ballot and party
and data/archive/parties.json: one entry per party name seen in any year (stable keys, colours).

Votes are never estimated or redistributed; a missing row stays missing. Shares are computed by the
pages from these counts (pooled sums, never averages of percentages).

Usage: python3 scripts/archive.py 2021 2016      (historical, once)
       python3 scripts/archive.py 2026           (current; re-run while the count changes)
Raw CSVs are cached in data/raw/ (gitignored).
"""
import csv, hashlib, io, json, os, re, sys, time, urllib.parse, urllib.request
from collections import defaultdict
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "data")
RAW = os.path.join(ROOT, "raw")
OUT = os.path.join(ROOT, "archive")
EVENTS = {"2026": "1887", "2021": "1091", "2016": "402"}
PROVINCES = ["EC", "FS", "GP", "KN", "NP", "MP", "NW", "NC", "WP"]
BASE = "https://results.elections.org.za/home/LGEPublicReports/{ev}/Downloadable%20Party%20Results/{p}.csv"
UA = {"User-Agent": "lge2026-results-dashboard"}
BALLOTS = {"PR": "pr", "WARD": "ward", "DC 40%": "dc", "DC40%": "dc", "DC": "dc"}


def last_modified(year, prov):
    url = BASE.format(ev=EVENTS[year], p=prov)
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA, method="HEAD"), timeout=60) as r:
        return r.headers.get("Last-Modified", "")


def fetch(year, prov, refresh):
    os.makedirs(RAW, exist_ok=True)
    path = os.path.join(RAW, f"{year}_{prov}.csv")
    stamp = path + ".lastmod"
    if refresh and os.path.exists(path) and os.path.exists(stamp):
        try:   # only download when the IEC's copy has changed
            if open(stamp).read() == last_modified(year, prov):
                return path
        except Exception:
            return path
    if refresh or not os.path.exists(path):
        url = BASE.format(ev=EVENTS[year], p=prov)
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=600) as r, open(path + ".tmp", "wb") as f:
            while chunk := r.read(1 << 20):
                f.write(chunk)
        os.replace(path + ".tmp", path)
        try:
            open(stamp, "w").write(last_modified(year, prov))
        except Exception:
            pass
    return path


def refresh_current(min_minutes=60):
    """Called by the 5-minute loop: rebuild the 2026 archive when any province file changed,
    at most once per min_minutes. Returns True when it rebuilt."""
    man = os.path.join(OUT, "2026", "manifest.json")
    if os.path.exists(man) and os.path.exists(os.path.join(OUT, "2026", "FINAL")):
        return False
    if os.path.exists(man) and time.time() - os.path.getmtime(man) < min_minutes * 60:
        return False
    changed = False
    for prov in PROVINCES:
        stamp = os.path.join(RAW, f"2026_{prov}.csv.lastmod")
        try:
            lm = last_modified("2026", prov)
        except Exception:
            continue
        if not os.path.exists(stamp) or open(stamp).read() != lm:
            changed = True; break
    if changed:
        build("2026", refresh=True)
    else:
        os.utime(man)   # checked; nothing new
    return changed


def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def build(year, refresh=False):
    t0 = time.time()
    munis = {}          # code -> record
    detail = {}         # code -> {"wards": {...}, "vds": {...}}
    parties = set(); generated = set()
    for prov in PROVINCES:
        path = fetch(year, prov, refresh and year == "2026")
        with open(path, encoding="utf-8-sig", newline="") as f:
            for row in csv.DictReader(f):
                ballot = BALLOTS.get(row["BallotType"].strip().upper())
                if not ballot:
                    continue
                code, _, mname = row["Municipality"].partition(" - ")
                ward = row["Ward"].replace("Ward", "").strip()
                vd = row["VotingDistrict"].strip()
                party = row["PartyName"].strip()
                votes = int(row["TotalValidVotes"] or 0)
                parties.add(party); generated.add(row.get("DateGenerated", "").strip())
                m = munis.setdefault(code, {"code": code, "name": mname, "province": row["Province"], "ballots": {}})
                d = detail.setdefault(code, {"wards": {}, "vds": {}})
                v = d["vds"].setdefault(vd, {"ward": ward, "station": row["VotingStationName"], "registered": int(row["RegisteredVoters"] or 0), "ballots": {}})
                vb = v["ballots"].setdefault(ballot, {"spoilt": int(row["SpoiltVotes"] or 0), "votes": {}})
                if votes:
                    vb["votes"][party] = vb["votes"].get(party, 0) + votes
    # roll voting districts up to wards and municipalities (sums of official counts only)
    for code, d in detail.items():
        m = munis[code]
        for vd, v in d["vds"].items():
            w = d["wards"].setdefault(v["ward"], {"vds": [], "registered": 0, "ballots": {}})
            w["vds"].append(vd); w["registered"] += v["registered"]
            m["registered"] = m.get("registered", 0) + v["registered"]
            for b, vb in v["ballots"].items():
                for target in (w["ballots"].setdefault(b, {"spoilt": 0, "valid": 0, "votes": {}}),
                               m["ballots"].setdefault(b, {"spoilt": 0, "valid": 0, "votes": {}})):
                    target["spoilt"] += vb["spoilt"]
                    for p, x in vb["votes"].items():
                        target["votes"][p] = target["votes"].get(p, 0) + x
                        target["valid"] += x
                vb["valid"] = sum(vb["votes"].values())
        m["wards"] = len(d["wards"]); m["vds"] = len(d["vds"])
        m["vdsReporting"] = sum(1 for v in d["vds"].values() if any(vb["votes"] for vb in v["ballots"].values()))

    ydir = os.path.join(OUT, year); mdir = os.path.join(ydir, "municipality")
    os.makedirs(mdir, exist_ok=True)

    def dump(path, obj):
        tmp = path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(obj, f, separators=(",", ":"), ensure_ascii=False)
        os.replace(tmp, path)

    for code, d in detail.items():
        dump(os.path.join(mdir, f"{code}.json"), {"code": code, "name": munis[code]["name"], "year": int(year), **d})
    dump(os.path.join(ydir, "municipalities.json"), sorted(munis.values(), key=lambda m: m["code"]))

    gen = sorted(g for g in generated if g)
    snapshot = hashlib.sha1(json.dumps(sorted((c, m["vdsReporting"], m["ballots"].get("pr", {}).get("valid", 0)) for c, m in munis.items())).encode()).hexdigest()[:12]
    final_flag = os.path.join(ydir, "FINAL")   # created by hand once the IEC declares the results
    manifest = {"year": int(year), "event": EVENTS[year], "source": "IEC Downloadable detailed results (per province CSV)",
                "sourceGenerated": gen[-1] if gen else None, "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "status": "final" if year != "2026" or os.path.exists(final_flag) else "provisional",
                "snapshot": snapshot, "municipalities": len(munis),
                "vds": sum(m["vds"] for m in munis.values()), "vdsReporting": sum(m["vdsReporting"] for m in munis.values())}
    dump(os.path.join(ydir, "manifest.json"), manifest)

    # canonical party list across years: keyed by a slug of the official name
    ppath = os.path.join(OUT, "parties.json")
    allp = json.load(open(ppath)) if os.path.exists(ppath) else {}
    for p in parties:
        e = allp.setdefault(slug(p), {"name": p, "years": []})
        if int(year) not in e["years"]:
            e["years"] = sorted(e["years"] + [int(year)])
    dump(ppath, allp)
    print(f"{year}: {len(munis)} municipalities, {manifest['vds']} voting districts "
          f"({manifest['vdsReporting']} reporting), {len(parties)} parties, source {manifest['sourceGenerated']}, {time.time() - t0:.0f}s")


if __name__ == "__main__":
    if sys.argv[1:] == ["--refresh-current"]:
        refresh_current(); sys.exit()
    for y in sys.argv[1:] or ["2021", "2016", "2026"]:
        build(y, refresh=True)
