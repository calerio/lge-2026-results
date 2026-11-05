"""Fetch the IEC's published LGE 2026 results and write compact files for the dashboard.

Reads the same JSON files the IEC's own results dashboard loads (no login needed):
  national/provinces/municipalities: MapsJason/2026/EEID1887LiteMapsNational.js
  wards (per municipality):          MapsJason/2026/EEID1887Munic<MunicId>.js

Writes:
  data/latest.json                  newest summary
  data/history/<stamp>.json + index past summaries (only when the IEC report time changes)
  data/wards/<MunicId>.json         ward leaders, refreshed only for municipalities that changed

Standard library only. Exit code 0 with "unchanged" when the IEC has nothing new.
"""
import json, os, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

BASE = "https://results.elections.org.za/dashboards/lge/MapsJason/2026/"
EEID = "EEID1887"
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
UA = {"User-Agent": "lge2026-results-dashboard (static GitHub Pages site)"}

SHORT = {
    "AFRICAN NATIONAL CONGRESS": "ANC", "DEMOCRATIC ALLIANCE": "DA", "UMKHONTO WESIZWE PARTY": "MK",
    "ECONOMIC FREEDOM FIGHTERS": "EFF", "INKATHA FREEDOM PARTY": "IFP", "PATRIOTIC ALLIANCE": "PA",
    "ACTIONSA": "ActionSA", "VRYHEIDSFRONT PLUS | FREEDOM FRONT PLUS": "FF+",
    "SOUTH AFRICAN COMMUNIST PARTY": "SACP", "OTHER": "Other", "IND": "Independent",
    "UNITED DEMOCRATIC MOVEMENT": "UDM", "AFRICAN CHRISTIAN DEMOCRATIC PARTY": "ACDP",
    "GOOD": "GOOD", "AL JAMA-AH": "Al Jama-ah", "BUILD ONE SOUTH AFRICA": "BOSA", "RISE MZANSI": "Rise Mzansi",
    "CAPE COLOURED CONGRESS": "CCC", "NATIONAL COLOURED CONGRESS": "NCC",
}

def short(name):
    if name in SHORT: return SHORT[name]
    words = [w for w in name.replace("|", " ").split() if w.isalpha()]
    return "".join(w[0] for w in words if w not in ("OF", "THE", "AND", "FOR"))[:6] or name[:6]

def get(name, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(f"{BASE}{name}.js?rnd={int(time.time())}", headers=UA)
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode("utf-8-sig"))
        except Exception as e:
            if i == tries - 1: raise
            time.sleep(5 * (i + 1))

def progress(o):
    return {"vd": o.get("VDsComplete", 0), "vdTotal": o.get("VDExpected", 0),
            "councilsDone": o.get("MuncipalitiesComplete", 0), "councilsTotal": o.get("MunicExpected", 0),
            "hung": o.get("HungCouncils", 0), "majority": o.get("MajorityCouncils", 0),
            "seats": o.get("SeatsComplete", 0), "seatsTotal": o.get("SeatsExpected", 0),
            "registered": o.get("RegPop", 0), "reportDate": o.get("ReportDate")}

def parties(lst):
    out = [{"id": p["ID"], "name": p["Name"].title(), "short": short(p["Name"]), "pct": p["PercOfVotes"],
            "votes": p["TotalValidVotes"], "seats": p.get("TotalSeatsWon", 0), "councils": p.get("CouncilsWon", 0),
            "majorities": p.get("MajorityWon", 0)} for p in lst]
    return sorted(out, key=lambda p: (p["short"] == "Other", -p["pct"]))

def cast(lst):
    p = lst[0] if lst else {}
    return {"cast": p.get("TotalVotesCast", 0), "valid": p.get("ValidVotesCast", 0),
            "spoilt": p.get("SpoiltVotes", 0), "registered": p.get("RegisteredVoters", 0)}

def summarise(nat):
    s = {"reportDate": nat["ReportDate"], "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
         "national": {**progress(nat), **cast(nat["PartyBallotResults"]), "parties": parties(nat["PartyBallotResults"])},
         "provinces": [], "munics": {}}
    for pr in nat["ProvinceResults"]:
        s["provinces"].append({"id": pr["ProvinceID"], "name": pr["Province"], **progress(pr),
                               "parties": parties(pr["PartyBallotResults"])})
        for m in pr["MunicipalityResults"]:
            ps = parties(m["PartyBallotResults"])
            code, _, nm = m["Municipality"].partition(" - ")
            winner = next((p["Name"] for p in m["PartyBallotResults"] if p.get("IsCouncilWinner")), None)
            s["munics"][str(m["MunicipalityID"])] = {
                "code": code, "name": nm or code, "prov": pr["Province"],
                "vdPct": m.get("Perc_VDsComplete", 0), "vd": m.get("VDsComplete", 0), "vdTotal": m.get("VDExpected", 0),
                "seats": m.get("SeatsComplete", 0), "seatsTotal": m.get("SeatsExpected", 0),
                "done": m.get("MuncipalitiesComplete", 0) > 0, "hung": m.get("HungCouncils", 0) > 0,
                "winner": short(winner) if winner else None,
                "parties": [[p["short"], p["pct"], p["seats"]] for p in ps if p["short"] != "Other"][:4],
                "reportDate": m.get("ReportDate")}
    return s

def ward_summary(mid):
    d = get(f"{EEID}Munic{mid}")
    out = {}
    for w in d.get("WardResults", []):
        votes = sorted(((p["WardVotes"], short(p["Name"])) for p in w["PartyBallotResults"]), reverse=True)
        total = sum(v for v, _ in votes) or 0
        vds = w.get("VotingDistrictResults", [])
        counted = sum(1 for v in vds if any(p.get("TotalValidVotes", 0) for p in v.get("PartyBallotResults", [])))
        top = [[n, round(100 * v / total, 1), v] for v, n in votes[:3] if v] if total else []
        out[str(w["WardID"])] = {"top": top, "votes": total, "vd": counted, "vdTotal": len(vds)}
    return out

def write(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f: json.dump(obj, f, separators=(",", ":"))
    os.replace(tmp, path)

def main():
    nat = get(f"{EEID}LiteMapsNational")
    latest_p = os.path.join(ROOT, "latest.json")
    prev = json.load(open(latest_p)) if os.path.exists(latest_p) else None
    s = summarise(nat)
    if prev and prev["reportDate"] == s["reportDate"]:
        print("unchanged", s["reportDate"]); return

    # Wards: refetch only municipalities whose IEC report time moved (or that we have never fetched).
    changed = [mid for mid, m in s["munics"].items()
               if not prev or prev["munics"].get(mid, {}).get("reportDate") != m["reportDate"]
               or not os.path.exists(os.path.join(ROOT, "wards", f"{mid}.json"))]
    geo_p = os.path.join(ROOT, "..", "geo", "munics.json")
    if os.path.exists(geo_p):  # municipalities that have not reported yet still get their ward file
        ids = {str(f["properties"]["MunicId"]) for f in json.load(open(geo_p))["features"]}
        changed += [i for i in ids - set(s["munics"]) if not os.path.exists(os.path.join(ROOT, "wards", f"{i}.json"))]
    if "--no-wards" not in sys.argv:
        with ThreadPoolExecutor(6) as ex:
            for mid, res in zip(changed, ex.map(lambda m: _safe(ward_summary, m), changed)):
                if res is not None: write(os.path.join(ROOT, "wards", f"{mid}.json"), res)

    write(latest_p, s)
    stamp = s["reportDate"][:19].replace(":", "").replace("-", "")
    hist = {k: v for k, v in s.items() if k != "munics"}
    hist["munics"] = {k: [m["parties"][0][0] if m["parties"] else None, m["parties"][0][1] if m["parties"] else 0, m["vdPct"]]
                      for k, m in s["munics"].items()}
    write(os.path.join(ROOT, "history", f"{stamp}.json"), hist)
    idx_p = os.path.join(ROOT, "history", "index.json")
    idx = json.load(open(idx_p)) if os.path.exists(idx_p) else []
    n = s["national"]
    idx.append({"file": f"{stamp}.json", "reportDate": s["reportDate"], "vdPct": round(100 * n["vd"] / max(n["vdTotal"], 1), 1),
                "parties": {p["short"]: p["pct"] for p in n["parties"][:8]}})
    write(idx_p, idx)
    print("updated", s["reportDate"], f"wards refreshed: {len(changed)}")

def _safe(fn, arg):
    try: return fn(arg)
    except Exception as e:
        print("ward fetch failed", arg, e, file=sys.stderr); return None

if __name__ == "__main__":
    main()
