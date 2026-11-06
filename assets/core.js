// Shared helpers for the post-election pages (The shift, Every result, Where votes changed).
// Data: data/archive/<year>/{manifest,municipalities}.json and municipality/<code>.json, built by
// scripts/archive.py from the IEC's official per-voting-district results files.
(function(){
  const BASE = "data/archive/";

  // ---------- pages / navigation ----------
  // Pages listed here appear in the shared navigation. "ready: false" keeps a page out of the nav
  // until it is finished, while its URL still works for testing.
  const PAGES = [
    {href: "./", label: "Live results", key: "live", ready: true},
    {href: "predictions.html", label: "Predictions", key: "predictions", ready: true},
    {href: "shift.html", label: "The shift", key: "shift", ready: false},
    {href: "explore.html", label: "Every result", key: "explore", ready: false},
    {href: "votes.html", label: "Where votes changed", key: "votes", ready: false},
  ];
  function renderNav(el, current){
    if(!el) return;
    el.innerHTML = PAGES.filter(p => p.ready || p.key === current)
      .map(p => `<a href="${p.href}"${p.key === current ? ' aria-current="page"' : ""}>${p.label}</a>`).join("");
  }

  // ---------- parties ----------
  // Official IEC names -> short label and colour. Matching is by exact official name, never fuzzy.
  const PARTY = {
    "AFRICAN NATIONAL CONGRESS": ["ANC", "#1f9d55"], "DEMOCRATIC ALLIANCE": ["DA", "#2f6fdf"],
    "UMKHONTO WESIZWE PARTY": ["MK", "#4d8a6a"], "ECONOMIC FREEDOM FIGHTERS": ["EFF", "#c8323a"],
    "INKATHA FREEDOM PARTY": ["IFP", "#e07b22"], "PATRIOTIC ALLIANCE": ["PA", "#7a3fb0"], "ACTIONSA": ["ActionSA", "#38b6c9"],
    "VRYHEIDSFRONT PLUS | FREEDOM FRONT PLUS": ["FF+", "#f2a640"], "VRYHEIDSFRONT PLUS": ["FF+", "#f2a640"],
    "SOUTH AFRICAN COMMUNIST PARTY": ["SACP", "#b5121b"], "UNITED DEMOCRATIC MOVEMENT": ["UDM", "#d4b200"],
    "AFRICAN CHRISTIAN DEMOCRATIC PARTY": ["ACDP", "#2f9fb0"], "GOOD": ["GOOD", "#e95d24"], "BUILD ONE SOUTH AFRICA": ["BOSA", "#6a8cff"],
    "RISE MZANSI": ["Rise Mzansi", "#8c5bd6"], "AL JAMA-AH": ["Al Jama-ah", "#3f7f4f"], "CAPE COLOURED CONGRESS": ["CCC", "#9c6b3d"],
    "NATIONAL COLOURED CONGRESS": ["NCC", "#b0805a"], "CONGRESS OF THE PEOPLE": ["COPE", "#f0c419"],
  };
  const DA = "DEMOCRATIC ALLIANCE";
  const partyShort = n => (PARTY[n] || [])[0] || n.split(/\s+/).map(w => w[0]).join("").slice(0, 6);
  const partyColour = n => (PARTY[n] || [])[1] || "#8a8f86";
  const titleCase = s => s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());

  // ---------- numbers ----------
  const nf = new Intl.NumberFormat("en-ZA");
  const fmtVotes = n => nf.format(Math.round(n));
  // Pooled share: always sum votes first, then divide. Returns null when the denominator is missing.
  function share(votes, valid){ return valid > 0 && votes != null ? 100 * votes / valid : null; }
  function pooledShare(units, party, ballot = "pr"){
    let v = 0, t = 0;
    for(const u of units){ const b = u.ballots && u.ballots[ballot]; if(!b) return null; v += b.votes[party] || 0; t += b.valid; }
    return share(v, t);
  }
  const fmtPct = (x, d = 1) => x == null ? "–" : x.toFixed(d) + "%";
  // Change in share is in percentage points, never "%".
  const fmtPP = (x, d = 1) => x == null ? "–" : (x > 0 ? "+" : x < 0 ? "−" : "±") + Math.abs(x).toFixed(d) + " pp";
  const fmtDelta = x => x == null ? "–" : (x > 0 ? "+" : x < 0 ? "−" : "±") + fmtVotes(Math.abs(x));

  // ---------- time (SAST) ----------
  // The IEC writes DateGenerated as "11/6/2026 9:44:46 AM" in South African time (month/day/year).
  function parseIEC(s){
    const m = /^(\d+)\/(\d+)\/(\d{4}) (\d+):(\d+):(\d+) (AM|PM)$/.exec(s || ""); if(!m) return null;
    let h = +m[4] % 12; if(m[7] === "PM") h += 12;
    return new Date(Date.UTC(+m[3], +m[1] - 1, +m[2], h - 2, +m[5], +m[6]));   // SAST = UTC+2, no DST
  }
  const fmtSAST = d => d ? d.toLocaleString("en-ZA", {day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Johannesburg"}) + " SAST" : "–";

  // ---------- data loading (one pinned snapshot per page) ----------
  const cache = {};
  async function json(url){ if(!cache[url]) cache[url] = fetch(url).then(r => { if(!r.ok) throw new Error(url + " " + r.status); return r.json(); }); return cache[url]; }
  async function manifest(year){ return json(`${BASE}${year}/manifest.json?t=${Math.floor(Date.now() / 300000)}`); }
  async function snapshot(year){
    const m = await manifest(year);
    const pin = `?s=${m.snapshot}`;   // every file of this page view comes from the same snapshot
    return {manifest: m, generated: parseIEC(m.sourceGenerated),
      municipalities: () => json(`${BASE}${year}/municipalities.json${pin}`),
      municipality: code => json(`${BASE}${year}/municipality/${encodeURIComponent(code)}.json${pin}`)};
  }
  function statusLine(m, ballot = "Municipal party-list (PR) ballot"){
    const st = m.status === "final" ? "Final, as declared by the IEC" : "Provisional";
    return `${ballot} · ${m.year} · ${st} · IEC data as of ${fmtSAST(parseIEC(m.sourceGenerated))}`;
  }

  // ---------- comparable geography ----------
  // A 2026 ward is compared with an earlier year only through the same voting districts: the earlier
  // year's official votes from exactly those districts, summed. If any district is missing from the
  // earlier year, there is no comparison (missing is not zero).
  function wardBaseline(ward2026, earlier){
    const vds = ward2026.vds || [];
    if(!vds.length || !vds.every(v => earlier.vds[v])) return {comparable: false, reason: vds.length ? "boundaries changed" : "no districts"};
    const out = {};
    for(const v of vds){
      for(const [b, vb] of Object.entries(earlier.vds[v].ballots)){
        const t = out[b] || (out[b] = {valid: 0, spoilt: 0, votes: {}});
        t.valid += vb.valid || Object.values(vb.votes).reduce((a, c) => a + c, 0); t.spoilt += vb.spoilt || 0;
        for(const [p, x] of Object.entries(vb.votes)) t.votes[p] = (t.votes[p] || 0) + x;
      }
    }
    return {comparable: true, ballots: out, vds: vds.length};
  }

  // ---------- pinned municipality (shared with the live page) ----------
  // The live page stores the IEC MunicId; these pages use municipality codes. geo/munics.json maps them.
  let geoIdx = null;
  async function munIndex(){
    if(!geoIdx){ const g = await json("geo/munics.json"); geoIdx = {byId: {}, byCode: {}};
      for(const f of g.features){ const p = f.properties; geoIdx.byId[p.MunicId] = p.MunicCode; geoIdx.byCode[p.MunicCode] = p.MunicId; } }
    return geoIdx;
  }
  async function pinnedCode(){ const i = await munIndex(); return i.byId[localStorage.getItem("myMunic") || "9911"] || "WC024"; }
  async function pinCode(code){ const i = await munIndex(); if(i.byCode[code]) localStorage.setItem("myMunic", String(i.byCode[code])); }

  window.LGE = {PAGES, renderNav, DA, partyShort, partyColour, titleCase, fmtVotes, share, pooledShare, fmtPct, fmtPP, fmtDelta,
    parseIEC, fmtSAST, snapshot, statusLine, wardBaseline, munIndex, pinnedCode, pinCode};
})();
