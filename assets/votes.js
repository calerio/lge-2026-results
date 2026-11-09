// Where votes changed: DA vote counts versus DA share, 2026 vs an earlier local election, on the
// municipal PR ballot. Everything is computed from official IEC counts in data/archive/.
(async function(){
  const L = window.LGE, $ = id => document.getElementById(id), E = L.esc;
  const BLUE = "#0077c8", ORANGE = "#b65c20", INK = "#17212b", MUTE = "#55616d", RULE = "#d9dfe5", BALLOT = "pr";
  const AKA = {JHB: "Johannesburg", TSH: "Pretoria", ETH: "Durban", NMA: "Gqeberha", BUF: "East London", MAN: "Bloemfontein", EKU: "Ekurhuleni", CPT: "Cape Town"};
  // Explicit party matching across years: exact names, with runs of spaces collapsed, plus listed renames.
  const RENAME = {"VRYHEIDSFRONT PLUS": "VRYHEIDSFRONT PLUS | FREEDOM FRONT PLUS"};
  const canon = n => { const c = n.replace(/\s+/g, " ").trim(); return RENAME[c] || c; };

  function readURL(){
    const q = new URLSearchParams(location.search), a = q.get("area") || "";
    return {baseline: q.get("baseline") === "2016" ? "2016" : "2021", area: a, sel: q.get("sel") || ""};
  }
  const urlFor = s => "?" + new URLSearchParams(Object.entries({baseline: s.baseline, ballot: "municipal-pr", area: s.area, sel: s.sel}).filter(([, v]) => v));
  let st = readURL();
  const save = (push = true) => history[push ? "pushState" : "replaceState"](null, "", urlFor(st));

  const snaps = {}, lists = {};
  let cmp, pts;
  try{ [snaps[2026], cmp, pts] = await Promise.all([L.snapshot(2026), L.compareInfo(), L.points()]); lists[2026] = await snaps[2026].municipalities(); }
  catch(e){ $("lead").innerHTML = `<span class="pg-error">Results could not be loaded. <a href="">Try again</a>.</span>`; return; }
  async function year(y){ if(!snaps[y]){ snaps[y] = await L.snapshot(+y); lists[y] = await snaps[y].municipalities(); } return lists[y]; }
  const byCode = Object.fromEntries(lists[2026].map(m => [m.code, m]));
  Object.keys(L.PROV).forEach(p => $("scope").insertAdjacentHTML("beforeend", `<option value="${L.PROV[p]}">${p}</option>`));

  // ---------- numbers ----------
  const fmtV = L.fmtVotes, sgn = L.fmtDelta;
  function totals(units){   // sum all ballots/parties for a set of units on the PR ballot
    const t = {valid: 0, votes: {}};
    for(const u of units){ const x = u.ballots[BALLOT]; if(!x) return null; t.valid += x.valid; for(const [p, v] of Object.entries(x.votes)){ const c = canon(p); t.votes[c] = (t.votes[c] || 0) + v; } }
    return t;
  }
  function decomp(d0, v0, d1, v1){
    if(!(v0 > 0 && v1 > 0)) return null;
    const s0 = d0 / v0, s1 = d1 / v1;
    return {share: (s1 - s0) * (v0 + v1) / 2, volume: (v1 - v0) * (s0 + s1) / 2};
  }
  const pattern = r => (r.ch.dvotes >= 0 ? "+" : "-") + (r.ch.dpp >= 0 ? "+" : "-");
  function leadSentence(d0, v0, d1, v1, where){
    const dv = d1 - d0, dpp = 100 * (d1 / v1 - d0 / v0), n = fmtV(Math.abs(dv)), x = Math.abs(dpp).toFixed(1);
    const smallV = dv === 0, smallS = Math.abs(dpp) < 0.05;
    if(smallV && smallS) return `In ${where}, the DA's vote total and share were almost exactly the same as before.`;
    if(smallS) return `In ${where}, the DA received ${n} ${dv > 0 ? "more" : "fewer"} votes, and its share was almost unchanged.`;
    if(smallV) return `In ${where}, the DA's vote total was unchanged and its share ${dpp > 0 ? "rose" : "fell"} by ${x} percentage points.`;
    if(dv > 0 && dpp > 0) return `In ${where}, the DA received ${n} more votes and increased its share by ${x} percentage points.`;
    if(dv < 0 && dpp > 0) return `In ${where}, the DA's share rose by ${x} points, while its vote total fell by ${n}.`;
    if(dv > 0 && dpp < 0) return `In ${where}, the DA received ${n} more votes, but its share fell by ${x} points.`;
    return `In ${where}, the DA received ${n} fewer votes and its share fell by ${x} points.`;
  }

  // ---------- scope data ----------
  let D = null, reqKey = 0;
  async function load(){
    const key = ++reqKey, B = st.baseline, mb = Object.fromEntries((await year(B)).map(m => [m.code, m]));
    const isMun = st.area && byCode[st.area], prov = !isMun && st.area ? L.provByCode(st.area) : "";
    let scopeName, cur, old, rows, unit, scopeOK = true, scopeNote = "";
    if(isMun){
      const m = byCode[st.area]; scopeName = m.name; unit = "ward";
      const ok = cmp.baselines[B].munics[st.area].ok;
      cur = [m]; old = [mb[st.area]]; scopeOK = ok; if(!ok) scopeNote = cmp.baselines[B].munics[st.area].reason;
      const [f1, f0, feats] = await Promise.all([snaps[2026].municipality(st.area), snaps[B].municipality(st.area), atlas.showWards(st.area)]);
      const match = cmp.baselines[B].wards[st.area] || {}, wp = Object.fromEntries(feats.map(f => [String(f.properties.WardId), f.properties.pt]));
      rows = Object.entries(f1.wards).map(([id, w]) => { const bw = match[id] && f0.wards[match[id]]; const ch = bw ? L.changeRow(w, bw, BALLOT) : null;
        return {code: id, name: `Ward ${L.wardNo(id)}`, parent: m.name, ch, pt: wp[id], why: bw ? (ch ? "Same voting districts as " + B + " ward " + L.wardNo(match[id]) : "No valid votes") : "Ward boundaries changed"}; })
        .sort((a, c) => L.wardNo(a.code) - L.wardNo(c.code));
    }else{
      atlas.clearWards();
      scopeName = prov || "South Africa"; unit = "municipality";
      cur = lists[2026].filter(m => !prov || m.province === prov); old = cur.map(m => mb[m.code]);
      rows = cur.map(m => { const ok = cmp.baselines[B].munics[m.code].ok, ch = ok ? L.changeRow(m, mb[m.code], BALLOT) : null;
        return {code: m.code, name: m.name, parent: m.province, ch, pt: pts.munics[m.code], why: ok ? (ch ? "Comparable boundaries" : "No valid votes") : cmp.baselines[B].munics[m.code].reason}; });
    }
    if(key !== reqKey) return false;
    D = {B, scopeName, isMun, prov, cur, old, rows, unit, scopeOK, scopeNote, t1: totals(cur), t0: totals(old)};
    return true;
  }

  // ---------- figures ----------
  const W = el => Math.max(280, el.clientWidth || el.parentNode.clientWidth || 600);
  function figVotes(d0, d1){
    const svg = $("figVotes"), w = W(svg), h = 110, x = v => 70 + v / Math.max(d0, d1) * (w - 190);
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`); svg.setAttribute("aria-label", `DA votes: ${D.B} ${fmtV(d0)}, 2026 ${fmtV(d1)}`);
    svg.innerHTML = `<line x1="70" x2="70" y1="10" y2="${h - 10}" stroke="${MUTE}"/>
      <text x="62" y="38" text-anchor="end">${D.B}</text><rect x="70" y="22" width="${x(d0) - 70}" height="24" fill="#fff" stroke="${BLUE}" stroke-width="1.5"/><text x="${x(d0) + 6}" y="39">${fmtV(d0)}</text>
      <text x="62" y="80" text-anchor="end" font-weight="700">2026</text><rect x="70" y="64" width="${x(d1) - 70}" height="24" fill="${BLUE}"/><text x="${x(d1) + 6}" y="81" font-weight="700">${fmtV(d1)}</text>`;
  }
  function figShare(s0, s1){
    const svg = $("figShare"), w = W(svg), h = 110, x = v => 16 + v / 100 * (w - 32), a = x(s0), b = x(s1);
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`); svg.setAttribute("aria-label", `DA share: ${D.B} ${s0.toFixed(1)}%, 2026 ${s1.toFixed(1)}%`);
    const close = Math.abs(b - a) < 90;
    svg.innerHTML = `<line x1="16" x2="${w - 16}" y1="56" y2="56" stroke="${RULE}"/>${[0, 25, 50, 75, 100].map(v => `<line x1="${x(v)}" x2="${x(v)}" y1="52" y2="60" stroke="#b5bdc5"/><text x="${x(v)}" y="78" text-anchor="middle">${v}%</text>`).join("")}
      <line x1="${a}" x2="${b}" y1="56" y2="56" stroke="${MUTE}" stroke-width="2"/><circle cx="${a}" cy="56" r="7" fill="#fff" stroke="${INK}" stroke-width="2"/><circle cx="${b}" cy="56" r="7" fill="${BLUE}"/>
      ${close ? `<text x="${Math.min(Math.max((a + b) / 2, 110), w - 110)}" y="34" text-anchor="middle">○ ${D.B} ${s0.toFixed(1)}% → ● 2026 <tspan font-weight="700">${s1.toFixed(1)}%</tspan></text>`
        : `<text x="${a}" y="34" text-anchor="middle">${D.B}: ${s0.toFixed(1)}%</text><text x="${b}" y="34" text-anchor="middle" font-weight="700">2026: ${s1.toFixed(1)}%</text>`}
      <text x="${w / 2}" y="102" text-anchor="middle" font-weight="700" fill="${s1 >= s0 ? BLUE : ORANGE}">${L.fmtPP(s1 - s0)}</text>`;
  }
  function figParties(){
    const t0 = D.t0, t1 = D.t1, names = new Set([...Object.keys(t0.votes), ...Object.keys(t1.votes)]);
    const all = [...names].map(p => ({p, v0: t0.votes[p], v1: t1.votes[p], d: (t1.votes[p] || 0) - (t0.votes[p] || 0)}));
    const top = [...all].sort((a, b) => Math.abs(b.d) - Math.abs(a.d) || a.p.localeCompare(b.p)).slice(0, 10);
    if(!top.some(r => r.p === L.DA)) top.push(all.find(r => r.p === L.DA) || {p: L.DA, d: 0});
    const rest = all.filter(r => !top.includes(r)), other = {p: "Other parties combined", d: rest.reduce((a, r) => a + r.d, 0), other: true, n: rest.length};
    const rows = [...top.sort((a, b) => b.d - a.d || a.p.localeCompare(b.p)), other];
    const svg = $("figParties"), w = W(svg), rh = 30, h = rows.length * rh + 30, lab = Math.min(170, w * 0.32), M = Math.max(...rows.map(r => Math.abs(r.d)), 1);
    const mid = lab + (w - lab) / 2, sc = v => v / M * ((w - lab) / 2 - 70);
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.innerHTML = `<line x1="${mid}" x2="${mid}" y1="4" y2="${h - 20}" stroke="${MUTE}"/>` + rows.map((r, i) => {
      const y = 10 + i * rh, x0 = Math.min(mid, mid + sc(r.d)), bw = Math.abs(sc(r.d));
      const name = r.other ? `Other parties (${r.n})` : L.partyShort(r.p);
      const tip = r.other ? "" : `<title>${E(L.titleCase(r.p))}: ${r.v0 != null ? fmtV(r.v0) : "not listed"} in ${D.B}, ${r.v1 != null ? fmtV(r.v1) : "not listed"} in 2026</title>`;
      return `<g>${tip}<text x="${lab - 8}" y="${y + 15}" text-anchor="end"${r.p === L.DA ? ' font-weight="700"' : ""}>${E(name)}${!r.other && r.v0 == null ? " *" : ""}</text>
        <rect x="${x0}" y="${y + 3}" width="${Math.max(bw, 1)}" height="${rh - 10}" fill="${r.other ? "#9aa5b0" : L.partyColour(r.p)}"/>
        <text x="${r.d >= 0 ? mid + bw + 6 : mid - bw - 6}" y="${y + 15}" text-anchor="${r.d >= 0 ? "start" : "end"}">${sgn(r.d)}</text></g>`;
    }).join("") + `<text x="${mid}" y="${h - 4}" text-anchor="middle" fill="${MUTE}">change in votes</text>`;
    const sum = all.reduce((a, r) => a + r.d, 0), dvalid = t1.valid - t0.valid;
    $("partiesIntro").textContent = `Change in votes by party on the municipal PR ballot in ${D.scopeName}, ${D.B} to 2026. Bars keep each party's own colour; the zero line and the signs show the direction.`;
    $("partiesNote").textContent = `All parties' changes add up to ${sgn(sum)}, the change in valid votes (${fmtV(t0.valid)} → ${fmtV(t1.valid)}, ${sgn(dvalid)})${sum === dvalid ? "" : " (these totals do not add up; please report this)"}. * not listed in ${D.B}: its whole 2026 total counts as change. Several parties can gain at once when more ballots are cast. These totals do not show voters moving from one party to another.`;
  }

  // waterfall of DA vote change by place
  let wfGroups = {};
  function figWaterfall(ok){
    const pos = ok.filter(r => r.ch.dvotes > 0).sort((a, b) => b.ch.dvotes - a.ch.dvotes || a.code.localeCompare(b.code));
    const neg = ok.filter(r => r.ch.dvotes < 0).sort((a, b) => a.ch.dvotes - b.ch.dvotes || a.code.localeCompare(b.code));
    const comp = [...pos.slice(0, 5).map(r => ({label: r.name, v: r.ch.dvotes, rows: [r]})),
      ...(pos.length > 5 ? [{label: `Other gains (${pos.length - 5} places)`, v: pos.slice(5).reduce((a, r) => a + r.ch.dvotes, 0), rows: pos.slice(5)}] : []),
      ...neg.slice(0, 5).map(r => ({label: r.name, v: r.ch.dvotes, rows: [r]})),
      ...(neg.length > 5 ? [{label: `Other losses (${neg.length - 5} places)`, v: neg.slice(5).reduce((a, r) => a + r.ch.dvotes, 0), rows: neg.slice(5)}] : [])];
    const net = ok.reduce((a, r) => a + r.ch.dvotes, 0);
    let run = 0; const steps = comp.map(c => { const s = {...c, from: run, to: run + c.v}; run += c.v; return s; });
    const svg = $("figWaterfall"), w = W(svg), rh = 28, h = (steps.length + 1) * rh + 34, lab = Math.min(190, w * 0.36);
    const lo = Math.min(0, ...steps.map(s => Math.min(s.from, s.to))), hi = Math.max(0, ...steps.map(s => Math.max(s.from, s.to)));
    const x = v => lab + 10 + (v - lo) / ((hi - lo) || 1) * (w - lab - 90);
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    wfGroups = {};
    svg.innerHTML = `<line x1="${x(0)}" x2="${x(0)}" y1="4" y2="${h - 24}" stroke="${MUTE}"/>` + steps.map((s, i) => {
      const y = 6 + i * rh; wfGroups[i] = s.rows;
      return `<g class="wf" data-i="${i}" tabindex="0" role="button" aria-label="${E(s.label)} ${sgn(s.v)} votes"><text x="${lab}" y="${y + 15}" text-anchor="end">${E(s.label.length > 26 ? s.label.slice(0, 25) + "…" : s.label)}</text>
        <rect x="${x(Math.min(s.from, s.to))}" y="${y + 3}" width="${Math.max(1, Math.abs(x(s.to) - x(s.from)))}" height="${rh - 10}" fill="${s.v >= 0 ? BLUE : ORANGE}"/>
        <text x="${x(Math.max(s.from, s.to)) + 6}" y="${y + 15}">${sgn(s.v)}</text></g>`;
    }).join("") + (() => { const y = 6 + steps.length * rh;
      return `<text x="${lab}" y="${y + 15}" text-anchor="end" font-weight="700">Net change</text><rect x="${x(Math.min(0, net))}" y="${y + 3}" width="${Math.max(1, Math.abs(x(net) - x(0)))}" height="${rh - 10}" fill="none" stroke="${INK}" stroke-width="2"/>
        <text x="${x(Math.max(0, net)) + 6}" y="${y + 15}" font-weight="700">${sgn(net)}</text>`; })()
      + `<text x="${x(0)}" y="${h - 6}" text-anchor="middle" fill="${MUTE}">DA votes, running total from 0</text>`;
    svg.querySelectorAll(".wf").forEach(g => { const go = () => { const rs = wfGroups[g.dataset.i]; if(rs.length === 1) select(rs[0].code); else { $("pattern").value = ""; showGroup(rs); } };
      g.onclick = go; g.onkeydown = e => { if(e.key === "Enter" || e.key === " "){ e.preventDefault(); go(); } }; });
    $("wfNote").textContent = `Gains and losses of all ${ok.length} comparable ${D.unit === "ward" ? "wards" : "municipalities"} add up to the net change shown last (${sgn(net)}). Click a bar to select the place; click an “Other” bar to list its places in the table.`;
  }
  let groupRows = null;
  function showGroup(rows){ groupRows = rows; table(); $("h-table").scrollIntoView({behavior: L.prefersReduced() ? "auto" : "smooth"}); }

  // scatter
  let sPts = [];
  function figScatter(ok){
    const svg = $("figScatter"), w = W(svg), h = Math.min(480, Math.max(320, w * 0.6)), p = {l: 64, r: 16, t: 20, b: 44};
    const xs = ok.map(r => r.ch.dvotes), ys = ok.map(r => r.ch.dpp);
    const pad = (a, b) => { const d = (b - a) * 0.06 || 1; return [a - d, b + d]; };
    const [x0, x1] = pad(Math.min(0, ...xs), Math.max(0, ...xs)), [y0, y1] = pad(Math.min(0, ...ys), Math.max(0, ...ys));
    const X = v => p.l + (v - x0) / (x1 - x0) * (w - p.l - p.r), Y = v => h - p.b - (v - y0) / (y1 - y0) * (h - p.t - p.b);
    const vmax = Math.max(...ok.map(r => r.ch.v1), 1), R = v => 18 * Math.sqrt(v / vmax);
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    const ticks = (a, b) => { const st_ = (10 ** Math.floor(Math.log10((b - a) / 4 || 1))); const k = [1, 2, 5, 10].map(m => m * st_).find(m => (b - a) / m <= 6); const out = []; for(let t = Math.ceil(a / k) * k; t <= b; t += k) out.push(+t.toFixed(6)); return out; };
    let g = ticks(x0, x1).map(t => `<line x1="${X(t)}" x2="${X(t)}" y1="${p.t}" y2="${h - p.b}" stroke="#eef0f2"/><text x="${X(t)}" y="${h - p.b + 16}" text-anchor="middle">${sgn(t)}</text>`).join("")
      + ticks(y0, y1).map(t => `<line x1="${p.l}" x2="${w - p.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="#eef0f2"/><text x="${p.l - 6}" y="${Y(t) + 4}" text-anchor="end">${L.fmtPP(t, Number.isInteger(t) ? 0 : 1).replace(" pp", "")}</text>`).join("");
    g += `<line x1="${X(0)}" x2="${X(0)}" y1="${p.t}" y2="${h - p.b}" stroke="${MUTE}"/><line x1="${p.l}" x2="${w - p.r}" y1="${Y(0)}" y2="${Y(0)}" stroke="${MUTE}"/>
      <text x="${w - p.r}" y="${h - 6}" text-anchor="end" fill="${MUTE}">change in DA votes →</text><text x="12" y="${p.t - 6}" fill="${MUTE}">change in DA share (pp) ↑</text>
      <text x="${w - p.r - 4}" y="${p.t + 14}" text-anchor="end" class="q">More votes, higher share</text><text x="${p.l + 4}" y="${p.t + 14}" class="q">Fewer votes, higher share</text>
      <text x="${w - p.r - 4}" y="${h - p.b - 8}" text-anchor="end" class="q">More votes, lower share</text><text x="${p.l + 4}" y="${h - p.b - 8}" class="q">Fewer votes, lower share</text>`;
    sPts = ok.map(r => ({r, x: X(r.ch.dvotes), y: Y(r.ch.dpp), rad: R(r.ch.v1)}));
    g += [...sPts].sort((a, b) => b.rad - a.rad).map(s => `<circle cx="${s.x}" cy="${s.y}" r="${Math.max(s.rad, 0.8)}" fill="${BLUE}" fill-opacity=".45" stroke="${s.r.code === st.sel ? INK : BLUE}" stroke-width="${s.r.code === st.sel ? 2.5 : 0.6}"/>`).join("");
    svg.innerHTML = g;
    svg.setAttribute("aria-label", `Scatterplot of ${ok.length} places: change in DA votes against change in DA share`);
    const n = q => ok.filter(r => pattern(r) === q).length;
    $("scatterIntro").textContent = `${ok.length} comparable ${D.unit === "ward" ? "wards" : "municipalities"}: ${n("++")} got more DA votes and a higher share, ${n("+-")} more votes but a lower share, ${n("-+")} fewer votes but a higher share, and ${n("--")} fewer votes and a lower share.`;
  }
  // nearest-point inspection on the scatter (no focusable circles; the table is the keyboard route)
  const sSvg = $("figScatter"), sTip = $("sTip");
  function nearest(ev){
    const b = sSvg.getBoundingClientRect(), vb = sSvg.viewBox.baseVal, k = vb.width / b.width, mx = (ev.clientX - b.left) * k, my = (ev.clientY - b.top) * k;
    let best = null, bd = 400 * k * k; for(const s of sPts){ const d = (s.x - mx) ** 2 + (s.y - my) ** 2; if(d < bd){ bd = d; best = s; } }
    return best && {s: best, px: ev.clientX - b.left, py: ev.clientY - b.top};
  }
  sSvg.addEventListener("mousemove", ev => { const n = nearest(ev); if(!n){ sTip.hidden = true; return; } const r = n.s.r;
    sTip.innerHTML = `<b>${E(r.name)}</b>${D.unit === "ward" ? "" : `<br><span class="tip-mute">${E(r.parent)}</span>`}<br>DA votes ${fmtV(r.ch.d0)} → ${fmtV(r.ch.d1)} (${sgn(r.ch.dvotes)})<br>DA share ${L.fmtPct(r.ch.s0)} → ${L.fmtPct(r.ch.s1)} (${L.fmtPP(r.ch.dpp)})<br>Valid votes ${fmtV(r.ch.v0)} → ${fmtV(r.ch.v1)}`;
    sTip.hidden = false; const pw = sSvg.parentNode.clientWidth; sTip.style.left = Math.min(n.px + 14, pw - sTip.offsetWidth - 4) + "px"; sTip.style.top = (n.py + 14) + "px"; });
  sSvg.addEventListener("mouseleave", () => sTip.hidden = true);
  sSvg.addEventListener("click", ev => { const n = nearest(ev); if(n) select(n.s.r.code); });

  // four cases
  function cases(ok){
    const MIN = 1000, titles = {"++": "More votes and a larger share", "-+": "A larger share of a smaller vote total", "+-": "More votes, but a smaller share", "--": "Fewer votes and a smaller share"};
    $("casesIntro").textContent = `For each pattern, the comparable ${D.unit} with the biggest change in DA share among places with at least ${fmtV(MIN)} valid votes in both elections (ties broken by code). The threshold only applies to these examples, not to the charts or table.`;
    $("cases").innerHTML = Object.entries(titles).map(([q, t]) => {
      const c = ok.filter(r => pattern(r) === q && r.ch.v0 >= MIN && r.ch.v1 >= MIN).sort((a, b) => Math.abs(b.ch.dpp) - Math.abs(a.ch.dpp) || a.code.localeCompare(b.code))[0];
      if(!c) return `<div class="vt-case"><h3>${t}</h3><p class="note">No ${D.unit} in this area fits this pattern.</p></div>`;
      return `<div class="vt-case"><h3>${t}: ${E(c.name)}${D.unit === "ward" ? "" : `, ${E(c.parent)}`}</h3>${caseBody(c)}</div>`;
    }).join("");
    wireLinks($("cases"));
  }
  function caseBody(c){
    const r = c.ch, vf = r.v1 < r.v0 ? "fell" : r.v1 > r.v0 ? "rose" : "stayed the same";
    let why;
    if(r.dvotes >= 0 && r.dpp >= 0) why = `DA votes grew faster than all valid votes${r.v1 < r.v0 ? ", which fell" : ""}.`;
    else if(r.dvotes < 0 && r.dpp >= 0) why = `Valid votes ${vf} from ${fmtV(r.v0)} to ${fmtV(r.v1)}. DA votes fell by a smaller proportion, so its share went up.`;
    else if(r.dvotes >= 0 && r.dpp < 0) why = `Valid votes ${vf} from ${fmtV(r.v0)} to ${fmtV(r.v1)}, faster than DA votes grew, so the DA's share went down.`;
    else why = `DA votes fell${r.v1 < r.v0 ? " faster than all valid votes" : " while valid votes " + vf}, so its share went down too.`;
    return `<p class="vt-nums">DA votes <b>${fmtV(r.d0)} → ${fmtV(r.d1)}</b> (${sgn(r.dvotes)}) · DA share <b>${L.fmtPct(r.s0)} → ${L.fmtPct(r.s1)}</b> (${L.fmtPP(r.dpp)}) · valid votes ${fmtV(r.v0)} → ${fmtV(r.v1)}</p>
      <p class="vt-why">${why}</p><p class="vt-links"><button type="button" class="linkbtn" data-sel="${c.code}">Show how it adds up</button> · <a href="explore.html?${D.unit === "ward" ? `area=${st.area}&ward=${c.code}` : `area=${c.code}`}">Every result</a> · <a href="shift.html?baseline=${D.B}&${D.unit === "ward" ? `area=${st.area}&level=ward&ward=${c.code}` : `area=${c.code}`}">The shift</a></p>`;
  }
  function wireLinks(el){ el.querySelectorAll("[data-sel]").forEach(b => b.onclick = () => select(b.dataset.sel, true)); }

  // decomposition for the selected place (or the whole area)
  function selected(){
    const r = st.sel && D.rows.find(x => x.code === st.sel);
    if(r) return {name: r.name + (D.unit === "ward" ? ", " + D.scopeName : ""), ch: r.ch, why: r.why};
    if(!D.scopeOK) return {name: D.scopeName, ch: null, why: D.scopeNote};
    const d0 = D.t0.votes[L.DA] || 0, d1 = D.t1.votes[L.DA] || 0;
    return {name: D.scopeName, ch: {d0, d1, v0: D.t0.valid, v1: D.t1.valid, s0: 100 * d0 / D.t0.valid, s1: 100 * d1 / D.t1.valid, dvotes: d1 - d0, dpp: 100 * (d1 / D.t1.valid - d0 / D.t0.valid)}};
  }
  function selection(){
    const s = selected();
    $("selIntro").innerHTML = `The DA's vote change in <b>${E(s.name)}</b>, split into a part that comes from its share changing and a part that comes from the number of valid votes changing. Calculated from IEC results; it does not show which voters changed their minds or stayed home.${st.sel ? ` <button type="button" class="linkbtn" id="clearSel">Back to ${E(D.scopeName)}</button>` : ""}`;
    if($("clearSel")) $("clearSel").onclick = () => select("");
    if(!s.ch){ $("sel").innerHTML = `<p class="dt-line">No comparison for this place: ${E(s.why)}.</p>`; return; }
    const r = s.ch, dc = decomp(r.d0, r.v0, r.d1, r.v1);
    if(!dc){ $("sel").innerHTML = `<p>Not available: no valid votes in one of the years.</p>`; return; }
    const steps = [["Share part", dc.share], ["Ballot-volume part", dc.volume]];
    const w = Math.min(640, W($("sel"))), lab = 150, rh = 32, h = 3 * rh + 28;
    const vals = [0, dc.share, dc.share + dc.volume], lo = Math.min(...vals), hi = Math.max(...vals), x = v => lab + 10 + (v - lo) / ((hi - lo) || 1) * (w - lab - 110);
    const f1 = v => (v >= 0 ? "+" : "−") + L.fmtVotes(Math.floor(Math.abs(v))) + "." + Math.floor((Math.abs(v) % 1) * 10);
    let run = 0, g = `<line x1="${x(0)}" x2="${x(0)}" y1="2" y2="${h - 22}" stroke="${MUTE}"/>`;
    steps.forEach(([t, v], i) => { const y = 4 + i * rh; g += `<text x="${lab}" y="${y + 16}" text-anchor="end">${t}</text><rect x="${x(Math.min(run, run + v))}" y="${y + 4}" width="${Math.max(1, Math.abs(x(run + v) - x(run)))}" height="${rh - 12}" fill="${v >= 0 ? BLUE : ORANGE}"/><text x="${x(Math.max(run, run + v)) + 6}" y="${y + 16}">${f1(v)}</text>`; run += v; });
    const y = 4 + 2 * rh; g += `<text x="${lab}" y="${y + 16}" text-anchor="end" font-weight="700">Actual change</text><rect x="${x(Math.min(0, r.dvotes))}" y="${y + 4}" width="${Math.max(1, Math.abs(x(r.dvotes) - x(0)))}" height="${rh - 12}" fill="none" stroke="${INK}" stroke-width="2"/><text x="${x(Math.max(0, r.dvotes)) + 6}" y="${y + 16}" font-weight="700">${sgn(r.dvotes)}</text>`;
    $("sel").innerHTML = `<p class="vt-nums">DA votes <b>${fmtV(r.d0)} → ${fmtV(r.d1)}</b> (${sgn(r.dvotes)}) · valid votes <b>${fmtV(r.v0)} → ${fmtV(r.v1)}</b> · DA share <b>${L.fmtPct(r.s0)} → ${L.fmtPct(r.s1)}</b> (${L.fmtPP(r.dpp)})</p>
      <svg class="vt-fig" viewBox="0 0 ${w} ${h}" width="${w}" role="img" aria-label="Share part ${f1(dc.share)} votes, ballot-volume part ${f1(dc.volume)} votes, actual change ${sgn(r.dvotes)}">${g}</svg>
      <p class="note">Share part: the change in DA share applied to the average number of valid votes. Ballot-volume part: the change in valid votes at the average DA share. The parts are rounded for display; unrounded they add up exactly to the actual change.</p>`;
  }

  // table
  let sortKey = "abs", sortDir = -1;
  const COLS = [["name", "Place"], ["parent", D_parent()], ["d0", "DA votes, then"], ["d1", "DA votes, 2026"], ["dv", "Vote change"], ["s0", "DA share, then"], ["s1", "DA share, 2026"], ["dpp", "Change (pp)"], ["v0", "Valid, then"], ["v1", "Valid, 2026"], ["why", "Comparison"]];
  function D_parent(){ return "Province / municipality"; }
  const val = (r, k) => k === "abs" ? (r.ch ? Math.abs(r.ch.dvotes) : null) : k === "name" || k === "parent" || k === "why" ? r[k] : r.ch ? {d0: r.ch.d0, d1: r.ch.d1, dv: r.ch.dvotes, s0: r.ch.s0, s1: r.ch.s1, dpp: r.ch.dpp, v0: r.ch.v0, v1: r.ch.v1}[k] : null;
  function tableRows(){
    const f = $("pattern").value;
    let rows = groupRows || D.rows.filter(r => !f || (f === "x" ? !r.ch : r.ch && pattern(r) === f));
    return [...rows].sort((a, b) => { const x = val(a, sortKey), y = val(b, sortKey);
      if(x == null && y == null) return a.code.localeCompare(b.code); if(x == null) return 1; if(y == null) return -1;
      return (typeof x === "string" ? x.localeCompare(y) : x - y) * sortDir || a.code.localeCompare(b.code); });
  }
  function table(){
    const rows = tableRows();
    $("table").innerHTML = `<caption class="sr-only">Every place in ${E(D.scopeName)}</caption><thead><tr>${COLS.map(([k, t]) => `<th scope="col" aria-sort="${k === sortKey ? (sortDir > 0 ? "ascending" : "descending") : "none"}"><button type="button" data-k="${k}">${t.replace("then", D.B).replace("Province / municipality", D.unit === "ward" ? "Municipality" : "Province")}</button></th>`).join("")}</tr></thead>
      <tbody>${groupRows ? `<tr><td colspan="11"><button type="button" class="linkbtn" id="ungroup">Showing ${rows.length} places from one bar. Show all places</button></td></tr>` : ""}
      ${rows.map(r => `<tr${r.code === st.sel ? ' class="on"' : ""}><th scope="row"><button type="button" class="linkbtn" data-sel="${r.code}">${E(r.name)}</button></th><td>${E(r.parent)}</td>
      ${r.ch ? `<td class="n">${fmtV(r.ch.d0)}</td><td class="n">${fmtV(r.ch.d1)}</td><td class="n">${sgn(r.ch.dvotes)}</td><td class="n">${L.fmtPct(r.ch.s0)}</td><td class="n">${L.fmtPct(r.ch.s1)}</td><td class="n">${L.fmtPP(r.ch.dpp)}</td><td class="n">${fmtV(r.ch.v0)}</td><td class="n">${fmtV(r.ch.v1)}</td>` : `<td class="n" colspan="8">–</td>`}
      <td class="st">${E(r.why)}</td></tr>`).join("")}</tbody>`;
    $("table").querySelectorAll("thead button").forEach(b => b.onclick = () => { const k = b.dataset.k; sortDir = sortKey === k ? -sortDir : (["name", "parent", "why"].includes(k) ? 1 : -1); sortKey = k; table(); });
    if($("ungroup")) $("ungroup").onclick = () => { groupRows = null; table(); };
    wireLinks($("table"));
  }
  $("pattern").onchange = () => { groupRows = null; table(); };
  $("csv").onclick = () => L.downloadCSV(`lge2026-votes-${st.area || "ZA"}-vs${D.B}.csv`,
    ["id", "name", "parent", "ballot", "baseline_year", "current_year", "da_votes_baseline", "da_votes_2026", "vote_change", "da_share_baseline_pct", "da_share_2026_pct", "change_pp", "valid_baseline", "valid_2026", "comparable", "comparison_note", "snapshot_2026", "snapshot_baseline"],
    tableRows().map(r => [r.code, r.name, r.parent, "Municipal PR ballot", +D.B, 2026, r.ch && r.ch.d0, r.ch && r.ch.d1, r.ch && r.ch.dvotes, r.ch && r.ch.s0, r.ch && r.ch.s1, r.ch && r.ch.dpp, r.ch && r.ch.v0, r.ch && r.ch.v1, r.ch ? "yes" : "no", r.why, snaps[2026].manifest.snapshot, snaps[D.B].manifest.snapshot]));

  // ---------- map: circles sized by DA vote change ----------
  let circles = [], cMax = 1;
  const atlas = await Atlas.create({container: $("atlas"), loadingText: "Loading the map…",
    hover: (kind, p) => { const r = D && D.rows.find(x => x.code === (kind === "ward" ? String(p.WardId) : p.MunicCode)); if(!r) return null;
      return `<b>${E(r.name)}</b><br>${r.ch ? `DA votes ${fmtV(r.ch.d0)} → ${fmtV(r.ch.d1)} (${sgn(r.ch.dvotes)})<br>DA share ${L.fmtPct(r.ch.s0)} → ${L.fmtPct(r.ch.s1)} (${L.fmtPP(r.ch.dpp)})` : `<span class="tip-mute">${E(r.why)}</span>`}`; },
    onClick: (kind, p) => { const code = kind === "ward" ? String(p.WardId) : p.MunicCode; if(D.rows.find(x => x.code === code)) select(code); },
    draw: project => circles.map(c => { const [x, y] = project(c.pt), r = 32 * Math.sqrt(Math.abs(c.v) / cMax);
      return c.v === 0 ? `<line x1="${x - 3}" x2="${x + 3}" y1="${y}" y2="${y}" stroke="#8f9aa5" stroke-width="1.5"/>`
        : `<circle cx="${x}" cy="${y}" r="${r}" fill="${c.v > 0 ? BLUE : ORANGE}" fill-opacity=".35" stroke="${c.sel ? INK : c.v > 0 ? BLUE : ORANGE}" stroke-width="${c.sel ? 2.5 : 1}"/>`; }).join("")});

  function mapView(ok){
    const all = D.rows;
    cMax = Math.max(1, ...ok.map(r => Math.abs(r.ch.dvotes)));
    circles = ok.filter(r => r.pt).sort((a, b) => Math.abs(b.ch.dvotes) - Math.abs(a.ch.dvotes)).map(r => ({pt: r.pt, v: r.ch.dvotes, sel: r.code === st.sel}));
    if(D.unit === "ward"){
      atlas.paintMunics(Object.fromEntries(lists[2026].map(m => [m.code, m.code === st.area ? null : "#f6f7f9"])));
      atlas.paintWards(Object.fromEntries(all.map(r => [r.code, r.ch ? "#f1f3f5" : "#e2e6ea"])));
      atlas.selectWard(st.sel); atlas.select(st.area);
    }else{
      const inScope = Object.fromEntries(all.map(r => [r.code, r]));
      atlas.paintMunics(Object.fromEntries(lists[2026].map(m => [m.code, !inScope[m.code] ? "#f6f7f9" : inScope[m.code].ch ? "#f1f3f5" : "#e2e6ea"])));
      atlas.select(st.sel); atlas.selectWard("");
    }
    atlas.redraw();
    const ex = [cMax, cMax / 10, cMax / 100].map(v => { const p = 10 ** Math.floor(Math.log10(v)); return Math.floor(v / p) * p; }).filter((v, i, a) => v >= 1 && a.indexOf(v) === i);
    $("legend").innerHTML = `<div class="lg-row">${ex.map(v => { const r = 32 * Math.sqrt(v / cMax); return `<span class="lg-arrow"><svg width="${2 * r + 4}" height="${2 * r + 4}" aria-hidden="true"><circle cx="${r + 2}" cy="${r + 2}" r="${r}" fill="none" stroke="${MUTE}"/></svg>${fmtV(v)} votes</span>`; }).join("")}
      <span class="lg-item"><i class="sw" style="background:${BLUE};opacity:.6"></i>DA votes added</span><span class="lg-item"><i class="sw" style="background:${ORANGE};opacity:.6"></i>DA votes lost</span><span class="lg-item"><i class="sw" style="background:#e2e6ea"></i>No comparison (boundaries changed)</span></div>
      <p class="lg-note">Circle area is proportional to the change in DA votes. Circles sit on the place they describe; they do not show people moving.</p>`;
    const up = ok.filter(r => r.ch.dvotes > 0).length, dn = ok.filter(r => r.ch.dvotes < 0).length;
    $("placesIntro").textContent = `${up} comparable ${D.unit === "ward" ? "wards" : "municipalities"} recorded more DA votes than in ${D.B}; ${dn} recorded fewer${ok.length - up - dn ? `; ${ok.length - up - dn} the same` : ""}. ${all.length - ok.length ? `${all.length - ok.length} more are left out because their boundaries changed.` : ""} These counts are places, not people.`;
  }

  // ---------- render ----------
  async function render(opts = {}){
    $("baseline").value = st.baseline; $("scope").value = st.area && !byCode[st.area] ? st.area : "";
    document.querySelector("main").setAttribute("aria-busy", "true");
    if(!await load()) return;
    document.querySelector("main").setAttribute("aria-busy", "false");
    $("basis").textContent = `${D.scopeName} · 2026 vs ${D.B} · Municipal PR ballot · ${snaps[2026].manifest.status === "final" && snaps[D.B].manifest.status === "final" ? "Final results, as declared by the IEC" : "Provisional"} · IEC data as of ${L.fmtSAST(snaps[2026].generated)}`;
    const ok = D.rows.filter(r => r.ch);
    if(D.scopeOK){
      const d0 = D.t0.votes[L.DA] || 0, d1 = D.t1.votes[L.DA] || 0;
      $("lead").textContent = leadSentence(d0, D.t0.valid, d1, D.t1.valid, D.scopeName);
      figVotes(d0, d1); figShare(100 * d0 / D.t0.valid, 100 * d1 / D.t1.valid);
      const dv = D.t1.valid - D.t0.valid, rel = (a, b) => (b - a) / a;
      $("leadNote").textContent = `Valid votes on the municipal PR ballot: ${fmtV(D.t0.valid)} in ${D.B}, ${fmtV(D.t1.valid)} in 2026 (${sgn(dv)}). ` +
        (d0 > 0 ? `DA votes changed by ${(100 * rel(d0, d1)).toFixed(1)}% and all valid votes by ${(100 * rel(D.t0.valid, D.t1.valid)).toFixed(1)}%; the DA's share rises when its votes grow faster (or fall slower) than the total.` : "") +
        `${D.prov || D.isMun ? "" : " Covers all " + D.cur.length + " local and metropolitan municipalities."}`;
      figParties();
    }else{
      $("lead").textContent = `${D.scopeName} can't be compared as a whole with ${D.B}: ${D.scopeNote.toLowerCase()}. Wards with unchanged voting districts are still compared below.`;
      ["figVotes", "figShare", "figParties"].forEach(id => $(id).innerHTML = ""); $("leadNote").textContent = ""; $("partiesIntro").textContent = ""; $("partiesNote").textContent = "Not shown: the area's boundary changed.";
    }
    if(ok.length){ mapView(ok); figWaterfall(ok); figScatter(ok); cases(ok); }
    else { $("placesIntro").textContent = `No comparable ${D.unit === "ward" ? "wards" : "municipalities"} here.`; ["figWaterfall", "figScatter"].forEach(id => $(id).innerHTML = ""); $("cases").innerHTML = ""; circles = []; atlas.redraw(); }
    groupRows = null; selection(); table();
    if(opts.zoom) D.isMun ? atlas.zoomTo(st.area) : D.prov ? atlas.zoomToProvince(D.prov) : atlas.zoomToSA();
    $("methodSource").textContent = `Data: 2026 snapshot ${snaps[2026].manifest.snapshot}, ${D.B} snapshot ${snaps[D.B].manifest.snapshot}. Comparability from data/archive/compare.json (scripts/compare.py).`;
  }
  function select(code, scroll){
    st.sel = code; save(); selection(); table(); if(D.rows.some(r => r.ch)){ mapView(D.rows.filter(r => r.ch)); figScatter(D.rows.filter(r => r.ch)); }
    if(scroll || code) $("h-sel").scrollIntoView({behavior: L.prefersReduced() ? "auto" : "smooth"});
    L.announce(code ? `Selected ${(D.rows.find(r => r.code === code) || {}).name}` : `Showing ${D.scopeName}`);
  }

  $("baseline").onchange = e => { st.baseline = e.target.value; save(); render(); };
  $("scope").onchange = e => { st.area = e.target.value; st.sel = ""; save(); render({zoom: true}); };
  window.addEventListener("popstate", () => { st = readURL(); render({zoom: true}); });
  let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => D && render(), 250); });
  const items = lists[2026].map(m => ({label: m.name, sub: `${m.province} · ${m.code}`, code: m.code, keys: (AKA[m.code] || "").toLowerCase()}));
  L.combobox($("q"), $("qlist"), q => L.searchItems(items, q), it => { st.area = it.code; st.sel = ""; save(); render({zoom: true}); }, "No matching municipality");
  save(false);
  render({zoom: !!st.area});
})();
