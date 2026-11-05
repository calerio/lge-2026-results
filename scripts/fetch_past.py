"""One-off: save the final results of the 2021 and 2016 local elections from the IEC's archive
to data/past.json (national party shares + top three parties per municipality). Run once; the
files never change, so the site reads them from GitHub instead of Cloudflare."""
import json, os, urllib.request

BASE = "https://results.elections.org.za/dashboards/lge/MapsJason/"
EVENTS = {"2021": "EEID1091", "2016": "EEID402"}
NOW = "EEID1887"  # 2026, used only to look up party names by ID
UA = {"User-Agent": "lge2026-results-dashboard"}
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")

def get(path):
    with urllib.request.urlopen(urllib.request.Request(BASE + path, headers=UA), timeout=60) as r:
        return json.loads(r.read().decode("utf-8-sig"))

import importlib.util
spec = importlib.util.spec_from_file_location("upd", os.path.join(ROOT, "scripts", "update.py"))
upd = importlib.util.module_from_spec(spec); spec.loader.exec_module(upd)

names = {}
cur = get(f"2026/{NOW}LiteMapsNational.js")
for p in cur["PartyBallotResults"]: names[p["ID"]] = p["Name"]
for pid in range(1, 10):
    try:
        for m in get(f"2026/{NOW}Province{pid}.js")["MunicipalityResults"]:
            for p in m["PartyBallotResults"]: names[p["ID"]] = p["Name"]
    except Exception: pass

def label(pid): return upd.short(names[pid]) if pid in names else None

out = {}
for year, ev in EVENTS.items():
    nat = get(f"{year}/{ev}LiteMapsNational.js")
    y = {"national": {}, "munics": {}}
    for p in nat["PartyBallotResults"]:
        k = label(p["ID"])
        if k and k != "Other": y["national"][k] = p["PercOfVotes"]
    for pr in nat["ProvinceResults"]:
        try: prov = {m["MunicipalityID"]: m for m in get(f"{year}/{ev}Province{pr['ProvinceID']}.js")["MunicipalityResults"]}
        except Exception: prov = {}
        for m in pr["MunicipalityResults"]:
            src = prov.get(m["MunicipalityID"], m)
            ps = sorted(src["PartyBallotResults"], key=lambda p: -p["PercOfVotes"])
            y["munics"][str(m["MunicipalityID"])] = [[label(p["ID"]) or "Other", p["PercOfVotes"]] for p in ps if label(p["ID"]) not in (None, "Other")][:3]
    out[year] = y
    print(year, "national parties:", len(y["national"]), "municipalities:", len(y["munics"]))

with open(os.path.join(ROOT, "data", "past.json"), "w") as f: json.dump(out, f, separators=(",", ":"))
