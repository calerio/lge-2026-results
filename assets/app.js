// LGE 2026 dashboard. Reads data/latest.json (refreshed by a scheduled GitHub Action),
// data/history/*.json for the time machine, and data/wards/<MunicId>.json for ward drill-down.
const COL = {ANC:"#1f9d55",DA:"#2f6fdf",MK:"#4d8a6a",EFF:"#c8323a",ActionSA:"#38b6c9",PA:"#7a3fb0",IFP:"#e07b22",
  "FF+":"#f2a640",SACP:"#b5121b",UDM:"#d4b200",ACDP:"#2f9fb0",GOOD:"#e95d24",BOSA:"#6a8cff",Independent:"#c9c9c9",Other:"#5c6157"};
const col = p => COL[p] || "#9aa093";
const inkOn = c => { const h = c.replace("#",""), [r,g,b] = [0,2,4].map(i => parseInt(h.substr(i,2),16)/255).map(v => v <= .03928 ? v/12.92 : ((v+.055)/1.055)**2.4); return .2126*r+.7152*g+.0722*b > .45 ? "#16181d" : "#fff"; };
const sw = p => `<i class="sw" style="background:${col(p)}"></i>`;
const NOCOUNT = "#cfc8b8";
const $ = id => document.getElementById(id);
const fmt = n => (n ?? 0).toLocaleString("en-ZA");
const when = d => new Date(d).toLocaleString("en-ZA",{weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",timeZone:"Africa/Johannesburg"}) + " SAST";
const hm = d => new Date(d).toLocaleTimeString("en-ZA",{hour:"2-digit",minute:"2-digit",timeZone:"Africa/Johannesburg"});
const bust = () => "?t=" + Date.now();
const METROS = ["JHB","CPT","ETH","TSH","EKU","NMA","BUF","MAN"];

const API = "https://lge2026.nologna.workers.dev/api";
// Ward ballot leaders for one municipality, from the IEC's raw file (same logic as scripts/update.py).
function wardSummary(d){
  const out = {};
  for(const w of d.WardResults || []){
    const votes = w.PartyBallotResults.map(p => [p.WardVotes, shortName(p.Name)]).sort((a, b) => b[0] - a[0]);
    const total = votes.reduce((t, v) => t + v[0], 0);
    const vds = w.VotingDistrictResults || [];
    const vd = vds.filter(v => (v.PartyBallotResults || []).some(p => p.TotalValidVotes)).length;
    out[w.WardID] = {top: total ? votes.slice(0, 3).filter(v => v[0]).map(([v, n]) => [n, Math.round(1000 * v / total) / 10, v]) : [], votes: total, vd, vdTotal: vds.length};
  }
  return out;
}
const SHORTN = {"AFRICAN NATIONAL CONGRESS":"ANC","DEMOCRATIC ALLIANCE":"DA","UMKHONTO WESIZWE PARTY":"MK","ECONOMIC FREEDOM FIGHTERS":"EFF",
  "INKATHA FREEDOM PARTY":"IFP","PATRIOTIC ALLIANCE":"PA","ACTIONSA":"ActionSA","VRYHEIDSFRONT PLUS | FREEDOM FRONT PLUS":"FF+",
  "SOUTH AFRICAN COMMUNIST PARTY":"SACP","IND":"Independent","UNITED DEMOCRATIC MOVEMENT":"UDM","AFRICAN CHRISTIAN DEMOCRATIC PARTY":"ACDP",
  "GOOD":"GOOD","AL JAMA-AH":"Al Jama-ah","BUILD ONE SOUTH AFRICA":"BOSA","RISE MZANSI":"Rise Mzansi","CAPE COLOURED CONGRESS":"CCC","NATIONAL COLOURED CONGRESS":"NCC"};
const shortName = n => SHORTN[n] || n.replace(/\|/g, " ").split(/\s+/).filter(w => /^[A-Za-z]+$/.test(w) && !["OF","THE","AND","FOR"].includes(w)).map(w => w[0]).join("").slice(0, 6) || n.slice(0, 6);
let lastCheck = null;
async function apiOr(path, fallback){ try{ const r = await fetch(API + path, {cache:"no-store"}); if(r.ok){ const lc = r.headers.get("X-Last-Check"); if(lc) lastCheck = lc; const j = await r.json(); if(j) return j; } }catch(e){} return getJSON(fallback); }

let latest = null, index = [], view = null, viewIdx = -1, map, munGeo, selMunic = null, wardCache = {};

async function getJSON(u){ const r = await fetch(u + bust()); if(!r.ok) throw new Error(u + " " + r.status); return r.json(); }

async function load(manual){
  const btn = $("refresh"); btn.setAttribute("aria-busy","true"); if(manual) $("refreshLabel").textContent = "Refreshing…";
  try{
    if(manual) await fetch(API + "/refresh", {method:"POST"}).catch(() => {});   // ask the worker to check the IEC right now
    const fresh = manual ? "?fresh=1" : "";
    const l = await apiOr("/latest" + fresh, "data/latest.json");
    // the history index only changes when a new count arrives, so skip it otherwise
    const idx = (!latest || l.reportDate !== latest.reportDate || !index.length) ? await apiOr("/index" + fresh, "data/history/index.json").catch(() => index) : index;
    const isNew = !latest || l.reportDate !== latest.reportDate;
    latest = l; index = idx;
    if(viewIdx === -1) show(-1);
    setupSlider();
    if(isNew || !$("stelliesBody").dataset.done){ $("stelliesBody").dataset.done = 1; stellies(); jhb(); }
    if(isNew && selMunic) { delete wardCache[selMunic]; openMunic(selMunic, false); }
    if(manual){ $("refreshLabel").textContent = isNew ? "Updated" : "Up to date"; setTimeout(() => $("refreshLabel").textContent = "Refresh", 1500); }
    if(isNew && manual && !matchMedia("(prefers-reduced-motion: reduce)").matches) ["pct","duel","bars"].forEach(id => { const e = $(id); e.classList.remove("flash"); void e.offsetWidth; e.classList.add("flash"); });
  }catch(e){ flash("Couldn't reach the results file. Try again shortly."); console.error(e); }
  btn.removeAttribute("aria-busy"); if($("refreshLabel").textContent === "Refreshing…") $("refreshLabel").textContent = "Refresh"; stamp();
}

function flash(msg){ const s = $("stamp"); s.dataset.msg = msg; stamp(); setTimeout(()=>{ delete s.dataset.msg; stamp(); }, 3500); }

function stamp(){
  if(!latest) return;
  const s = $("stamp"), mins = Math.round((Date.now() - new Date(lastCheck && new Date(lastCheck) > new Date(latest.fetchedAt) ? lastCheck : latest.fetchedAt)) / 60000);
  const t = hm(latest.reportDate), ago = mins < 1 ? "just now" : mins + " min ago";
  s.innerHTML = s.dataset.msg ? `<b>${s.dataset.msg}</b>` : `<span class="long">IEC report <b>${t}</b> · checked ${ago}</span><span class="short"><b>${t}</b> · ${ago}</span>`;
  const n = latest.national, done = n.vd >= n.vdTotal && n.vdTotal > 0;
  const st = $("stale");
  if(mins > 45 && !done){ st.hidden = false; st.textContent = `The automatic update last ran ${mins} minutes ago, so these figures may be out of date. The IEC's own site is at results.elections.org.za.`; }
  else st.hidden = true;
}

function setupSlider(){
  const sl = $("slider"); sl.max = Math.max(index.length - 1, 0);
  if(viewIdx === -1) sl.value = sl.max;
  sl.oninput = () => { const i = +sl.value; i === index.length - 1 ? show(-1) : show(i); };
  $("golive").onclick = () => { sl.value = sl.max; show(-1); };
}

async function show(i){
  viewIdx = i;
  view = i === -1 ? latest : await apiOr("/history/" + index[i].file, "data/history/" + index[i].file);
  if(i !== -1 && !view.munics) view.munics = {};
  const past = i !== -1;
  $("golive").hidden = !past;
  $("tlLabel").textContent = (past ? "Showing an earlier count: " : "Showing the latest count: ") + when(view.reportDate);
  $("tlCount").textContent = index.length ? `· ${index.length} recorded` : "";
  const n = view.national, pct = n.vdTotal ? n.vd / n.vdTotal * 100 : 0;
  $("statusbar").classList.toggle("past", past);
  $("pct").textContent = pct.toFixed(0) + "%";
  $("status").textContent = past ? "counted · viewing " + hm(view.reportDate) + " count" : pct >= 99.9 ? "counted · provisional" : "counted";
  $("progfill").style.width = pct + "%"; $("progbar").setAttribute("aria-valuenow", pct.toFixed(0));
  render(view, i === -1 ? index.length - 2 : i - 1);
  paintMap();
}

function munLeader(id){
  const m = view && view.munics[id]; if(!m) return null;
  if(Array.isArray(m)) return m[0] ? {p:m[0], pct:m[1], vd:m[2]} : null;          // history format
  return m.parties[0] ? {p:m.parties[0][0], pct:m.parties[0][1], vd:m.vdPct} : null;
}

function render(s, prevI){
  const n = s.national, parties = n.parties.filter(p => p.pct > 0);
  const prev = prevI >= 0 && index[prevI] ? index[prevI].parties : null;
  const [a, b] = parties;
  $("duel").innerHTML = `<div><div class="lab" style="color:${col(a.short)}">${a.short} ahead</div><div class="big" style="color:${col(a.short)}">${a.pct.toFixed(1)}%</div><small>${fmt(a.votes)} votes</small></div>
    <div class="gap"><b>${(a.pct - b.pct).toFixed(2)}</b><small>pts gap</small></div>
    <div class="r"><div class="lab" style="color:${col(b.short)}">${b.short}</div><div class="big" style="color:${col(b.short)}">${b.pct.toFixed(1)}%</div><small>${fmt(b.votes)} votes</small></div>`;
  $("tug").innerHTML = parties.map(p => `<div title="${p.name} ${p.pct}%" aria-label="${p.short} ${p.pct}%" style="flex:${p.pct} 0 0;background:${col(p.short)}"></div>`).join("");
  $("tuglegend").innerHTML = parties.slice(0, 5).map(p => `<span>${sw(p.short)}<b>${p.short}</b> ${p.pct.toFixed(1)}%</span>`).join("");

  const max = Math.max(...parties.map(p => p.pct));
  const barRow = p => {
    const d = prev && prev[p.short] != null ? p.pct - prev[p.short] : null;
    const dh = d == null || Math.abs(d) < .005 ? "" : `<span class="delta ${d >= 0 ? "up" : "dn"}">${d >= 0 ? "▲ +" : "▼ −"}${Math.abs(d).toFixed(2)}</span>`;
    return `<div class="bar" title="${p.name}"><span>${p.short}</span><div class="track"><div class="fill" style="width:0;background:${col(p.short)}" data-w="${p.pct / max * 100}"></div></div><span>${p.pct.toFixed(2)}%${dh}</span></div>`;
  };
  $("bars").innerHTML = parties.slice(0, 8).map(barRow).join("") + (parties.length > 8 ? `<details class="moreparties"><summary>Show all parties (${parties.length})</summary>${parties.slice(8).map(barRow).join("")}</details>` : "");
  requestAnimationFrame(() => document.querySelectorAll(".fill").forEach(f => f.style.width = f.dataset.w + "%"));

  $("prog").innerHTML = `<span>Voting districts</span><span>${fmt(n.vd)} / ${fmt(n.vdTotal)}</span>
    <span>Votes cast</span><span>${fmt(n.cast)}</span>
    <span>Spoilt</span><span>${fmt(n.spoilt)}</span>
    <span>Councils decided</span><span>${n.councilsDone} / ${n.councilsTotal}</span>
    <span>Hung so far</span><span>${n.hung}</span>`;

  const full = s.munics && !Array.isArray(Object.values(s.munics)[0]) ? s.munics : latest.munics;
  $("metros").innerHTML = METROS.map(code => {
    const [id, m] = Object.entries(full).find(([, m]) => m.code === code) || [];
    if(!m) return "";
    const L = munLeader(id); if(!L) return `<button class="metro" data-id="${id}"><h3>${m.name}</h3><small>No votes counted yet</small></button>`;
    const second = m.parties[1];
    return `<button class="metro" data-id="${id}"><h3>${m.name}</h3><div class="sh" style="color:${col(L.p)}">${L.pct.toFixed(1)}%</div>
      <span class="who">${sw(L.p)}${L.p}${second && viewIdx === -1 ? ` <small>· next ${second[0]} ${second[1].toFixed(1)}%</small>` : ""}</span>
      <small>${L.vd.toFixed(0)}% counted</small>
      <div class="prog" style="width:${L.vd}%"></div></button>`;
  }).join("");
  document.querySelectorAll(".metro").forEach(el => el.onclick = () => { openMunic(el.dataset.id, true); $("mapTitle").scrollIntoView({behavior:"smooth", block:"start"}); });

  const cp = parties.filter(p => p.councils || p.seats).slice(0, 9);
  const maxS = Math.max(...cp.map(p => p.seats), 1);
  $("councils").innerHTML = `<div class="tablewrap"><table><thead><tr><th>Party</th><th class="n">Seats</th><th class="n">Councils won</th></tr></thead><tbody>` +
    cp.map(p => `<tr><td><span class="chip"><i style="background:${col(p.short)}"></i>${p.short}</span></td><td class="n">${fmt(p.seats)}</td><td class="n">${p.councils}</td></tr>`).join("") +
    `</tbody></table></div><p class="note">${n.majority} councils with a majority · ${n.hung} hung</p>`;
  $("provs").innerHTML = `<div class="tablewrap"><table><thead><tr><th>Province</th><th>Share</th><th>Top three</th><th class="n">Counted</th><th class="n">Hung</th></tr></thead><tbody>` + (s.provinces || []).map(pr => {
    const ps = pr.parties.filter(p => p.pct > 0), pp = pr.vdTotal ? pr.vd / pr.vdTotal * 100 : 0;
    return `<tr><td><b>${pr.name}</b></td><td><div class="stack">${ps.map(p => `<div title="${p.short} ${p.pct}%" style="flex:${p.pct} 0 0;background:${col(p.short)}"></div>`).join("")}</div></td>
      <td>${ps.slice(0, 3).map(p => `<span class="chip"><i style="background:${col(p.short)}"></i>${p.short} ${p.pct.toFixed(1)}%</span>`).join(" &nbsp;")}</td>
      <td class="n">${pp.toFixed(0)}%</td><td class="n">${pr.hung}</td></tr>`;
  }).join("") + `</tbody></table></div>`;
  trend();
}

function trend(){
  const svg = $("trend"), W = svg.clientWidth || 520, H = 280, P = 36;
  if(index.length < 2){ svg.innerHTML = `<text x="${W/2}" y="${H/2}" text-anchor="middle">The trend appears once there are two or more counts.</text>`; return; }
  const lastParties = index[index.length - 1].parties;
  const parties = Object.keys(lastParties).filter(p => p !== "Other").slice(0, 6);
  const top = Math.ceil(Math.max(...index.flatMap(s => parties.map(p => s.parties[p] || 0))) / 10) * 10 || 40;
  const lo = Math.max(0, Math.floor(Math.min(...index.map(s => s.vdPct)) / 5) * 5), hi = Math.min(100, Math.ceil(Math.max(...index.map(s => s.vdPct)) / 5) * 5 + 5);
  const x = v => P + (v - lo) / (hi - lo) * (W - 2 * P - 30), y = v => H - P - v / top * (H - 2 * P);
  let g = "";
  for(let v = 0; v <= top; v += 10) g += `<line x1="${P}" x2="${W - P}" y1="${y(v)}" y2="${y(v)}" stroke="#ddd5c4"/><text x="2" y="${y(v) + 4}">${v}%</text>`;
  [lo, (lo + hi) / 2, hi].forEach(v => g += `<text x="${x(v)}" y="${H - 12}" text-anchor="middle">${Math.round(v)}%</text>`);
  g += `<text x="${W - P}" y="${H - 1}" text-anchor="end">share of districts counted →</text>`;
  parties.forEach(p => {
    const pts = index.filter(s => s.parties[p] != null).map(s => [x(s.vdPct), y(s.parties[p])]);
    g += `<polyline fill="none" stroke="${col(p)}" stroke-width="2.5" points="${pts.join(" ")}"/>` + pts.map(([a, b]) => `<circle cx="${a}" cy="${b}" r="2.5" fill="${col(p)}"/>`).join("");
    const [lx, ly] = pts[pts.length - 1]; g += `<text x="${lx + 4}" y="${ly + 4}" style="fill:${col(p)};font-weight:700">${p}</text>`;
  });
  if(viewIdx !== -1) g += `<line x1="${x(index[viewIdx].vdPct)}" x2="${x(index[viewIdx].vdPct)}" y1="${P / 2}" y2="${H - P}" stroke="#0b357f" stroke-dasharray="4 3"/>`;
  svg.innerHTML = g;
}

/* ---------------- map ---------------- */
function initMap(){
  map = new maplibregl.Map({container:"map", style:"https://tiles.openfreemap.org/styles/positron",
    bounds:[[16.3, -35], [33, -22]], fitBoundsOptions:{padding:20}, attributionControl:{compact:true}});
  map.addControl(new maplibregl.NavigationControl({showCompass:false}), "top-right");
  map.on("load", async () => {
    munGeo = await getJSON("geo/munics.json");
    munGeo.features.forEach(f => f.id = f.properties.MunicId);
    map.addSource("mun", {type:"geojson", data:munGeo});
    map.addLayer({id:"mun-fill", type:"fill", source:"mun", paint:{"fill-color":["coalesce", ["feature-state", "c"], NOCOUNT],
      "fill-opacity":["coalesce", ["feature-state", "o"], .6]}});
    map.addLayer({id:"mun-line", type:"line", source:"mun", paint:{"line-color":"#ffffff", "line-width":["interpolate", ["linear"], ["zoom"], 4, .4, 9, 1.4]}});
    map.addLayer({id:"mun-sel", type:"line", source:"mun", paint:{"line-color":"#16181d", "line-width":2.2}, filter:["==", ["id"], -1]});
    map.addSource("ward", {type:"geojson", data:{type:"FeatureCollection", features:[]}});
    map.addLayer({id:"ward-fill", type:"fill", source:"ward", paint:{"fill-color":["get", "c"], "fill-opacity":["get", "o"]}});
    map.addLayer({id:"ward-line", type:"line", source:"ward", paint:{"line-color":"#ffffff", "line-width":.8}});
    map.addLayer({id:"ward-hi", type:"line", source:"ward", paint:{"line-color":"#16181d", "line-width":2}, filter:["==", ["get", "WardId"], -1]});
    const list = $("munlist");
    munGeo.features.map(f => f.properties).sort((a, b) => nice(a).localeCompare(nice(b)))
      .forEach(p => list.insertAdjacentHTML("beforeend", `<option value="${nice(p)}">`));
    $("search").onchange = e => { const f = munGeo.features.find(f => nice(f.properties).toLowerCase() === e.target.value.toLowerCase()); if(f){ openMunic(String(f.id), true); e.target.value = ""; e.target.blur(); } };
    paintMap();
    const tip = new maplibregl.Popup({closeButton:false, closeOnClick:false, offset:8});
    map.on("mousemove", "mun-fill", e => {
      map.getCanvas().style.cursor = "pointer";
      if(selMunic) return;
      const p = e.features[0].properties, L = munLeader(String(p.MunicId));
      tip.setLngLat(e.lngLat).setHTML(`<b>${nice(p)}</b><br>${L ? `${L.p} ${L.pct.toFixed(1)}% · ${L.vd.toFixed(0)}% counted` : "No votes counted yet"}`).addTo(map);
    });
    map.on("mouseleave", "mun-fill", () => { map.getCanvas().style.cursor = ""; tip.remove(); });
    map.on("click", "mun-fill", e => { const id = String(e.features[0].properties.MunicId); if(id !== selMunic){ tip.remove(); openMunic(id, true); } });
    map.on("mousemove", "ward-fill", e => { map.getCanvas().style.cursor = "pointer"; tip.setLngLat(e.lngLat).setHTML(wardHtml(e.features[0].properties, true)).addTo(map); });
    map.on("mouseleave", "ward-fill", () => tip.remove());
    map.on("click", "ward-fill", e => { const p = e.features[0].properties; map.setFilter("ward-hi", ["==", ["get", "WardId"], p.WardId]); showWardPanel(p); });
    $("back").onclick = closeMunic;
    const h = location.hash.match(/^#m\/(\d+)/); if(h) openMunic(h[1], true); else nationalPanel();
  });
}
const nice = p => (p.Municipali || "").replace(/^[A-Z0-9]+ - /, "");

function paintMap(){
  if(!map || !munGeo || !map.getSource("mun")) return;
  munGeo.features.forEach(f => {
    const L = munLeader(String(f.id));
    map.setFeatureState({source:"mun", id:f.id}, L && L.vd > 0 ? {c:col(L.p), o:.25 + .65 * Math.min(L.vd, 100) / 100} : {c:NOCOUNT, o:.6});
  });
  const seen = new Set();
  Object.keys(view.munics).forEach(id => { const L = munLeader(id); if(L) seen.add(L.p); });
  $("legend").innerHTML = [...seen].map(p => `<span class="chip"><i style="background:${col(p)}"></i>${p}</span>`).join("") + `<span class="chip"><i style="background:${NOCOUNT};opacity:.6"></i>Not counted</span>`;
  if(selMunic) nationalOrMunicPanel();
}

function bbox(geom){
  let b = [180, 90, -180, -90];
  const walk = c => typeof c[0] === "number" ? (b = [Math.min(b[0], c[0]), Math.min(b[1], c[1]), Math.max(b[2], c[0]), Math.max(b[3], c[1])]) : c.forEach(walk);
  walk(geom.coordinates); return [[b[0], b[1]], [b[2], b[3]]];
}

async function openMunic(id, fly){
  const f = munGeo && munGeo.features.find(f => String(f.id) === String(id)); if(!f) return;
  selMunic = String(id); history.replaceState(null, "", "#m/" + id);
  $("back").hidden = false; $("mapTitle").textContent = "The map: " + nice(f.properties);
  map.setFilter("mun-sel", ["==", ["id"], f.id]);
  map.setPaintProperty("mun-fill", "fill-opacity", ["case", ["==", ["id"], f.id], 0, ["*", .35, ["coalesce", ["feature-state", "o"], .6]]]);
  if(fly) map.fitBounds(bbox(f.geometry), {padding:30, duration:900});
  nationalOrMunicPanel();
  try{
    const [geo, res] = await Promise.all([wardCache["g" + id] || getJSON(`geo/wards/${id}.json`), wardCache[id] || fetch(`${API}/wards/${id}`).then(r => r.json()).then(wardSummary).catch(() => getJSON(`data/wards/${id}.json`)).catch(() => ({}))]);
    wardCache["g" + id] = geo; wardCache[id] = res;
    if(selMunic !== String(id)) return;
    geo.features.forEach(w => {
      const r = res[w.properties.WardId], t = r && r.top[0];
      Object.assign(w.properties, {c: t ? col(t[0]) : NOCOUNT, o: t ? .3 + .6 * (r.vdTotal ? r.vd / r.vdTotal : 0) : .5, r: JSON.stringify(r || null)});
    });
    map.getSource("ward").setData(geo);
  }catch(e){ console.error(e); }
}

function closeMunic(){
  selMunic = null; history.replaceState(null, "", location.pathname);
  $("back").hidden = true; $("mapTitle").textContent = "The map";
  map.getSource("ward").setData({type:"FeatureCollection", features:[]});
  map.setFilter("mun-sel", ["==", ["id"], -1]);
  map.setPaintProperty("mun-fill", "fill-opacity", ["coalesce", ["feature-state", "o"], .6]);
  map.fitBounds([[16.3, -35], [33, -22]], {padding:20, duration:900});
  nationalPanel();
}

function wardHtml(p, short){
  const r = typeof p.r === "string" ? JSON.parse(p.r) : p.r;
  if(!r || !r.top.length) return short ? `<b>Ward ${p.WardNo}</b><br>No votes counted yet` : `<h3>Ward ${p.WardNo}</h3><small>No votes counted yet.</small>`;
  const head = `<b>Ward ${p.WardNo}</b> · ${r.vd}/${r.vdTotal} districts counted`;
  if(short) return head + `<br>${r.top.map(t => `${t[0]} ${t[1]}%`).join(" · ")}`;
  return `<h3>Ward ${p.WardNo}</h3><small>${r.vd} of ${r.vdTotal} voting districts counted · ${fmt(r.votes)} ward votes</small>` +
    r.top.map(t => `<div class="row"><span>${t[0]}</span><div class="track" style="height:12px"><div style="width:${t[1]}%;background:${col(t[0])}"></div></div><span>${t[1]}%</span></div>`).join("") +
    "";
}
function showWardPanel(p){ if(matchMedia("(max-width:900px)").matches) setTimeout(() => $("panel").scrollIntoView({behavior:"smooth", block:"nearest"}), 50); $("panel").innerHTML = `<button class="back" onclick="nationalOrMunicPanel()">← ${latest.munics[selMunic]?.name || "Municipality"}</button>` + wardHtml(p, false) + ""; }

function nationalOrMunicPanel(){
  if(!selMunic) return nationalPanel();
  const m = latest.munics[selMunic], f = munGeo.features.find(f => String(f.id) === selMunic);
  if(!m){ $("panel").innerHTML = `<h3>${nice(f.properties)}</h3><small>No results reported yet.</small>`; return; }
  const L = munLeader(selMunic);
  $("panel").innerHTML = `<small>${m.prov}</small><h3>${m.name}</h3>
    ${selMunic === STELLIES ? `<p class="pinned">📌 Your municipality</p>` : `<button class="pinbtn" onclick="pinMunic('${selMunic}');document.getElementById('stellies').scrollIntoView({behavior:'smooth'})">📌 Pin as my municipality</button>`}
    <small>${(viewIdx === -1 ? m.vdPct : L?.vd ?? 0).toFixed(0)}% of districts counted · ${m.seats}/${m.seatsTotal} seats declared</small>
    ${m.winner ? `<p><span class="badge" style="background:${col(m.winner)};color:${inkOn(col(m.winner))}">${m.winner} wins the council</span></p>` : m.hung ? `<p><span class="badge" style="background:#555b66;color:#fff">Hung council</span></p>` : ""}
    ${viewIdx !== -1 ? `<p class="note">Earlier count: ${L ? `${L.p} led with ${L.pct.toFixed(1)}%` : "nothing counted"}. Breakdown below is the latest.</p>` : ""}
    ${m.parties.map(p => `<div class="row"><span>${p[0]}</span><div class="track" style="height:12px"><div style="width:${p[1]}%;background:${col(p[0])}"></div></div><span>${p[1].toFixed(1)}%</span></div>`).join("")}`;
}

function nationalPanel(){
  $("panel").innerHTML = `<h3>South Africa</h3><small>213 councils · ${fmt(latest.national.registered)} registered voters</small>
    <p class="note" style="margin-top:12px">Pick a municipality to see its wards.</p>`;
}

/* ---------------- Stellenbosch ---------------- */
// "My municipality": Stellenbosch by default; visitors can pin their own (remembered on their device).
let STELLIES = localStorage.getItem("myMunic") || "9911";
const myName = () => latest?.munics[STELLIES]?.name || (munGeo && nice(munGeo.features.find(f => String(f.id) === STELLIES)?.properties || {})) || "Stellenbosch";
function pinMunic(id){
  STELLIES = String(id); localStorage.setItem("myMunic", STELLIES);
  $("stelliesBody").innerHTML = `<p class="note">Loading…</p>`; stellies();
  if(selMunic) nationalOrMunicPanel();
}
function pickerHtml(){
  return `<div class="st-pick"><input id="stPick" list="munlist" placeholder="Change municipality…" autocomplete="off" aria-label="Change municipality">
    ${STELLIES !== "9911" ? `<button class="st-reset" id="stReset">Back to Stellenbosch</button>` : ""}</div>`;
}
function wirePicker(){
  const i = $("stPick"); if(i) i.onchange = () => { const f = munGeo?.features.find(f => nice(f.properties).toLowerCase() === i.value.toLowerCase()); if(f) pinMunic(f.id); };
  const r = $("stReset"); if(r) r.onclick = () => pinMunic("9911");
}
/* ---------------- Johannesburg battleground (always shown) ---------------- */
const JHB = "3003";
async function jhb(){
  const m = latest.munics[JHB];
  if(!m){ $("jhbBody").innerHTML = `<p class="note">No Johannesburg results yet.</p>`; return; }
  let blue = 0, wardsTotal = 0, wardsCounted = 0, tally = {}, all = 0;
  try{
    const d = await fetch(`${API}/wards/${JHB}`).then(r => r.json());
    for(const w of d.WardResults || []){
      wardsTotal++;
      for(const p of w.PartyBallotResults){ const k = shortName(p.Name), v = p.TotalValidVotes || 0; tally[k] = (tally[k] || 0) + v; all += v; }
      const top = w.PartyBallotResults.slice().sort((a, b) => b.WardVotes - a.WardVotes)[0];
      if(top && top.WardVotes){ wardsCounted++; if(top.Name === "DEMOCRATIC ALLIANCE") blue++; }
    }
  }catch(e){}
  // Party shares across all ballots, summed from the ward file (the summary only lists the leader).
  const ps = all ? Object.entries(tally).map(([k, v]) => [k, 100 * v / all]).filter(p => p[1] >= 1).sort((a, b) => b[1] - a[1]).slice(0, 6) : m.parties, da = ps.find(p => p[0] === "DA") || ["DA", 0, 0], rivals = ps.filter(p => p[0] !== "DA");
  const max = Math.max(55, ...ps.map(p => p[1]));
  const toMaj = Math.max(0, 50 - da[1]);
  $("jhbBody").innerHTML = `
    <div class="jhb-top">
      <div><div class="jhb-big">${da[1].toFixed(1)}%</div><div class="jhb-sub">DA in Joburg · ${m.vdPct.toFixed(0)}% counted</div></div>
      <div class="jhb-maj">${da[1] >= 50 ? "<b>Majority</b> on current count" : `<b>${toMaj.toFixed(1)} pts</b> short of a majority`}</div>
    </div>
    <div class="jhb-bars">
      ${ps.map(p => `<div class="jhb-row"><span>${p[0]}</span><div class="track"><div style="width:${p[1] / max * 100}%;background:${col(p[0])}"></div><i style="left:${50 / max * 100}%"></i></div><b>${p[1].toFixed(1)}%</b></div>`).join("")}
    </div>
    <div class="jhb-facts">
      ${wardsTotal ? `<div><b>${blue}</b><span>of ${wardsTotal} wards blue</span></div>` : ""}
      <div><b>${m.seats}/${m.seatsTotal}</b><span>seats declared</span></div>
      ${rivals[0] ? `<div><b>${(da[1] - rivals[0][1]).toFixed(1)} pts</b><span>${da[1] >= rivals[0][1] ? "ahead of" : "behind"} ${rivals[0][0]}</span></div>` : ""}
    </div>
    <button class="jhb-go" id="jhbGo">See Joburg's wards on the map</button>`;
  $("jhbGo").onclick = () => { openMunic(JHB, true); $("mapTitle").scrollIntoView({behavior:"smooth", block:"start"}); };
}

async function stellies(){
  try{
    const d = await fetch(`${API}/wards/${STELLIES}`).then(r => r.json());
    const wards = (d.WardResults || []).map(w => {
      const tot = w.PartyBallotResults.reduce((t, p) => t + p.WardVotes, 0);
      const da = (w.PartyBallotResults.find(p => p.Name === "DEMOCRATIC ALLIANCE") || {}).WardVotes || 0;
      const top = w.PartyBallotResults.slice().sort((a, b) => b.WardVotes - a.WardVotes)[0];
      const vds = w.VotingDistrictResults || [];
      return {no: w.WardID % 1000, tot, da, pct: tot ? 100 * da / tot : 0, lead: top && top.WardVotes ? shortName(top.Name) : null,
        vd: vds.filter(v => (v.PartyBallotResults || []).some(p => p.TotalValidVotes)).length, vdTotal: vds.length};
    }).sort((a, b) => b.pct - a.pct);
    const counted = wards.filter(w => w.tot), daWins = counted.filter(w => w.lead === "DA"), best = counted[0];
    const m = latest.munics[STELLIES];
    const daPct = m && m.parties[0] ? (m.parties.find(p => p[0] === "DA") || [0, 0])[1] : 0;
    $("h-stellies").textContent = myName() + ", ward by ward";
    $("stelliesBody").innerHTML = pickerHtml() + `
      <div class="st-head">
        <div><div class="st-big" style="color:${col("DA")}">${daPct.toFixed(1)}%</div><small>DA across ${myName()} · ${m ? m.vdPct.toFixed(0) : 0}% of districts counted</small></div>
        <div class="st-score"><b>${daWins.length}</b> of ${wards.length} wards blue so far</div>
      </div>
      ${best ? `<div class="thanks"><span>Thank you, Ward ${best.no}</span><small>The most DA ward in ${myName()} so far: ${best.pct.toFixed(1)}% of the ward vote.</small></div>` : ""}
      <div class="st-wards">${wards.map(w => `<button class="st-ward" data-no="${w.no}" title="Show on the map">
        <span>Ward ${w.no}</span>
        <div class="track"><div style="width:${w.pct}%;background:${col("DA")}"></div></div>
        <span>${w.tot ? w.pct.toFixed(1) + "%" : "—"}</span>
        <small>${w.tot ? (w.lead === "DA" ? "DA ahead" : w.lead + " ahead") + ` · ${w.vd}/${w.vdTotal} counted` : "not counted yet"}</small></button>`).join("")}</div>
      ${daWins.length ? `<p class="thanks-all">💙 Thank you to every ward voting blue: ${daWins.map(w => "Ward " + w.no).join(", ")}.</p>` : ""}`;
    wirePicker();
    document.querySelectorAll(".st-ward").forEach(b => b.onclick = () => { openMunic(STELLIES, true); $("mapTitle").scrollIntoView({behavior:"smooth", block:"start"}); });
  }catch(e){ $("stelliesBody").innerHTML = pickerHtml() + `<p class="note">Couldn't load ${myName()}'s wards right now.</p>`; wirePicker(); }
}

$("refresh").onclick = () => load(true);
setInterval(() => { if(viewIdx === -1) load(false); else stamp(); }, 120000);
addEventListener("resize", trend);
document.addEventListener("visibilitychange", () => { if(!document.hidden && viewIdx === -1) load(false); });
load(false).then(initMap);
