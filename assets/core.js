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
    {href: "shift.html", label: "The shift", key: "shift", ready: true},
    {href: "explore.html", label: "Every result", key: "explore", ready: true},
    {href: "votes.html", label: "Where votes changed", key: "votes", ready: true},
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
  // Change in share is in percentage points ("pts"), never "%".
  const fmtPP = (x, d = 1) => x == null ? "–" : (x > 0 ? "+" : x < 0 ? "−" : "±") + Math.abs(x).toFixed(d) + " pts";
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
    const st = m.status === "final" ? "Final results, as declared by the IEC" : "Provisional";
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

  // The visitor's own pin only (no default), so pages never preselect a place silently.
  async function pinnedOnly(){ let v = null; try{ v = localStorage.getItem("myMunic"); }catch(e){} if(!v) return null; const i = await munIndex(); return i.byId[v] || null; }

  // ---------- comparisons (shared by all three pages) ----------
  // data/archive/compare.json (scripts/compare.py) says which municipalities and wards can be compared
  // with 2021/2016: a municipality only if no voting district moved across its boundary, a ward only
  // if it has exactly the same voting districts as one earlier ward.
  const compareInfo = () => json("data/archive/compare.json");
  const points = () => json("geo/points.json");
  const BALLOT_LABEL = {pr: "Municipal PR ballot", ward: "Ward ballot"};
  // DA votes and valid votes on one ballot. Missing ballot or no valid votes -> null (missing is not zero).
  function daOf(unit, ballot){
    const b = unit && unit.ballots && unit.ballots[ballot];
    if(!b || !(b.valid > 0)) return null;
    return {d: b.votes[DA] || 0, v: b.valid, contested: DA in b.votes, share: 100 * (b.votes[DA] || 0) / b.valid};
  }
  // One comparison: both years, share change in pp, vote change as an integer. Never mixes ballots.
  function changeRow(cur, base, ballot){
    const a = daOf(base, ballot), b = daOf(cur, ballot);
    if(!a || !b) return null;
    return {d0: a.d, v0: a.v, s0: a.share, d1: b.d, v1: b.v, s1: b.share, dpp: b.share - a.share, dvotes: b.d - a.d};
  }
  // Leading party on one ballot, with its lead over the runner-up in pp. Ties are reported, not broken.
  function leader(unit, ballot){
    const b = unit && unit.ballots && unit.ballots[ballot]; if(!b || !(b.valid > 0)) return null;
    const r = Object.entries(b.votes).sort((x, y) => y[1] - x[1]);
    if(!r.length) return null;
    const s = v => 100 * v / b.valid;
    return {party: r[0][0], share: s(r[0][1]), runner: r[1] ? r[1][0] : null, lead: s(r[0][1]) - (r[1] ? s(r[1][1]) : 0),
      tie: !!(r[1] && r[1][1] === r[0][1])};
  }
  // Pool units (municipalities or wards): sum counts first, then divide. Any missing unit -> null.
  function pool(units, ballot){
    let d = 0, v = 0; for(const u of units){ const x = daOf(u, ballot); if(!x) return null; d += x.d; v += x.v; }
    return v > 0 ? {d, v, share: 100 * d / v} : null;
  }

  // ---------- CSV (safe for spreadsheets) ----------
  function csvCell(x){
    if(x == null) return "";
    if(typeof x === "number") return Number.isFinite(x) ? String(x) : "";
    let s = String(x);
    if(/^[=+\-@\t\r]/.test(s)) s = "'" + s;   // stop spreadsheets running text labels as formulas
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  function downloadCSV(name, header, rows){
    const text = [header, ...rows].map(r => r.map(csvCell).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], {type: "text/csv"})); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- search (municipalities and wards) ----------
  // items: [{label, sub, code, keys?}]. Exact name/code first, then prefix, then other matches.
  function searchItems(items, q, max = 8){
    q = q.trim().toLowerCase(); if(!q) return [];
    const out = [];
    for(const it of items){
      const l = it.label.toLowerCase(), c = (it.code || "").toLowerCase(), k = it.keys || "";
      let r = -1;
      if(l === q || c === q) r = 0; else if(l.startsWith(q) || c.startsWith(q)) r = 1;
      else if(k.startsWith(q) || l.includes(q)) r = 2; else if(q.split(/\s+/).every(t => (l + " " + c + " " + k).includes(t))) r = 3;
      if(r >= 0) out.push([r, it]);
    }
    return out.sort((a, b) => a[0] - b[0] || a[1].label.localeCompare(b[1].label)).slice(0, max).map(x => x[1]);
  }
  // Accessible combobox on an <input> and a <ul>: arrows move, Enter picks, Escape closes.
  function combobox(input, list, getItems, onPick, empty = "No matching municipality or ward"){
    let items = [], act = -1, t;
    input.setAttribute("role", "combobox"); input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false"); input.setAttribute("aria-controls", list.id); list.setAttribute("role", "listbox");
    list.hidden = true;
    const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); act = -1; };
    const draw = () => {
      list.innerHTML = items.length ? items.map((it, i) => `<li role="option" id="${list.id}-${i}" aria-selected="${i === act}"><b>${esc(it.label)}</b> <span>${esc(it.sub || "")}</span></li>`).join("")
        : `<li class="cb-empty">${empty}</li>`;
      list.hidden = false; input.setAttribute("aria-expanded", "true");
      if(act >= 0) input.setAttribute("aria-activedescendant", `${list.id}-${act}`);
      list.querySelectorAll("li[id]").forEach((li, i) => li.onmousedown = e => { e.preventDefault(); pick(i); });
    };
    const pick = i => { const it = items[i]; if(!it) return; close(); input.value = ""; onPick(it); };
    input.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { items = getItems(input.value); act = -1; input.value.trim() ? draw() : close(); }, 150); });
    input.addEventListener("keydown", e => {
      if(e.key === "ArrowDown" || e.key === "ArrowUp"){ if(!items.length) return; e.preventDefault(); act = (act + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length; draw(); }
      else if(e.key === "Enter"){ if(items.length){ e.preventDefault(); pick(act >= 0 ? act : 0); } }
      else if(e.key === "Escape") close();
    });
    input.addEventListener("blur", () => setTimeout(close, 120));
  }
  const wardNo = id => +String(id).slice(-3);   // IEC ward ids end in the 3-digit ward number
  const esc = s => String(s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
  function announce(msg){ const el = document.getElementById("announce"); if(el) el.textContent = msg; }
  // Province names as in the IEC boundary files, with their usual codes for links.
  const PROV = {"Eastern Cape": "EC", "Free State": "FS", "Gauteng": "GP", "KwaZulu-Natal": "KZN", "Limpopo": "LIM",
    "Mpumalanga": "MP", "North West": "NW", "Northern Cape": "NC", "Western Cape": "WC"};
  const provByCode = c => Object.keys(PROV).find(k => PROV[k] === c) || null;
  const prefersReduced =() => matchMedia("(prefers-reduced-motion: reduce)").matches;

  window.LGE = {PAGES, renderNav, DA, partyShort, partyColour, titleCase, fmtVotes, share, pooledShare, fmtPct, fmtPP, fmtDelta,
    parseIEC, fmtSAST, snapshot, statusLine, wardBaseline, munIndex, pinnedCode, pinCode, pinnedOnly,
    compareInfo, points, BALLOT_LABEL, daOf, changeRow, leader, pool, downloadCSV, csvCell, searchItems, combobox, wardNo, esc,
    announce, prefersReduced, json, PROV, provByCode};
})();
