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
const ORDER = ["3003", "9006", "3004", "3002", "1001", "4005", "2207", "1117"];
let open = new Set(JSON.parse(sessionStorage.getItem("prOpen") || "[]"));

function rangeBar(p, max){
  const [lo, md, hi] = p.proj, x = v => Math.min(v / max, 1) * 100;
  return `<div class="pr-track" aria-hidden="true">
    <i class="pr-band" style="left:${x(lo)}%;width:${Math.max(x(hi) - x(lo), .6)}%;background:${col(p.short)}"></i>
    <i class="pr-mid" style="left:${x(md)}%;background:${col(p.short)}"></i>
    <i class="pr-now" style="left:${x(p.now)}%"></i></div>`;
}
function partyRows(parties){
  const max = Math.max(50, ...parties.map(p => p.proj[2] + 4));
  return parties.map(p => `<div class="pr-row"><span class="pr-party">${esc(p.short)}</span>${rangeBar(p, max)}
    <span class="pr-num"><b>${p.proj[1].toFixed(1)}%</b><small>${p.proj[0]}–${p.proj[2]}</small></span>
    <span class="pr-was">count ${p.now.toFixed(1)}%</span></div>`).join("") +
    `<p class="pr-key"><span class="k-band"></span>likely range (90%) <span class="k-mid"></span>projection <span class="k-now"></span>count so far</p>`;
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
  if(!n.reliable) return `<section class="card pr-national"><h2>South Africa</h2><p class="pr-meta">${pct.toFixed(0)}% of voting districts counted</p><p>Not enough of the country's kinds of areas are counted yet to project fairly.</p></section>`;
  const pts = (hist || []).map(h => ({vdPct: 100 * h.vdCounted / h.vdTotal, reliable: h.reliable, DA: (h.parties.find(p => p.short === "DA") || {}).proj && [h.parties.find(p => p.short === "DA").now, ...h.parties.find(p => p.short === "DA").proj]}));
  return `<section class="card pr-national"><h2>South Africa</h2>
    <p class="pr-meta">${pct.toFixed(0)}% of voting districts counted · projected final share of all ballots</p>
    ${(() => { const r = pts.filter(p => p.reliable).map(p => p.vdPct); return r.length > 1 && Math.max(...r) - Math.min(...r) >= 2; })()
      ? `<div class="pr-nat-grid"><div>${partyRows(n.parties.filter(p => p.short !== "Other").slice(0, 6))}</div><div>${spark(pts, "DA projection as the national count went on")}</div></div>`
      : `<div class="pr-nat-solo">${partyRows(n.parties.filter(p => p.short !== "Other").slice(0, 6))}</div>`}
  </section>`;
}

function metroTable(metros, hist){
  const rows = metros.map(m => {
    const id = String(m.munic), pct = 100 * m.vdCounted / m.vdTotal, name = SHORT[m.name] || m.name;
    const da = m.parties.find(p => p.short === "DA"), lead = m.parties[0];
    const status = !m.reliable ? `<span class="pr-tag wait">Not enough data yet</span>`
      : `<b>${lead.short}</b> ${lead.proj[1].toFixed(1)}%`;
    const daCell = m.reliable && da ? `<b>${da.proj[1].toFixed(1)}%</b> <small class="rng">${da.proj[0]}–${da.proj[2]}</small>` : "–";
    const pts = hist.map(h => h.metros && h.metros[id]).filter(Boolean).map(x => ({vdPct: x.vdPct, reliable: x.reliable, DA: x.parties.DA}));
    const detail = `<tr class="pr-detail" ${open.has(id) ? "" : "hidden"} id="d-${id}"><td colspan="5">${m.reliable && lead.short !== "DA" ? `<p class="pr-lead">Projected leader: <b>${lead.short}</b> ${lead.proj[1].toFixed(1)}%</p>` : ""}
      ${m.reliable ? partyRows(m.parties.slice(0, 4)) + spark(pts, "DA projection as " + name + "'s count went on")
        : `<p>${(m.coverage * 100).toFixed(0)}% of the uncounted vote has enough counted look-alike stations. A projection appears at 90%.</p>`}</td></tr>`;
    return `<tr class="pr-line" data-id="${id}" tabindex="0" aria-expanded="${open.has(id)}" aria-controls="d-${id}">
      <th scope="row">${esc(name)}<small class="pr-sub">${pct.toFixed(0)}% of districts</small></th><td class="c-opt">${pct.toFixed(0)}%</td><td>${da ? da.now.toFixed(1) + "%" : "–"}</td><td>${daCell}</td><td class="c-opt">${status}</td></tr>${detail}`;
  }).join("");
  return `<div class="pr-tablewrap"><table class="pr-table">
    <thead><tr><th scope="col">Metro</th><th scope="col" class="c-opt">Districts counted</th><th scope="col"><span class="lg">DA </span>so far</th><th scope="col"><span class="lg">DA </span>projected</th><th scope="col" class="c-opt">Projected leader</th></tr></thead>
    <tbody>${rows}</tbody></table></div><p class="note">Tap a metro for every party and how its projection moved.</p>`;
}

function nationalEvaluation(nb){
  if(!nb || !nb.rows) return "";
  const rows = nb.rows.filter(r => r.order === "mixed" || r.order === "worst case");
  const stages = [10, 25, 50, 75];
  const line = (o, st) => { const rs = rows.filter(r => r.order === o && r.stage === st); if(!rs.length) return "";
    const pub = rs[0].published, da = rs.find(r => r.party === "DA");
    return `<tr><td>${o === "mixed" ? "Typical" : "Worst case"}</td><td>${st}%</td>${pub
      ? `<td>${da.count}%</td><td><b>${da.proj}%</b> <small>${da.lo}–${da.hi}</small></td><td>${da.real}%</td><td>${rs.filter(r => r.inside).length}/${rs.length}</td>`
      : `<td>${da.count}%</td><td colspan="2" class="muted">withheld</td><td>–</td>`}</tr>`; };
  return `<h3 class="bt-h">South Africa, 2021 predicted from 2016</h3><div class="pr-tablewrap"><table class="bt">
    <thead><tr><th>Order</th><th>Counted</th><th>DA in count</th><th>DA projected</th><th>DA real</th><th>Real inside range <small>(DA, ANC, EFF)</small></th></tr></thead>
    <tbody>${["mixed", "worst case"].flatMap(o => stages.map(st => line(o, st))).join("")}</tbody></table></div>`;
}

function evaluation(b){
  if(!b || !b.byStage) return "";
  const stages = [10, 25, 50, 75], orders = ["mixed", "worst case"];
  const cell = s => !s || !s.published ? `<td colspan="3" class="muted">withheld</td>`
    : `<td>${s.published}/${s.n}</td><td>${s.inside}/${s.published}</td><td><b>${s.medianErr.toFixed(1)}</b> <small>vs ${s.medianBaseErr.toFixed(1)}</small></td>`;
  return orders.map(o => `<h4 class="bt-h4">${o === "mixed" ? "Typical counting order" : "Worst-case order (most pro-DA areas first)"}</h4>
    <div class="pr-tablewrap"><table class="bt"><thead><tr><th>Districts counted</th><th>Projections published</th><th>Real result inside range</th><th>Typical miss <small>(vs count-so-far)</small></th></tr></thead><tbody>
    ${stages.map(s => `<tr><td>${s}%</td>${cell(b.byStage[o + "|" + s])}</tr>`).join("")}</tbody></table></div>`).join("") +
    `<p class="note">Misses are in percentage points of vote share, for the DA, ANC and EFF across the eight metros. "Count-so-far" treats the count at that stage as the final result.</p>`;
}

async function load(){
  try{
    const [p, h, n, nh, b, live] = await Promise.all([get("data/projections.json"), get("data/projections_history.json").catch(() => []),
      get("data/projection_national.json").catch(() => null), get("data/projection_national_history.json").catch(() => []),
      get("data/backtest.json").catch(() => null), get("https://lge2026.nologna.workers.dev/api/latest").catch(() => null)]);
    const nb = await get("data/backtest_national.json").catch(() => null);
    $("asof").textContent = `Projected from the IEC count of ${hm(p.reportDate)}.`;
    const behind = live && live.reportDate && (new Date(live.reportDate) - new Date(p.reportDate)) > 20 * 60000;
    $("stale").hidden = !behind;
    if(behind) $("stale").textContent = `These projections use the count of ${hm(p.reportDate)}; the live count has moved on to ${hm(live.reportDate)}. They'll catch up shortly.`;
    $("national").innerHTML = nationalCard(n, nh);
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
