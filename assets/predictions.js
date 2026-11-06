// Metro predictions page. Reads small static files made by scripts/project.py, project_national.py
// and backtest.py; compares their IEC snapshot time with the live worker to flag a stale projection.
const COL = {ANC:"#1f9d55",DA:"#2f6fdf",MK:"#4d8a6a",EFF:"#c8323a",ActionSA:"#38b6c9",PA:"#7a3fb0",IFP:"#e07b22",
  "FF+":"#f2a640",SACP:"#b5121b",UDM:"#d4b200",ACDP:"#2f9fb0",GOOD:"#e95d24",BOSA:"#6a8cff",Independent:"#9aa093"};
const col = p => COL[p] || "#8a8f86";
const $ = id => document.getElementById(id);
const get = u => fetch(u + (u.includes("?") ? "&" : "?") + "t=" + Date.now()).then(r => { if(!r.ok) throw r.status; return r.json(); });
const hm = d => new Date(d).toLocaleString("en-ZA", {weekday:"short", hour:"2-digit", minute:"2-digit", timeZone:"Africa/Johannesburg"}) + " SAST";
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const SHORT = {"City of Johannesburg":"Johannesburg","City of Cape Town":"Cape Town","City of Tshwane":"Tshwane"};
const AKA = {"4005":"Durban","3004":"Pretoria","3002":"East Rand","1001":"Gqeberha (Port Elizabeth)","1117":"East London","2207":"Bloemfontein"};
const ORDER = ["3003", "9006", "3004", "3002", "1001", "4005", "2207", "1117"];
let open = new Set(JSON.parse(sessionStorage.getItem("prOpen") || "[]"));

// Plain-language rows: "now X% → likely about Y%", range in small print, arrow for direction.
const about = v => v < 10 ? v.toFixed(1) : Math.round(v);
const range = (lo, hi) => String(about(lo)) === String(about(hi)) ? `${about(lo)}%` : `${about(lo)}% to ${about(hi)}%`;
function change(now, md){
  const d = md - now;
  if(Math.abs(d) < 0.5) return `<span class="chg same" title="About the same">→</span>`;
  return `<span class="chg ${d > 0 ? "up" : "down"}" title="${d > 0 ? "Likely to rise" : "Likely to fall"}">${d > 0 ? "▲" : "▼"}</span>`;
}
function partyRows(parties){
  return `<table class="pt"><thead><tr><th scope="col">Party</th><th scope="col">Now</th><th scope="col">Likely finish</th><th scope="col" class="pt-rng">Likely range</th></tr></thead><tbody>
    ${parties.map(p => `<tr>
      <th scope="row"><span class="pt-sw" style="background:${col(p.short)}"></span>${esc(p.short)}</th>
      <td class="pt-now">${p.now.toFixed(1)}%</td>
      <td class="pt-end">${change(p.now, p.proj[1])}<b>${about(p.proj[1])}%</b></td>
      <td class="pt-rng">${range(p.proj[0], p.proj[2])}</td>
    </tr>`).join("")}</tbody></table>`;
}

function spark(points, label){
  const pts = points.filter(p => p && p.reliable && p.DA);
  if(pts.length < 2 || Math.max(...pts.map(p => p.vdPct)) - Math.min(...pts.map(p => p.vdPct)) < 2) return `<p class="note">The projection history appears after a few more counts.</p>`;
  const W = 320, H = 80, xs = pts.map(m => m.vdPct), x0 = Math.min(...xs), x1 = Math.max(...xs);
  const vals = pts.flatMap(m => [m.DA[1], m.DA[3], m.DA[0]]), lo = Math.floor(Math.min(...vals) - 1), hi = Math.ceil(Math.max(...vals) + 1);
  const X = v => 6 + (v - x0) / ((x1 - x0) || 1) * (W - 12), Y = v => H - 6 - (v - lo) / ((hi - lo) || 1) * (H - 12);
  const band = pts.map(m => `${X(m.vdPct)},${Y(m.DA[3])}`).join(" ") + " " + pts.slice().reverse().map(m => `${X(m.vdPct)},${Y(m.DA[1])}`).join(" ");
  return `<figure class="pr-spark"><figcaption>${label}</figcaption>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">
      <polygon points="${band}" fill="${col("DA")}" opacity=".16"/>
      <polyline points="${pts.map(m => `${X(m.vdPct)},${Y(m.DA[2])}`).join(" ")}" fill="none" stroke="${col("DA")}" stroke-width="2.5"/>
      <polyline points="${pts.map(m => `${X(m.vdPct)},${Y(m.DA[0])}`).join(" ")}" fill="none" stroke="#16181d" stroke-width="1.5" stroke-dasharray="4 3"/>
    </svg><div class="pr-axis"><span>${x0.toFixed(0)}% of districts</span><span>${lo}–${hi}% DA</span><span>${x1.toFixed(0)}%</span></div>
    <p class="pr-key"><span class="k-mid"></span>projected DA share <span class="k-now"></span>DA in the count so far</p></figure>`;
}

function nationalCard(n, hist){
  if(!n) return "";
  const pct = 100 * n.vdCounted / n.vdTotal;
  const head = `<h2>South Africa</h2><p class="pr-meta">${pct.toFixed(0)}% of voting districts counted</p>`;
  if(!n.reliable) return `<section class="card pr-national">${head}<p>Too little of the country is counted to make a fair estimate yet.</p></section>`;
  const pts = (hist || []).map(h => { const d = h.parties.find(p => p.short === "DA"); return {vdPct: 100 * h.vdCounted / h.vdTotal, reliable: h.reliable, DA: d && [d.now, ...d.proj]}; });
  return `<section class="card pr-national">${head}
    ${partyRows(n.parties.filter(p => p.short !== "Other").slice(0, 6))}
    <details class="pr-more"><summary>How the estimate moved</summary>${spark(pts, "DA estimate at each count, nationally")}</details>
  </section>`;
}

function metroTable(metros, hist){
  const rows = metros.map(m => {
    const id = String(m.munic), pct = 100 * m.vdCounted / m.vdTotal, name = SHORT[m.name] || m.name;
    const da = m.parties.find(p => p.short === "DA"), lead = m.parties[0];
    const end = m.reliable && da ? `${change(da.now, da.proj[1])}<b>${about(da.proj[1])}%</b>` : `<span class="pr-tag wait">not enough counted yet</span>`;
    const rng = m.reliable && da ? range(da.proj[0], da.proj[2]) : "";
    const pts = hist.map(h => h.metros && h.metros[id]).filter(Boolean).map(x => ({vdPct: x.vdPct, reliable: x.reliable, DA: x.parties.DA}));
    const detail = `<tr class="pr-detail" ${open.has(id) ? "" : "hidden"} id="d-${id}"><td colspan="5">
      ${m.reliable ? `${lead.short !== "DA" ? `<p class="pr-lead">The ${lead.short} is likely to finish largest.</p>` : ""}${partyRows(m.parties.slice(0, 4))}${spark(pts, "DA estimate at each count in " + name)}`
        : `<p>Too few districts like the ones still to come in ${esc(name)} have reported. An estimate will appear once enough have.</p>`}</td></tr>`;
    return `<tr class="pr-line" data-id="${id}" tabindex="0" aria-expanded="${open.has(id)}" aria-controls="d-${id}">
      <th scope="row">${esc(name)}${AKA[id] ? `<small class="pr-aka">${AKA[id]}</small>` : ""}<small class="pr-sub">${pct.toFixed(0)}% counted</small></th>
      <td class="c-opt">${pct.toFixed(0)}%</td><td class="pt-now">${da ? da.now.toFixed(1) + "%" : "–"}</td><td class="pt-end">${end}</td><td class="pt-rng">${rng}</td></tr>${detail}`;
  }).join("");
  return `<div class="pr-tablewrap"><table class="pr-table">
    <thead><tr><th scope="col">Metro</th><th scope="col" class="c-opt">Counted</th><th scope="col">DA now</th><th scope="col">DA likely finish</th><th scope="col" class="pt-rng">Likely range</th></tr></thead>
    <tbody>${rows}</tbody></table></div><p class="note">Tap a metro to see the other parties.</p>`;
}

function nationalEvaluation(nb){
  if(!nb || !nb.rows) return "";
  const rows = nb.rows.filter(r => r.order === "mixed" || r.order === "worst case");
  const stages = [10, 25, 50, 75];
  const line = (o, st) => { const rs = rows.filter(r => r.order === o && r.stage === st); if(!rs.length) return "";
    const pub = rs[0].published, da = rs.find(r => r.party === "DA");
    return `<tr><td>${o === "mixed" ? "Typical" : "Worst case"}</td><td>${st}%</td>${pub
      ? `<td>${da.count}%</td><td><b>${da.proj}%</b> <small>${da.lo}–${da.hi}</small></td><td>${da.real}%</td><td>${rs.filter(r => r.inside).length}/${rs.length}</td>`
      : `<td>${da.count}%</td><td colspan="2" class="muted">held back</td><td>–</td>`}</tr>`; };
  return `<h3 class="bt-h">South Africa</h3><div class="pr-tablewrap"><table class="bt">
    <thead><tr><th>Order</th><th>Counted</th><th>DA in the count</th><th>Our estimate</th><th>Real result</th><th>Real result in our range <small>(DA, ANC, EFF)</small></th></tr></thead>
    <tbody>${["mixed", "worst case"].flatMap(o => stages.map(st => line(o, st))).join("")}</tbody></table></div>`;
}

function evaluation(b){
  if(!b || !b.byStage) return "";
  const stages = [10, 25, 50, 75], orders = ["mixed", "worst case"];
  const cell = s => !s || !s.published ? `<td colspan="3" class="muted">held back</td>`
    : `<td>${s.published / 3} of ${s.n / 3} metros</td><td>${s.inside}/${s.published} <small>party results</small></td><td><b>${s.medianErr.toFixed(1)}</b> <small>(${s.medianBaseErr.toFixed(1)})</small></td>`;
  return orders.map(o => `<h4 class="bt-h4">${o === "mixed" ? "Typical counting order" : "Worst-case order, most pro-DA areas first"}</h4>
    <div class="pr-tablewrap"><table class="bt"><thead><tr><th>Districts in</th><th>Estimates published</th><th>Real result in our range</th><th>Typical miss <small>(count taken as final)</small></th></tr></thead><tbody>
    ${stages.map(s => `<tr><td>${s}%</td>${cell(b.byStage[o + "|" + s])}</tr>`).join("")}</tbody></table></div>`).join("") +
    `<p class="note">Misses are in percentage points of vote share for the DA, ANC and EFF across the eight metros. The number in brackets is what you'd get by treating the count at that stage as final. In this one test, every range we published contained the real result, so the ranges may be wider than they need to be. One past election is a small sample.</p>`;
}

// After the count: score the projections we actually published against the final result.
function howClose(h, nh, p, n){
  const done = n && n.vdCounted >= n.vdTotal;
  if(!done) return "";
  const stages = [10, 25, 50, 75];
  const rowsFor = (label, series, final) => stages.map((st, i) => {
    const next = stages[i + 1] || 100;
    const near = series.filter(x => x.vdPct >= st && x.vdPct < next);   // only projections made at this stage
    const e = near.find(x => x.reliable);
    if(!e){
      const why = !series.length || series[0].vdPct >= next ? "no estimate yet at this stage" : "held back, too little counted";
      return `<tr><td>${label}</td><td>${st}%</td><td colspan="4" class="muted">${why}</td></tr>`;
    }
    const [now, lo, md, hi] = e.DA, f = final;
    return `<tr><td>${label}</td><td>${st}% <small>(${e.vdPct.toFixed(0)}%)</small></td><td>${md.toFixed(1)}% <small>${lo}–${hi}</small></td><td>${f.toFixed(1)}%</td>
      <td><b>${Math.abs(md - f).toFixed(1)}</b> <small>(${Math.abs(now - f).toFixed(1)})</small></td><td>${lo <= f && f <= hi ? "yes" : "no"}</td></tr>`;
  }).join("");
  const natFinal = (n.parties.find(x => x.short === "DA") || {}).now;
  const natSeries = (nh || []).map(x => { const d = x.parties.find(q => q.short === "DA"); return {vdPct: 100 * x.vdCounted / x.vdTotal, reliable: x.reliable, DA: d && [d.now, ...d.proj]}; }).filter(x => x.DA);
  let body = natFinal != null ? rowsFor("South Africa", natSeries, natFinal) : "";
  for(const m of p.metros){
    const id = String(m.munic), d = m.parties.find(x => x.short === "DA"); if(!d) continue;
    const series = h.map(x => x.metros && x.metros[id]).filter(Boolean).map(x => ({vdPct: x.vdPct, reliable: x.reliable, DA: x.parties.DA})).filter(x => x.DA);
    body += rowsFor(SHORT[m.name] || m.name, series, d.now);
  }
  return `<section class="card" id="close"><h2>How close were we?</h2>
    <p>For each stage of the count, the DA estimate we published live, compared with the final count.</p>
    <div class="pr-tablewrap"><table class="bt"><thead><tr><th>Place</th><th>Stage <small>(actual)</small></th><th>Our estimate</th><th>Final</th><th>Miss <small>(count taken as final)</small></th><th>Inside range</th></tr></thead>
    <tbody>${body}</tbody></table></div><p class="note">Provisional until the IEC declares the results. Only projections published live during the count are scored, not ones recomputed afterwards.</p></section>`;
}

async function load(){
  try{
    const [p, h, n, nh, b, live] = await Promise.all([get("data/projections.json"), get("data/projections_history.json").catch(() => []),
      get("data/projection_national.json").catch(() => null), get("data/projection_national_history.json").catch(() => []),
      get("data/backtest.json").catch(() => null), get("https://lge2026.nologna.workers.dev/api/latest").catch(() => null)]);
    const nb = await get("data/backtest_national.json").catch(() => null);
    $("asof").innerHTML = `Recalculated with every new IEC count, which we check for every five minutes. This version uses the count from ${hm(p.reportDate)}.`;
    const behind = live && live.reportDate && (new Date(live.reportDate) - new Date(p.reportDate)) > 20 * 60000;
    $("stale").hidden = !behind;
    if(behind) $("stale").textContent = `These projections use the count of ${hm(p.reportDate)}; the live count has moved on to ${hm(live.reportDate)}. They'll catch up shortly.`;
    $("national").innerHTML = howClose(h, nh, p, n) + nationalCard(n, nh);
    const ms = p.metros.slice().sort((a, c) => ORDER.indexOf(String(a.munic)) - ORDER.indexOf(String(c.munic)));
    $("metros").innerHTML = metroTable(ms, h);
    document.querySelectorAll(".pr-line").forEach(tr => {
      const toggle = () => { const id = tr.dataset.id, d = $("d-" + id); d.hidden = !d.hidden; tr.setAttribute("aria-expanded", !d.hidden);
        d.hidden ? open.delete(id) : open.add(id); sessionStorage.setItem("prOpen", JSON.stringify([...open])); };
      tr.onclick = toggle; tr.onkeydown = e => { if(e.key === "Enter" || e.key === " "){ e.preventDefault(); toggle(); } };
    });
    $("backtest").innerHTML = nationalEvaluation(nb) + (b ? `<h3 class="bt-h">The eight metros</h3>` : "") + evaluation(b);
  }catch(e){ $("asof").textContent = "Couldn't load the projections right now. Try again in a minute."; }
}
load(); setInterval(load, 180000);
