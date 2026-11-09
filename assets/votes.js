// Where votes changed: DA vote counts versus DA share, 2026 vs an earlier local election, on the
// municipal PR ballot. Everything is computed from official IEC counts in data/archive/.
(async function(){
  const L = window.LGE, K = window.Charts, C = K.C, $ = id => document.getElementById(id), E = L.esc, BALLOT = "pr";
  const AKA = {JHB: "Johannesburg", TSH: "Pretoria", ETH: "Durban", NMA: "Gqeberha", BUF: "East London", MAN: "Bloemfontein", EKU: "Ekurhuleni", CPT: "Cape Town"};
  const SHORT = {JHB: "Johannesburg", CPT: "Cape Town", TSH: "Tshwane", EKU: "Ekurhuleni", ETH: "eThekwini", NMA: "Nelson Mandela Bay", BUF: "Buffalo City", MAN: "Mangaung"};
  const nice = n => /[a-z]/.test(n) ? n : L.titleCase(n);   // some IEC names are all capitals
  const short = r => SHORT[r.code] || nice(r.name);
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
  try{ await document.fonts.ready; }catch(e){}
  async function year(y){ if(!snaps[y]){ snaps[y] = await L.snapshot(+y); lists[y] = await snaps[y].municipalities(); } return lists[y]; }
  const byCode = Object.fromEntries(lists[2026].map(m => [m.code, m]));
  Object.keys(L.PROV).forEach(p => $("scope").insertAdjacentHTML("beforeend", `<option value="${L.PROV[p]}">${p}</option>`));

  // ---------- numbers ----------
  const fmtV = L.fmtVotes, sgn = L.fmtDelta;
  const pts1 = x => L.fmtPP(x).replace(" pts", Math.abs(x).toFixed(1) === "1.0" ? " point" : " points");
  const ptsShort = x => L.fmtPP(x);
  function totals(units){   // sum all ballots/parties for a set of units on the PR ballot
    const t = {valid: 0, votes: {}};
    for(const u of units){ const x = u.ballots[BALLOT]; if(!x) return null; t.valid += x.valid; for(const [p, v] of Object.entries(x.votes)){ const c = canon(p); t.votes[c] = (t.votes[c] || 0) + v; } }
    return t;
  }
  // Split of a change in DA votes: (share change × average valid votes) + (valid-vote change × average share).
  function decomp(d0, v0, d1, v1){
    if(!(v0 > 0 && v1 > 0)) return null;
    const s0 = d0 / v0, s1 = d1 / v1;
    const volume = Math.round((v1 - v0) * (s0 + s1) / 2);   // rounded once; the share part is the rest, so the parts add up exactly
    return {share: (d1 - d0) - volume, volume, dv: d1 - d0};
  }
  const chOf = (d0, v0, d1, v1) => ({d0, d1, v0, v1, s0: 100 * d0 / v0, s1: 100 * d1 / v1, dvotes: d1 - d0, dpp: 100 * (d1 / v1 - d0 / v0)});
  const pattern = r => (r.ch.dvotes >= 0 ? "+" : "-") + (r.ch.dpp >= 0 ? "+" : "-");
  function leadSentence(d0, v0, d1, v1, where){
    const dv = d1 - d0, dpp = 100 * (d1 / v1 - d0 / v0), n = fmtV(Math.abs(dv)), x = Math.abs(dpp).toFixed(1);
    const smallV = dv === 0, smallS = Math.abs(dpp) < 0.05;
    if(smallV && smallS) return `In ${where}, the DA's vote total and share were almost exactly the same as in ${D.B}.`;
    if(smallS) return `In ${where}, the DA received ${n} ${dv > 0 ? "more" : "fewer"} votes than in ${D.B}, and its share was almost unchanged.`;
    if(smallV) return `In ${where}, the DA's vote total was unchanged and its share ${dpp > 0 ? "rose" : "fell"} by ${x} percentage points.`;
    if(dv > 0 && dpp > 0) return `In ${where}, the DA received ${n} more votes than in ${D.B} and increased its share by ${x} percentage points.`;
    if(dv < 0 && dpp > 0) return `In ${where}, the DA's share rose by ${x} percentage points, while its vote total fell by ${n}.`;
    if(dv > 0 && dpp < 0) return `In ${where}, the DA received ${n} more votes than in ${D.B}, but its share fell by ${x} percentage points.`;
    return `In ${where}, the DA received ${n} fewer votes than in ${D.B} and its share fell by ${x} percentage points.`;
  }

  // ---------- scope data ----------
  let D = null, reqKey = 0;
  async function load(){
    const key = ++reqKey, B = st.baseline, mb = Object.fromEntries((await year(B)).map(m => [m.code, m]));
    const isMun = st.area && byCode[st.area], prov = !isMun && st.area ? L.provByCode(st.area) : "";
    let scopeName, cur, old, rows, unit, scopeOK = true, scopeNote = "", groups = null;
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
      if(!prov) groups = Object.keys(L.PROV).map(p => {   // provinces: outer boundaries unchanged, so every municipality counts
        const c = cur.filter(m => m.province === p), t1 = totals(c), t0 = totals(c.map(m => mb[m.code])), ok = cmp.baselines[B].provinces[p] && cmp.baselines[B].provinces[p].ok;
        return {code: L.PROV[p], name: p, ok, ch: ok ? chOf(t0.votes[L.DA] || 0, t0.valid, t1.votes[L.DA] || 0, t1.valid) : null};
      });
    }
    if(key !== reqKey) return false;
    D = {B, scopeName, isMun, prov, cur, old, rows, unit, scopeOK, scopeNote, groups, t1: totals(cur), t0: totals(old)};
    D.units = unit === "ward" ? "wards" : "municipalities";
    D.where = isMun ? (SHORT[st.area] || nice(scopeName)) : prov ? (prov === "Western Cape" || prov === "Eastern Cape" || prov === "Northern Cape" || prov === "Free State" || prov === "North West" ? "the " + prov : prov) : "South Africa";
    return true;
  }

  // ---------- figures ----------
  const W = el => Math.max(280, Math.round(el.getBoundingClientRect().width || el.parentNode.clientWidth || 600));

  // Then-and-now bars on one zero line. The part that changed is marked under the 2026 bar: solid blue
  // for a gain, hatched orange for what the 2026 bar no longer covers.
  function figPair(id, v0, v1, fmt, chText, what){
    const svg = $(id), w = W(svg), lab = 44, room = K.textW(fmt(Math.max(v0, v1)), 13, 700) + 12, h = 94;
    const M = Math.max(v0, v1) || 1, x = v => lab + v / M * (w - lab - room), up = v1 > v0, dn = v1 < v0;
    const a = x(v0), b = x(v1), lo = Math.min(a, b), hi = Math.max(a, b), cw = K.textW(chText, 13, 700);
    const cx = Math.min(Math.max((lo + hi) / 2, lab + cw / 2), w - cw / 2 - 2);
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.setAttribute("aria-label", `${what}: ${D.B} ${fmt(v0)}, 2026 ${fmt(v1)}, change ${chText}`);
    svg.innerHTML = `<defs><pattern id="${id}H" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="${C.paper}"/><line x1="0" y1="0" x2="0" y2="6" stroke="${C.dn}" stroke-width="2.5"/></pattern></defs>
      <text x="${lab - 8}" y="21" text-anchor="end" class="ch-ax">${D.B}</text>
      <rect x="${lab}" y="6" width="${Math.max(1, a - lab)}" height="22" fill="#c9d1d9"/>
      <text x="${a + 6}" y="21" class="ch-val">${fmt(v0)}</text>
      <text x="${lab - 8}" y="55" text-anchor="end" class="ch-ax" font-weight="700" fill="${C.ink}">2026</text>
      <rect x="${lab}" y="40" width="${Math.max(1, (up ? a : b) - lab)}" height="22" fill="${C.up}" fill-opacity="${up ? .42 : 1}"/>
      ${up ? `<rect x="${a}" y="40" width="${b - a}" height="22" fill="${C.up}"/>` : dn ? `<rect x="${b + .75}" y="40.75" width="${a - b - 1.5}" height="20.5" fill="url(#${id}H)" stroke="${C.dn}" stroke-width="1.5"/>` : ""}
      <text x="${hi + 6}" y="55" class="ch-val" font-weight="700">${fmt(v1)}</text>
      <line x1="${lab}" x2="${lab}" y1="0" y2="66" stroke="${C.ink}"/>
      ${up || dn ? `<path d="M${lo},66 v4 H${hi} v-4" fill="none" stroke="${K.sideCol(v1 - v0)}" stroke-width="1.5"/>
        <text x="${cx}" y="88" text-anchor="middle" font-weight="700" class="ch-val" fill="${K.sideInk(v1 - v0)}">${chText}</text>` : ""}`;
  }

  // --- more votes cast, or a bigger share? ---
  const tipSplit = K.tip($("splitWrap"));
  function splitBar(p, M, z, big){
    const pct = v => 100 * v / M;
    let pos = 0, neg = 0, h = "";
    for(const [k, v] of [["share", p.share], ["volume", p.volume]]){
      if(!v) continue;
      const wv = Math.abs(pct(v)), left = v > 0 ? z + pos : z - neg - wv;
      if(v > 0) pos += wv; else neg += wv;
      h += `<i class="sp-seg" style="left:${left.toFixed(2)}%;width:${wv.toFixed(2)}%;background:${k === "share" ? K.sideCol(v) : C.slate}"></i>`;
    }
    // the net marker only when the two parts pull in opposite directions; otherwise the bar's end already shows it
    const mixed = p.share * p.volume < 0;
    return `<span class="sp-track${big ? " big" : ""}" aria-hidden="true"><span class="sp-zero" style="left:${z.toFixed(2)}%"></span>${h}${mixed ? `<span class="sp-net" style="left:${(z + pct(p.dv)).toFixed(2)}%"></span>` : ""}</span>`;
  }
  function scaleFor(list){
    const pos = Math.max(0, ...list.map(p => Math.max(0, p.share) + Math.max(0, p.volume))), neg = Math.max(0, ...list.map(p => -Math.min(0, p.share) - Math.min(0, p.volume)));
    const M = (pos + neg) * 1.02 || 1; return {M, z: 100 * neg / M};
  }
  const partWords = p => [[p.share, p.share >= 0 ? "from a bigger DA share" : "from a smaller DA share", K.sideCol(p.share)], [p.volume, p.volume >= 0 ? "from more people voting" : "from fewer people voting", C.slate]];
  function splitKey(p, net){
    return `<ul class="sp-key">${partWords(p).map(([v, t, c]) => `<li><i style="background:${c}"></i><b>${sgn(v)}</b> ${t}</li>`).join("")}${net ? `<li><i class="sp-netkey"></i>net change, where the two pull apart</li>` : ""}</ul>`;
  }
  function splitSentence(p, where){
    const s = p.share, v = p.volume, dv = p.dv, pv = Math.round(100 * v / dv / 5) * 5, ps = 100 - pv;   // one rounded percentage, the other is the rest
    // when one part is tiny, name the main reason and give the small part in votes
    if(dv !== 0 && Math.sign(s) !== -Math.sign(v) && Math.min(Math.abs(s), Math.abs(v)) < 0.1 * Math.abs(dv)){
      const mainShare = Math.abs(s) > Math.abs(v), what = dv > 0 ? "extra votes" : "loss";
      const main = mainShare ? (dv > 0 ? "a bigger DA share" : "a smaller DA share") : (dv > 0 ? "more people voting" : "fewer people voting");
      const minor = mainShare ? (dv > 0 ? "More people voting" : "Fewer people voting") : (dv > 0 ? "The bigger share" : "The smaller share");
      return `Almost all of the DA's ${what} in ${where} came from ${main}. ${minor} accounts for ${fmtV(Math.abs(mainShare ? v : s))} of the ${fmtV(Math.abs(dv))} votes.`;
    }
    if(dv > 0 && s >= 0 && v >= 0) return `About ${pv}% of the DA's extra votes in ${where} came from more people voting, and ${ps}% from the DA winning a bigger share.`;
    if(dv > 0 && s < 0) return `In ${where}, all of the DA's extra votes came from more people voting. Its share shrank; on its own, that would have meant ${fmtV(-s)} fewer DA votes.`;
    if(dv > 0 && v < 0) return `In ${where}, fewer people voted, but the DA's share grew enough to more than make up for it.`;
    if(dv < 0 && s <= 0 && v <= 0) return `About ${pv}% of the DA's loss in ${where} came from fewer people voting, and ${ps}% from a smaller DA share.`;
    if(dv < 0 && v > 0) return `In ${where}, more people voted, but the DA's share fell enough that it still lost votes.`;
    if(dv < 0 && s > 0) return `In ${where}, the DA's share grew, but the number of people voting fell enough that it still lost votes.`;
    return `In ${where}, the DA's vote total did not change.`;
  }
  // The same split, worked through with the place's own numbers.
  function splitHow(c, where){
    const p = decomp(c.d0, c.v0, c.d1, c.v1), dV = c.v1 - c.v0, sAvg = (c.s0 + c.s1) / 2, vAvg = (c.v0 + c.v1) / 2, rel = (a, b) => (b - a) / a * 100;
    const rv = rel(c.v0, c.v1), rd = c.d0 > 0 ? rel(c.d0, c.d1) : null, f = x => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}%`;
    const slice = rd == null ? "" : c.dvotes > 0 && c.dpp < 0 ? " DA votes grew more slowly than valid votes, so the DA got more votes but a smaller slice." : c.dvotes < 0 && c.dpp > 0 ? " DA votes fell more slowly than valid votes, so the DA got fewer votes but a bigger slice." : "";
    return `<details class="sp-how"><summary>How this is worked out</summary>
      <p>The DA's share is its slice of all valid votes. In ${E(where)}, valid votes went from ${fmtV(c.v0)} in ${D.B} to ${fmtV(c.v1)} in 2026 (${f(rv)}), and DA votes from ${fmtV(c.d0)} to ${fmtV(c.d1)}${rd == null ? "" : ` (${f(rd)})`}.${slice}</p>
      <p><b>People voting.</b> At its average share of ${sAvg.toFixed(1)}%, ${dV >= 0 ? `the ${fmtV(dV)} extra valid votes are` : `the drop of ${fmtV(-dV)} valid votes is`} worth ${sgn(p.volume)} DA votes.</p>
      <p><b>Share.</b> The DA's share went from ${L.fmtPct(c.s0)} to ${L.fmtPct(c.s1)}. A change of ${ptsShort(c.dpp)} on an average of ${fmtV(vAvg)} valid votes is worth ${sgn(p.share)} DA votes.</p>
      <p><b>Together</b> ${sgn(p.volume)} ${p.share >= 0 ? "+" : "−"} ${fmtV(Math.abs(p.share))} = ${sgn(c.dvotes)}, the actual change.</p></details>`;
  }
  function figSplit(){
    // rows: provinces for South Africa, otherwise the comparable places with the biggest change
    let rows, head;
    if(D.groups){ rows = D.groups.filter(g => g.ch).map(g => ({code: g.code, name: g.name, kind: "prov", p: decomp(g.ch.d0, g.ch.v0, g.ch.d1, g.ch.v1)})); head = "By province"; }
    else{ const ok = D.rows.filter(r => r.ch).sort((a, b) => Math.abs(b.ch.dvotes) - Math.abs(a.ch.dvotes) || a.code.localeCompare(b.code));
      rows = ok.slice(0, 8).map(r => ({code: r.code, name: short(r), kind: "place", p: decomp(r.ch.d0, r.ch.v0, r.ch.d1, r.ch.v1)}));
      head = ok.length > 8 ? `The ${rows.length} ${D.units} with the biggest change` : `Every comparable ${D.unit}`; }
    rows = rows.filter(r => r.p).sort((a, b) => b.p.dv - a.p.dv || a.code.localeCompare(b.code));
    const mixed = p => p.share * p.volume < 0;
    const d0 = D.t0.votes[L.DA] || 0, d1 = D.t1.votes[L.DA] || 0, tot = D.scopeOK ? decomp(d0, D.t0.valid, d1, D.t1.valid) : null;
    if(tot){ const sc = scaleFor([tot]);
      $("splitLead").textContent = splitSentence(tot, D.where);
      $("splitHero").innerHTML = `${splitBar(tot, sc.M, sc.z, true)}${splitKey(tot, mixed(tot) || rows.some(r => mixed(r.p)))}${splitHow(chOf(d0, D.t0.valid, d1, D.t1.valid), D.where)}`;
    }else{ $("splitLead").textContent = `${D.scopeName} can't be compared as a whole with ${D.B}, because its boundary changed. Its wards with unchanged voting districts are below.`;
      $("splitHero").innerHTML = rows.length ? `<ul class="sp-key"><li><i style="background:${C.up}"></i>DA share grew</li><li><i style="background:${C.dn}"></i>DA share shrank</li><li><i style="background:${C.slate}"></i>more or fewer people voting</li>${rows.some(r => mixed(r.p)) ? `<li><i class="sp-netkey"></i>net change, where the two pull apart</li>` : ""}</ul>` : ""; }
    const sc = scaleFor(rows.map(r => r.p));
    $("splitRows").innerHTML = rows.length ? `<p class="sp-head"><span>${head}</span><span>DA votes</span></p>` + rows.map((r, i) => `<button type="button" class="sp-row${r.code === st.sel ? " on" : ""}" data-i="${i}" aria-label="${E(r.name)}: ${sgn(r.p.dv)} DA votes, ${sgn(r.p.share)} from the share change, ${sgn(r.p.volume)} from the change in valid votes">
      <span class="sp-name">${E(r.name)}</span>${splitBar(r.p, sc.M, sc.z)}<span class="sp-v">${sgn(r.p.dv)}</span></button>`).join("") : "";
    $("splitNote").textContent = `This is arithmetic on the counts. It can't say who switched party or who stayed home. ${rows.length ? (D.groups ? "Province totals include every municipality; select a province to look inside it." : `The other ${D.units} are in the full table.`) : ""}`;
    $("splitRows").querySelectorAll(".sp-row").forEach(b => {
      const r = rows[+b.dataset.i];
      const show = ev => { const box = $("splitWrap").getBoundingClientRect(), bb = b.getBoundingClientRect();
        tipSplit.show(`<b>${E(r.name)}</b><br>${partWords(r.p).map(([v, t]) => `${sgn(v)} ${t}`).join("<br>")}<br><b>${sgn(r.p.dv)}</b> DA votes in all`, ev && ev.clientX ? ev.clientX - box.left : bb.left - box.left + bb.width / 2, bb.bottom - box.top - 12); };
      b.onmousemove = show; b.onfocus = () => show(); b.onmouseleave = b.onblur = () => tipSplit.hide();
      b.onclick = () => { tipSplit.hide(); if(r.kind === "prov"){ st.area = r.code; st.sel = ""; save(); render({zoom: true}); } else select(r.code); };
    });
  }

  // --- party totals ---
  function figParties(){
    const t0 = D.t0, t1 = D.t1, names = new Set([...Object.keys(t0.votes), ...Object.keys(t1.votes)]);
    const all = [...names].map(p => ({p, v0: t0.votes[p], v1: t1.votes[p], d: (t1.votes[p] || 0) - (t0.votes[p] || 0)}));
    const top = [...all].sort((a, b) => Math.abs(b.d) - Math.abs(a.d) || a.p.localeCompare(b.p)).slice(0, 10);
    if(!top.some(r => r.p === L.DA)) top.push(all.find(r => r.p === L.DA) || {p: L.DA, d: 0});
    const rest = all.filter(r => !top.includes(r)), other = {p: "Others", d: rest.reduce((a, r) => a + r.d, 0), other: true, n: rest.length};
    const rows = [...top.sort((a, b) => b.d - a.d || a.p.localeCompare(b.p)), other];
    const name = r => r.other ? `${r.n} others` : L.partyShort(r.p) + (r.v0 == null ? " *" : "");
    const svg = $("figParties"), w = W(svg), rh = 28, h = rows.length * rh + 8;
    const lab = Math.max(...rows.map(r => K.textW(name(r), 13, r.p === L.DA ? 700 : 400))) + 12;
    const vw = Math.max(...rows.map(r => K.textW(sgn(r.d), 13))) + 8;
    const negMax = Math.max(0, ...rows.map(r => -r.d)), posMax = Math.max(0, ...rows.map(r => r.d)), span = w - lab - 2 * vw;
    const k = span / ((negMax + posMax) || 1), mid = lab + vw * (negMax > 0 ? 1 : 0) + negMax * k;
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.innerHTML = `<line x1="${mid}" x2="${mid}" y1="0" y2="${h}" stroke="${C.ink}"/>` + rows.map((r, i) => {
      const y = i * rh, bw = Math.abs(r.d) * k, x0 = r.d >= 0 ? mid : mid - bw;
      const tip = r.other ? "" : `<title>${E(L.titleCase(r.p))}: ${r.v0 != null ? fmtV(r.v0) : "not on the ballot"} in ${D.B}, ${r.v1 != null ? fmtV(r.v1) : "not on the ballot"} in 2026</title>`;
      return `<g>${tip}<text x="${lab - 12}" y="${y + 18}" text-anchor="end" class="ch-val"${r.p === L.DA ? ' font-weight="700"' : ""}>${E(name(r))}</text>
        <rect x="${x0}" y="${y + 6}" width="${Math.max(bw, 1)}" height="${rh - 12}" rx="2" fill="${r.other ? "#a7b0b9" : L.partyColour(r.p)}"/>
        <text x="${r.d >= 0 ? mid + bw + 6 : mid - bw - 6}" y="${y + 18}" text-anchor="${r.d >= 0 ? "start" : "end"}" class="ch-val">${sgn(r.d)}</text></g>`;
    }).join("");
    const named = rows.filter(r => !r.other), up = named[0], dn = named[named.length - 1];
    const THE = {ANC: "the ANC", DA: "the DA", EFF: "the EFF", IFP: "the IFP", PA: "the PA", MK: "the MK party", "FF+": "the FF Plus", UDM: "the UDM", ACDP: "the ACDP", SACP: "the SACP", ATM: "the ATM", AMM: "the AMM", COPE: "COPE"};
    const the = p => THE[L.partyShort(p)] || L.partyShort(p), cap = s => s[0].toUpperCase() + s.slice(1);
    $("partiesIntro").textContent = up && dn && up.d > 0 && dn.d < 0 ? `${cap(the(up.p))}${up.v0 == null ? `, which was not on the ${D.B} ballot,` : ""} gained the most votes; ${the(dn.p)} lost the most.`
      : dn && dn.d < 0 ? `Every party shown lost votes; ${the(dn.p)} lost the most.` : up && up.d > 0 ? `Every party shown gained votes; ${the(up.p)} gained the most.` : `Change in votes by party, ${D.B} to 2026.`;
    const sum = all.reduce((a, r) => a + r.d, 0), dvalid = t1.valid - t0.valid;
    $("partiesNote").textContent = `${named.some(r => r.v0 == null) ? `* Not on the ${D.B} ballot, so all its 2026 votes count as a gain. ` : ""}All parties together: ${sgn(sum)}, the change in valid votes${sum === dvalid ? "" : " (these totals do not add up; please report this)"}. Party totals don't show voters moving from one party to another.`;
  }

  // --- waterfall of DA vote change by place ---
  let wfGroups = {};
  function figWaterfall(ok){
    const pos = ok.filter(r => r.ch.dvotes > 0).sort((a, b) => b.ch.dvotes - a.ch.dvotes || a.code.localeCompare(b.code));
    const neg = ok.filter(r => r.ch.dvotes < 0).sort((a, b) => a.ch.dvotes - b.ch.dvotes || a.code.localeCompare(b.code));
    const n = W($("figWaterfall")) < 520 ? 4 : 5;
    const comp = [...pos.slice(0, n).map(r => ({label: short(r), v: r.ch.dvotes, rows: [r]})),
      ...(pos.length > n ? [{label: `${pos.length - n} other gains`, v: pos.slice(n).reduce((a, r) => a + r.ch.dvotes, 0), rows: pos.slice(n)}] : []),
      ...neg.slice(0, n).map(r => ({label: short(r), v: r.ch.dvotes, rows: [r]})),
      ...(neg.length > n ? [{label: `${neg.length - n} other losses`, v: neg.slice(n).reduce((a, r) => a + r.ch.dvotes, 0), rows: neg.slice(n)}] : [])];
    const net = ok.reduce((a, r) => a + r.ch.dvotes, 0);
    let run = 0; const steps = comp.map(c => { const s = {...c, from: run, to: run + c.v}; run += c.v; return s; });
    const svg = $("figWaterfall"), w = W(svg), rh = 28, h = (steps.length + 1) * rh + 6;
    const fit = (s, max) => { if(K.textW(s, 13) <= max) return s; while(s.length > 3 && K.textW(s + "…", 13) > max) s = s.slice(0, -1); return s + "…"; };
    const lab = Math.min(170, Math.max(...steps.map(s => K.textW(s.label, 13)), K.textW("Net change", 13, 700)) + 10, w * 0.4);
    const vw = Math.max(...steps.map(s => K.textW(sgn(s.v), 13)), K.textW(sgn(net), 13, 700)) + 10;
    const lo = Math.min(0, ...steps.map(s => Math.min(s.from, s.to))), hi = Math.max(0, ...steps.map(s => Math.max(s.from, s.to)));
    const x = v => lab + 6 + (v - lo) / ((hi - lo) || 1) * (w - lab - 6 - vw);
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    wfGroups = {};
    svg.innerHTML = `<line x1="${x(0)}" x2="${x(0)}" y1="0" y2="${h}" stroke="${C.ink}"/>` + steps.map((s, i) => {
      const y = i * rh; wfGroups[i] = s.rows;
      return `<g class="wf" data-i="${i}" tabindex="0" role="button" aria-label="${E(s.label)} ${sgn(s.v)} votes"><rect x="0" y="${y}" width="${w}" height="${rh}" fill="transparent"/><text x="${lab - 4}" y="${y + 18}" text-anchor="end" class="ch-val">${E(fit(s.label, lab - 8))}</text>
        <rect x="${x(Math.min(s.from, s.to))}" y="${y + 6}" width="${Math.max(1.5, Math.abs(x(s.to) - x(s.from)))}" height="${rh - 12}" rx="2" fill="${K.sideCol(s.v)}"/>
        ${i ? `<line x1="${x(s.from)}" x2="${x(s.from)}" y1="${y - rh + 22}" y2="${y + 6}" stroke="${C.axis}" stroke-width="1"/>` : ""}
        <text x="${x(Math.max(s.from, s.to)) + 6}" y="${y + 18}" class="ch-val">${sgn(s.v)}</text></g>`;
    }).join("") + (() => { const y = steps.length * rh;
      return `<text x="${lab - 4}" y="${y + 18}" text-anchor="end" font-weight="700" class="ch-val">Net change</text><rect x="${x(Math.min(0, net))}" y="${y + 6}" width="${Math.max(1.5, Math.abs(x(net) - x(0)))}" height="${rh - 12}" rx="2" fill="none" stroke="${C.ink}" stroke-width="2"/>
        <text x="${x(Math.max(0, net)) + 6}" y="${y + 18}" font-weight="700" class="ch-val">${sgn(net)}</text>`; })();
    svg.querySelectorAll(".wf").forEach(g => { const go = () => { const rs = wfGroups[g.dataset.i]; if(rs.length === 1) select(rs[0].code); else showGroup(rs); };
      g.onclick = go; g.onkeydown = e => { if(e.key === "Enter" || e.key === " "){ e.preventDefault(); go(); } }; });
    $("wfNote").textContent = `Each bar starts where the one above ended; together they add up to the net change for the ${ok.length} comparable ${D.units}.${ok.length < D.rows.length ? " Places whose boundaries changed are left out, so this differs from the total at the top of the page." : ""} Select a bar to see that place, or a group to list its places.`;
  }
  let groupRows = null;
  function showGroup(rows){ groupRows = rows; $("full").open = true; table(); $("full").scrollIntoView({behavior: L.prefersReduced() ? "auto" : "smooth"}); }

  // --- scatter: change in DA votes (across) against change in DA share (up) ---
  let sPts = [], sFocus = -1;
  const tipS = K.tip($("scatterWrap"));
  const QUAD = {"++": ["More votes,", "bigger share"], "-+": ["Fewer votes,", "bigger share"], "+-": ["More votes,", "smaller share"], "--": ["Fewer votes,", "smaller share"]};
  const PHR = {"++": "won more votes and a bigger share", "+-": "won more votes but a smaller share", "-+": "won fewer votes but a bigger share", "--": "won fewer votes and a smaller share"};
  function exampleOf(ok, q){
    const MIN = D.unit === "ward" ? 300 : 1000;
    return ok.filter(r => pattern(r) === q && r.ch.v0 >= MIN && r.ch.v1 >= MIN).sort((a, b) => Math.abs(b.ch.dpp) - Math.abs(a.ch.dpp) || a.code.localeCompare(b.code))[0] || null;
  }
  function figScatter(ok){
    const svg = $("figScatter"), w = W(svg), narrow = w < 560;
    const h = narrow ? Math.round(Math.min(520, w * 1.12)) : Math.round(Math.min(600, w * 0.58));
    const m = {l: narrow ? 40 : 52, r: 8, t: 30, b: narrow ? 52 : 56}, pw = w - m.l - m.r, ph = h - m.t - m.b;
    const ax = ok.map(r => Math.abs(r.ch.dvotes)).sort((a, b) => a - b), c = K.niceUp(Math.max(1, ax[Math.floor(ax.length * 0.2)] || 1));
    // each side of zero is as wide as its data needs, but never less than half the other side, so all four quarters stay readable
    const S = K.stretch(c), lim = (a, b) => { const big = Math.max(a, b); return [Math.max(a, big / 2), Math.max(b, big / 2)]; };
    const [TL, TR] = lim(S.f(-Math.min(0, ...ok.map(r => r.ch.dvotes))) * 1.06, Math.max(S.f(Math.max(0, ...ok.map(r => r.ch.dvotes))) * 1.06, S.f(c)));
    let [Ylo, Yhi] = lim(-Math.min(0, ...ok.map(r => r.ch.dpp)) * 1.08, Math.max(1, ...ok.map(r => r.ch.dpp)) * 1.08); Ylo = K.niceUp(Ylo); Yhi = K.niceUp(Yhi);
    const X = v => m.l + (S.f(v) + TL) / (TL + TR) * pw, Y = v => m.t + (Yhi - v) / (Yhi + Ylo) * ph, x0 = X(0), y0 = Y(0);
    const vmax = Math.max(...ok.map(r => r.ch.v1), 1), Rmax = narrow ? 15 : 24, R = v => Math.max(2.6, Rmax * Math.sqrt(v / vmax));
    const n = q => ok.filter(r => pattern(r) === q).length;
    // grid and axes
    const xt = K.thinTicks(K.decades(-c * Math.sinh(TL), c * Math.sinh(TR), c), X, t => t === 0 ? "0" : sgn(t), 12, 14);
    const step = K.niceStep(Yhi + Ylo, narrow ? 4 : 6), yt = []; for(let t = -Math.floor(Ylo / step) * step; t <= Yhi + 1e-9; t += step) yt.push(+t.toFixed(6));
    let g = `<rect x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="#fbf8f1"/>`;
    g += xt.filter(t => t).map(t => `<line x1="${X(t)}" x2="${X(t)}" y1="${m.t}" y2="${m.t + ph}" stroke="${C.grid}"/>`).join("") + yt.filter(t => t).map(t => `<line x1="${m.l}" x2="${m.l + pw}" y1="${Y(t)}" y2="${Y(t)}" stroke="${C.grid}"/>`).join("");
    g += xt.map(t => `<text x="${X(t)}" y="${m.t + ph + 17}" text-anchor="middle" class="ch-ax"${t === 0 ? ` font-weight="700" fill="${C.ink}"` : ""}>${t === 0 ? "0" : sgn(t)}</text>`).join("");
    g += yt.map(t => `<text x="${m.l - 6}" y="${Y(t) + 4}" text-anchor="end" class="ch-ax"${t === 0 ? ` font-weight="700" fill="${C.ink}"` : ""}>${t === 0 ? "0" : (t > 0 ? "+" : "−") + Math.abs(t)}</text>`).join("");
    g += `<text x="${m.l + pw / 2}" y="${h - 8}" text-anchor="middle" class="ch-ax">Change in DA votes</text><text x="${m.l - (narrow ? 34 : 44)}" y="${m.t - 12}" class="ch-ax">Change in DA share, percentage points</text>`;
    g += `<line x1="${x0}" x2="${x0}" y1="${m.t}" y2="${m.t + ph}" stroke="${C.ink}" stroke-width="1.5"/><line x1="${m.l}" x2="${m.l + pw}" y1="${y0}" y2="${y0}" stroke="${C.ink}" stroke-width="1.5"/>`;
    // points
    sPts = ok.map(r => ({r, x: X(r.ch.dvotes), y: Y(r.ch.dpp), rad: R(r.ch.v1)}));
    g += [...sPts].sort((a, b) => b.rad - a.rad).map(s => `<circle cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="${s.rad.toFixed(1)}" fill="${K.sideCol(s.r.ch.dpp || 0.0001)}" fill-opacity=".62" stroke="${C.paper}" stroke-width="1"/>`).join("");
    const sel = sPts.find(s => s.r.code === st.sel);
    if(sel) g += `<circle cx="${sel.x}" cy="${sel.y}" r="${sel.rad + 2}" fill="none" stroke="${C.ink}" stroke-width="2.5"/>`;
    // quarter labels: in the corner of each quarter that covers the fewest circles
    const qBoxes = [], lh = 15;
    for(const q of ["-+", "++", "--", "+-"]){
      const right = q[0] === "+", top = q[1] === "+", lines = [...QUAD[q], `${n(q)} ${n(q) === 1 ? D.unit : D.units}`];
      const bw = Math.max(K.textW(lines[0], 12, 600), K.textW(lines[1], 12, 600), K.textW(lines[2], 12)) , bh = lh * 3;
      const qx0 = right ? x0 : m.l, qx1 = right ? m.l + pw : x0, qy0 = top ? m.t : y0, qy1 = top ? y0 : m.t + ph, pad = 7, inner = 12;
      // outer corner first; the spots next to the zero lines keep a wider gap from them
      const spots = [[right ? qx1 - bw - pad : qx0 + pad, top ? qy0 + pad : qy1 - bh - pad], [right ? qx0 + inner : qx1 - bw - inner, top ? qy0 + pad : qy1 - bh - pad],
        [right ? qx1 - bw - pad : qx0 + pad, top ? qy1 - bh - inner : qy0 + inner]];
      const clash = ([bx, by]) => qBoxes.some(q => bx - 6 < q.x + q.w && q.x < bx + bw + 6 && by - 4 < q.y + q.h && q.y < by + bh + 4);
      const cost = ([bx, by]) => (clash([bx, by]) || bx < m.l || bx + bw > m.l + pw ? 1e9 : 0) + sPts.reduce((a, s) => a + (s.x + s.rad > bx - 2 && s.x - s.rad < bx + bw + 2 && s.y + s.rad > by - 2 && s.y - s.rad < by + bh + 2 ? s.rad * s.rad : 0), 0);
      const [bx, by] = spots.map(sp => [sp, cost(sp)]).sort((a, b) => a[1] - b[1])[0][0];
      const anchor = right ? "end" : "start", tx = right ? bx + bw : bx;
      qBoxes.push({x: bx - 8, y: by - 4, w: bw + 16, h: bh + 8});
      g += `<g class="ch-quad" data-q="${q}" role="button" tabindex="0" aria-label="${QUAD[q].join(" ")}: ${n(q)} ${D.units}. Show them in the table"><rect x="${bx - 4}" y="${by - 3}" width="${bw + 8}" height="${bh + 6}" fill="transparent"/>
        <text x="${tx}" y="${by + 12}" text-anchor="${anchor}" class="ch-lbl" font-weight="600">${lines[0]}</text><text x="${tx}" y="${by + 12 + lh}" text-anchor="${anchor}" class="ch-lbl" font-weight="600">${lines[1]}</text>
        <text x="${tx}" y="${by + 12 + 2 * lh}" text-anchor="${anchor}" class="ch-lbl ch-muted">${lines[2]}</text></g>`;
    }
    // callouts: the selected place, one example per quarter, then the biggest places
    const want = [], seen = new Set(), add = r => { if(r && !seen.has(r.code)){ seen.add(r.code); want.push(r); } };
    add(sel && sel.r); [...ok].sort((a, b) => b.ch.v1 - a.ch.v1).slice(0, narrow ? 3 : 4).forEach(add); ["++", "+-", "-+", "--"].forEach(q => add(exampleOf(ok, q)));
    const items = want.slice(0, narrow ? 5 : 8).map(r => { const s = sPts.find(p => p.r === r); return {x: s.x, y: s.y, r: s.rad, text: short(r), size: 12, weight: r.code === st.sel ? 700 : 600}; });
    const blocks = [...qBoxes, ...sPts.filter(s => s.rad > 7).map(s => ({x: s.x - s.rad, y: s.y - s.rad, w: 2 * s.rad, h: 2 * s.rad}))];
    g += K.placeLabels(items, {x0: m.l + 2, x1: m.l + pw - 2, y0: m.t + 2, y1: m.t + ph - 2}, blocks).map(K.labelSVG).join("");
    g += `<circle id="sFocus" r="0" fill="none" stroke="${C.ink}" stroke-width="2" stroke-dasharray="3 2" visibility="hidden"/>`;
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.innerHTML = g;
    svg.setAttribute("aria-label", `Chart of ${ok.length} ${D.units}: change in DA votes against change in DA share. ${["++", "+-", "-+", "--"].map(q => `${QUAD[q].join(" ")} ${n(q)}`).join(", ")}. Use the arrow keys to step through places and Enter to select one.`);
    svg.querySelectorAll(".ch-quad").forEach(el => { const go = () => { groupRows = null; $("pattern").value = el.dataset.q; $("full").open = true; table(); $("full").scrollIntoView({behavior: L.prefersReduced() ? "auto" : "smooth"}); };
      el.onclick = go; el.onkeydown = e => { if(e.key === "Enter" || e.key === " "){ e.preventDefault(); e.stopPropagation(); go(); } }; });
    // one or two sentences that update with the area and the baseline
    const order = ["++", "+-", "-+", "--"].sort((a, b) => n(b) - n(a));
    const first = order[0], mixed = ["+-", "-+", "++", "--"].find(q => q !== first && n(q) > 0);
    let s = `In ${n(first)} of ${ok.length} comparable ${D.units}, the DA ${PHR[first]}.`;
    if(mixed){ const big = ok.filter(r => pattern(r) === mixed).sort((a, b) => b.ch.v1 - a.ch.v1)[0], why = mixed === "+-" ? ", because valid votes grew faster than DA votes" : mixed === "-+" ? ", because valid votes fell faster than DA votes" : "";
      s += n(mixed) > 1 ? ` In ${n(mixed)}, including ${short(big)}, it ${PHR[mixed]}${why}.` : ` In ${short(big)} alone, it ${PHR[mixed]}${why}.`; }
    $("scatterLead").textContent = s;
    const dec = xt.filter(t => t > 0).map(t => fmtV(t));
    $("scatterNote").textContent = `Each circle is a ${D.unit}, sized by its valid votes in 2026. Blue means the DA's share rose, orange that it fell. The horizontal scale is squeezed so that small and large places both fit${dec.length > 1 ? `: the steps from ${dec.slice(0, -1).join(" to ")} to ${dec[dec.length - 1]} are about the same width` : ""}.`;
  }
  // nearest-point inspection on the scatter, and keyboard stepping (left/right in order of vote change)
  const sSvg = $("figScatter");
  function tipFor(r){ return `<b>${E(nice(r.name))}</b>${D.unit === "ward" ? "" : `<br><span class="tip-mute">${E(r.parent)}</span>`}<br>DA votes ${fmtV(r.ch.d0)} → ${fmtV(r.ch.d1)} (<b>${sgn(r.ch.dvotes)}</b>)<br>DA share ${L.fmtPct(r.ch.s0)} → ${L.fmtPct(r.ch.s1)} (<b>${ptsShort(r.ch.dpp)}</b>)`; }
  function nearest(ev){
    const b = sSvg.getBoundingClientRect(), k = sSvg.viewBox.baseVal.width / b.width, mx = (ev.clientX - b.left) * k, my = (ev.clientY - b.top) * k;
    let best = null, bd = (24 * k) ** 2; for(const s of sPts){ const d = Math.max(0, Math.hypot(s.x - mx, s.y - my) - s.rad) ** 2; if(d < bd || (d === 0 && best && s.rad < best.rad)){ bd = d; best = s; } }
    return best && {s: best, px: ev.clientX - b.left, py: ev.clientY - b.top};
  }
  function focusPoint(s){
    const f = $("sFocus"); if(!f) return;
    if(!s){ f.setAttribute("visibility", "hidden"); tipS.hide(); return; }
    f.setAttribute("cx", s.x); f.setAttribute("cy", s.y); f.setAttribute("r", s.rad + 4); f.setAttribute("visibility", "visible");
    const k = sSvg.getBoundingClientRect().width / sSvg.viewBox.baseVal.width;
    tipS.show(tipFor(s.r), s.x * k, s.y * k); L.announce(`${nice(s.r.name)}: ${sgn(s.r.ch.dvotes)} DA votes, ${ptsShort(s.r.ch.dpp)}`);
  }
  sSvg.addEventListener("mousemove", ev => { if(ev.target.closest(".ch-quad")){ tipS.hide(); return; } const n = nearest(ev); if(!n){ tipS.hide(); return; } tipS.show(tipFor(n.s.r), n.px, n.py); });
  sSvg.addEventListener("mouseleave", () => tipS.hide());
  sSvg.addEventListener("click", ev => { if(ev.target.closest(".ch-quad")) return; const n = nearest(ev); if(n) select(n.s.r.code); });
  sSvg.addEventListener("keydown", ev => {
    if(!sPts.length || ev.target !== sSvg) return;
    const order = [...sPts].sort((a, b) => a.r.ch.dvotes - b.r.ch.dvotes || a.r.code.localeCompare(b.r.code));
    if(ev.key === "ArrowRight" || ev.key === "ArrowLeft"){ ev.preventDefault(); sFocus = sFocus < 0 ? (ev.key === "ArrowRight" ? 0 : order.length - 1) : Math.min(order.length - 1, Math.max(0, sFocus + (ev.key === "ArrowRight" ? 1 : -1))); focusPoint(order[sFocus]); }
    else if(ev.key === "Enter" && sFocus >= 0){ ev.preventDefault(); select(order[sFocus].r.code); }
    else if(ev.key === "Escape"){ sFocus = -1; focusPoint(null); }
  });
  sSvg.addEventListener("blur", () => { sFocus = -1; focusPoint(null); });

  // one example per quarter, laid out like the quarters of the chart
  function cases(ok){
    const pc = (a, b) => { const x = 100 * (b - a) / a; return `${x >= 0 ? "rose" : "fell"} ${Math.abs(x).toFixed(1)}%`; };
    const why = c => c.ch.d0 > 0 ? `Valid votes ${pc(c.ch.v0, c.ch.v1)}; DA votes ${pc(c.ch.d0, c.ch.d1)}.` : "";
    $("cases").innerHTML = ["-+", "++", "--", "+-"].map(q => {
      const c = exampleOf(ok, q), t = QUAD[q].join(" ");
      if(!c) return `<div class="vt-case" data-q="${q}"><h3>${t}</h3><p class="note">No ${D.unit} in this area.</p></div>`;
      return `<div class="vt-case" data-q="${q}"><h3>${t}</h3><p><button type="button" class="linkbtn" data-sel="${c.code}">${E(nice(c.name))}</button>${D.unit === "ward" ? "" : `, ${E(c.parent)}`}</p>
        <p class="vt-nums">DA votes <b>${sgn(c.ch.dvotes)}</b> · share <b>${ptsShort(c.ch.dpp)}</b></p><p class="vt-why">${why(c)}</p></div>`;
    }).join("");
    $("casesNote").textContent = `For each quarter, the ${D.unit} with the biggest change in DA share among places with at least ${fmtV(D.unit === "ward" ? 300 : 1000)} valid votes in both elections.`;
    wireLinks($("cases"));
  }
  function wireLinks(el){ el.querySelectorAll("[data-sel]").forEach(b => b.onclick = () => select(b.dataset.sel, true)); }

  // the selected place
  function selection(){
    const r = st.sel && D.rows.find(x => x.code === st.sel);
    $("selSec").hidden = !r;
    if(!r) return;
    $("h-sel").textContent = nice(r.name) + (D.unit === "ward" ? `, ${D.scopeName}` : "");
    const back = `<button type="button" class="linkbtn" id="clearSel">Back to ${E(D.scopeName)}</button>`;
    if(!r.ch){ $("sel").innerHTML = `<p class="vt-p">No comparison with ${D.B}, because ${E(r.why.replace(/^Boundary changed:\s*/i, "").replace(/^./, c => c.toLowerCase()))}.</p><p>${back}</p>`; $("clearSel").onclick = () => select(""); return; }
    const c = r.ch, p = decomp(c.d0, c.v0, c.d1, c.v1), sc = scaleFor([p]);
    $("sel").innerHTML = `<p class="vt-p">${E(splitSentence(p, short(r)))}</p>
      <p class="vt-nums">DA votes <b>${fmtV(c.d0)} → ${fmtV(c.d1)}</b> (${sgn(c.dvotes)}) · DA share <b>${L.fmtPct(c.s0)} → ${L.fmtPct(c.s1)}</b> (${ptsShort(c.dpp)}) · valid votes ${fmtV(c.v0)} → ${fmtV(c.v1)}</p>
      <div class="sp-hero">${splitBar(p, sc.M, sc.z, true)}${splitKey(p, p.share * p.volume < 0)}${splitHow(c, short(r))}</div>
      <p class="vt-links">${back} · <a href="explore.html?${D.unit === "ward" ? `area=${st.area}&ward=${r.code}` : `area=${r.code}`}">Full result</a> · <a href="shift.html?baseline=${D.B}&${D.unit === "ward" ? `area=${st.area}&level=ward&ward=${r.code}` : `area=${r.code}`}">On the shift map</a>${D.unit === "municipality" ? ` · <button type="button" class="linkbtn" id="selWards">Its wards</button>` : ""}</p>`;
    $("clearSel").onclick = () => select("");
    if($("selWards")) $("selWards").onclick = () => { st.area = r.code; st.sel = ""; save(); render({zoom: true}); };
  }

  // table
  let sortKey = "abs", sortDir = -1;
  const COLS = [["name", "Place"], ["parent", "Province"], ["d0", "DA votes, then"], ["d1", "DA votes, 2026"], ["dv", "Vote change"], ["s0", "DA share, then"], ["s1", "DA share, 2026"], ["dpp", "Change (pts)"], ["v0", "Valid, then"], ["v1", "Valid, 2026"], ["why", "Comparison"]];
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
    $("fullSum").textContent = `Show the full table (${D.rows.length} ${D.units})`;
    $("table").innerHTML = `<caption class="sr-only">Every place in ${E(D.scopeName)}</caption><thead><tr>${COLS.map(([k, t]) => `<th scope="col" aria-sort="${k === sortKey ? (sortDir > 0 ? "ascending" : "descending") : "none"}"><button type="button" data-k="${k}">${t.replace("then", D.B).replace("Province", D.unit === "ward" ? "Municipality" : "Province")}</button></th>`).join("")}</tr></thead>
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
      return `<b>${E(nice(r.name))}</b><br>${r.ch ? `DA votes ${fmtV(r.ch.d0)} → ${fmtV(r.ch.d1)} (<b>${sgn(r.ch.dvotes)}</b>)<br>DA share ${L.fmtPct(r.ch.s0)} → ${L.fmtPct(r.ch.s1)} (${ptsShort(r.ch.dpp)})` : `<span class="tip-mute">${E(r.why)}</span>`}`; },
    onClick: (kind, p) => { const code = kind === "ward" ? String(p.WardId) : p.MunicCode; if(D.rows.find(x => x.code === code)) select(code); },
    draw: project => circles.map(c => { const [x, y] = project(c.pt), r = 32 * Math.sqrt(Math.abs(c.v) / cMax);
      return c.v === 0 ? `<line x1="${x - 3}" x2="${x + 3}" y1="${y}" y2="${y}" stroke="#8f9aa5" stroke-width="1.5"/>`
        : `<circle cx="${x}" cy="${y}" r="${r}" fill="${K.sideCol(c.v)}" fill-opacity=".35" stroke="${c.sel ? C.ink : K.sideCol(c.v)}" stroke-width="${c.sel ? 2.5 : 1}"/>`; }).join("")});

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
    $("legend").innerHTML = `<div class="lg-row">${ex.map(v => { const r = 32 * Math.sqrt(v / cMax); return `<span class="lg-arrow"><svg width="${2 * r + 4}" height="${2 * r + 4}" aria-hidden="true"><circle cx="${r + 2}" cy="${r + 2}" r="${r}" fill="none" stroke="${C.mute}"/></svg>${fmtV(v)} votes</span>`; }).join("")}
      <span class="lg-item"><i class="sw" style="background:${C.up};opacity:.6"></i>DA votes added</span><span class="lg-item"><i class="sw" style="background:${C.dn};opacity:.6"></i>DA votes lost</span><span class="lg-item"><i class="sw" style="background:#e2e6ea"></i>Boundaries changed, not compared</span></div>`;
    const up = ok.filter(r => r.ch.dvotes > 0).length, dn = ok.filter(r => r.ch.dvotes < 0).length, out = all.length - ok.length;
    const U = k => `${k} ${k === 1 ? D.unit : D.units}`;
    $("placesIntro").textContent = `${U(up)} gave the DA more votes than in ${D.B} and ${dn} gave it fewer${ok.length - up - dn ? `; ${ok.length - up - dn} the same` : ""}.${out ? ` Another ${out} ${out === 1 ? "is" : "are"} left out because ${out === 1 ? "its boundaries" : "their boundaries"} changed.` : ""}`;
  }

  // ---------- render ----------
  async function render(opts = {}){
    $("baseline").value = st.baseline; $("scope").value = st.area && !byCode[st.area] ? st.area : "";
    document.querySelector("main").setAttribute("aria-busy", "true");
    if(!await load()) return;
    document.querySelector("main").setAttribute("aria-busy", "false");
    const fin = snaps[2026].manifest.status === "final" && snaps[D.B].manifest.status === "final";
    $("basis").textContent = `${D.scopeName} · 2026 vs ${D.B} · Municipal PR ballot · ${fin ? "Final results, as declared by the IEC" : `Provisional · IEC data as of ${L.fmtSAST(snaps[2026].generated)}`}`;
    const ok = D.rows.filter(r => r.ch);
    if(D.scopeOK){
      const d0 = D.t0.votes[L.DA] || 0, d1 = D.t1.votes[L.DA] || 0, s0 = 100 * d0 / D.t0.valid, s1 = 100 * d1 / D.t1.valid;
      $("lead").textContent = leadSentence(d0, D.t0.valid, d1, D.t1.valid, D.where);
      $("pairWrap").hidden = false;
      figPair("figVotes", d0, d1, fmtV, sgn(d1 - d0), "DA votes"); figPair("figShare", s0, s1, v => v.toFixed(1) + "%", pts1(s1 - s0), "DA share of valid votes");
      const rel = (a, b) => 100 * (b - a) / a, rv = rel(D.t0.valid, D.t1.valid), rd = d0 > 0 ? rel(d0, d1) : null;
      $("leadNote").textContent = rd == null ? "" : `All valid votes ${rv >= 0 ? "grew" : "fell"} by ${Math.abs(rv).toFixed(1)}% and DA votes ${rd >= 0 ? "grew" : "fell"} by ${Math.abs(rd).toFixed(1)}%, so the DA's share went ${s1 >= s0 ? "up" : "down"}.`;
      $("partiesSec").hidden = false; figParties();
    }else{
      $("lead").textContent = `${D.scopeName} can't be compared as a whole with ${D.B}, because ${D.scopeNote.replace(/^Boundary changed:\s*/i, "").replace(/^./, c => c.toLowerCase())}. Wards with unchanged voting districts are still compared below.`;
      $("pairWrap").hidden = true; $("leadNote").textContent = ""; $("partiesSec").hidden = true;
    }
    figSplit();
    if(ok.length){ $("scatterSec").hidden = false; mapView(ok); figWaterfall(ok); figScatter(ok); cases(ok); }
    else { $("placesIntro").textContent = `No comparable ${D.units} here.`; $("figWaterfall").innerHTML = ""; $("wfNote").textContent = ""; $("scatterSec").hidden = true; circles = []; atlas.redraw(); }
    groupRows = null; selection(); table();
    if(opts.zoom) D.isMun ? atlas.zoomTo(st.area) : D.prov ? atlas.zoomToProvince(D.prov) : atlas.zoomToSA();
    $("methodSource").textContent = `Data: 2026 snapshot ${snaps[2026].manifest.snapshot}, ${D.B} snapshot ${snaps[D.B].manifest.snapshot}. Comparability from data/archive/compare.json (scripts/compare.py).`;
  }
  function select(code, scroll){
    st.sel = code; save(); selection(); table();
    const ok = D.rows.filter(r => r.ch); if(ok.length){ mapView(ok); figScatter(ok); } figSplit();
    if(code && (scroll !== false)) $("selSec").scrollIntoView({behavior: L.prefersReduced() ? "auto" : "smooth", block: "start"});
    L.announce(code ? `Selected ${nice((D.rows.find(r => r.code === code) || {}).name || code)}` : `Showing ${D.scopeName}`);
  }

  $("baseline").onchange = e => { st.baseline = e.target.value; save(); render(); };
  $("scope").onchange = e => { st.area = e.target.value; st.sel = ""; save(); render({zoom: true}); };
  window.addEventListener("popstate", () => { st = readURL(); render({zoom: true}); });
  let rt, lastW = innerWidth; window.addEventListener("resize", () => { if(innerWidth === lastW) return; lastW = innerWidth; clearTimeout(rt); rt = setTimeout(() => D && render(), 250); });
  const items = lists[2026].map(m => ({label: m.name, sub: `${m.province} · ${m.code}`, code: m.code, keys: (AKA[m.code] || "").toLowerCase()}));
  L.combobox($("q"), $("qlist"), q => L.searchItems(items, q), it => { st.area = it.code; st.sel = ""; save(); render({zoom: true}); }, "No matching municipality");
  save(false);
  render({zoom: !!st.area});
})();
