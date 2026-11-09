// The shift: where DA support rose and fell, 2026 vs an earlier local election.
// Data: data/archive/<year>/ (official IEC counts), data/archive/compare.json (which places are
// comparable), geo/ (IEC 2026 boundaries). All values are computed here from counts; nothing is estimated.
(async function(){
  const L = window.LGE, $ = id => document.getElementById(id), E = L.esc;
  const BLUE = "#0077c8", ORANGE = "#b65c20", ZERO = "#8f9aa5", NODATA = "#e2e6ea", LAND = "#f1f3f5";
  const AKA = {JHB: "Johannesburg", TSH: "Pretoria", ETH: "Durban", NMA: "Gqeberha", BUF: "East London", MAN: "Bloemfontein", EKU: "Ekurhuleni", CPT: "Cape Town"};

  // ---------- state <-> URL ----------
  function readURL(){
    const q = new URLSearchParams(location.search);
    return {baseline: q.get("baseline") === "2016" ? "2016" : "2021", ballot: q.get("ballot") === "ward" ? "ward" : "pr",
      province: L.provByCode(q.get("province")) || "", level: q.get("level") === "ward" ? "ward" : "municipality",
      area: q.get("area") || "", ward: q.get("ward") || "", measure: q.get("measure") === "votes" ? "votes" : "share",
      view: q.get("view") === "shading" ? "shading" : "arrows"};
  }
  function urlFor(s){
    const q = new URLSearchParams({baseline: s.baseline, ballot: s.ballot === "pr" ? "municipal-pr" : "ward"});
    if(s.province) q.set("province", L.PROV[s.province]);
    q.set("level", s.level); if(s.area) q.set("area", s.area); if(s.ward) q.set("ward", s.ward);
    q.set("measure", s.measure); q.set("view", s.view);
    return "?" + q;
  }
  let st = readURL();
  const save = (push = true) => history[push ? "pushState" : "replaceState"](null, "", urlFor(st));

  // ---------- data ----------
  let now, base = {}, m26, cmp, mBase = {};
  try{
    now = await L.snapshot(2026);
    [m26, cmp] = await Promise.all([now.municipalities(), L.compareInfo()]);
  }catch(e){ $("detail").innerHTML = `<p class="pg-error">Results could not be loaded. <a href="">Try again</a>.</p>`; return; }
  const byCode = Object.fromEntries(m26.map(m => [m.code, m]));
  async function loadBase(year){
    if(!base[year]){ base[year] = await L.snapshot(+year); mBase[year] = Object.fromEntries((await base[year].municipalities()).map(m => [m.code, m])); }
    return mBase[year];
  }
  Object.keys(L.PROV).forEach(p => $("province").insertAdjacentHTML("beforeend", `<option>${p}</option>`));

  // ---------- rows ----------
  const val = (r, s = st) => r.ch ? (s.measure === "share" ? r.ch.dpp : r.ch.dvotes) : null;
  function municRows(){
    const mb = mBase[st.baseline], c = cmp.baselines[st.baseline].munics;
    return m26.map(m => {
      const b = mb[m.code], ok = c[m.code] && c[m.code].ok;
      const ch = ok ? L.changeRow(m, b, st.ballot) : null;
      return {code: m.code, name: m.name, prov: m.province, ok: ok && !!ch,
        reason: !ok ? (c[m.code] ? c[m.code].reason : "Not in the comparison file") : ch ? "Comparable boundaries" : "No valid votes on this ballot",
        ch, lead1: L.leader(m, st.ballot), lead0: L.leader(b, st.ballot)};
    });
  }
  let wardData = null;   // {code, cur, old, rows}
  let reqKey = 0;
  async function loadWards(code){
    const key = ++reqKey;
    $("detail").setAttribute("aria-busy", "true");
    const [cur, old, feats] = await Promise.all([now.municipality(code), base[st.baseline].municipality(code), atlas.showWards(code)]);
    if(key !== reqKey) return null;   // a newer selection has started; drop this answer
    $("detail").setAttribute("aria-busy", "false");
    const match = cmp.baselines[st.baseline].wards[code] || {};
    const pts = Object.fromEntries(feats.map(f => [String(f.properties.WardId), f.properties.pt]));
    const rows = Object.entries(cur.wards).map(([wid, w]) => {
      const bw = match[wid] && old.wards[match[wid]];
      const ch = bw ? L.changeRow(w, bw, st.ballot) : null;
      return {code: wid, name: `Ward ${L.wardNo(wid)}`, prov: cur.name, ok: !!ch, pt: pts[wid],
        reason: bw ? (ch ? "Same voting districts as " + st.baseline + " ward " + L.wardNo(match[wid]) : "No valid votes on this ballot")
          : "These ward boundaries changed; a direct comparison is unavailable.",
        ch, lead1: L.leader(w, st.ballot), lead0: bw ? L.leader(bw, st.ballot) : null};
    }).sort((a, b) => L.wardNo(a.code) - L.wardNo(b.code));
    wardData = {code, key: st.baseline + st.ballot, rows};
    return wardData;
  }

  // ---------- scales ----------
  const PP_BINS = [-20, -10, -5, -1, 1, 5, 10, 20];
  const PAL = ["#8a4416", ORANGE, "#d9925f", "#f0cdb2", "#eceff2", "#b6d4ec", "#5fa3d9", BLUE, "#00508a"];
  function niceMax(x){ if(!(x > 0)) return 1; const p = 10 ** Math.floor(Math.log10(x)); return [1, 2, 5, 10].map(k => k * p).find(k => k >= x); }
  function bins(rows){
    if(st.measure === "share") return PP_BINS;
    const M = niceMax(Math.max(1, ...rows.filter(r => r.ok).map(r => Math.abs(val(r)))));
    const e = [M / 2, M / 5, M / 20, M / 100].map(niceMax);
    return [-e[0], -e[1], -e[2], -e[3], e[3], e[2], e[1], e[0]];
  }
  const colourOf = (v, edges) => { let i = 0; while(i < edges.length && v >= edges[i]) i++; return PAL[i]; };
  const fmtVal = (v, s = st) => s.measure === "share" ? L.fmtPP(v) : L.fmtDelta(v) + " votes";
  const unitWord = () => st.level === "ward" ? "ward" : "municipality";

  // ---------- map ----------
  let marks = [], voteMax = 1;
  const atlas = await Atlas.create({container: $("atlas"), loadingText: "Loading municipal comparisons…",
    hover: (kind, p) => {
      const r = kind === "ward" ? (wardData && wardData.rows.find(x => x.code === String(p.WardId))) : current.find(x => x.code === p.MunicCode);
      if(!r) return null;
      const title = kind === "ward" ? `${r.name}, ${E(r.prov)}` : E(r.name);
      if(!r.ch) return `<b>${title}</b><br><span class="tip-mute">${E(r.reason)}</span>`;
      const body = st.measure === "share" ? `DA ${L.fmtPct(r.ch.s0)} → ${L.fmtPct(r.ch.s1)}<br><b>${L.fmtPP(r.ch.dpp)}</b> DA share change`
        : `DA votes ${L.fmtVotes(r.ch.d0)} → ${L.fmtVotes(r.ch.d1)}<br><b>${L.fmtDelta(r.ch.dvotes)}</b> DA votes`;
      return `<b>${title}</b><br>${body}<br><span class="tip-mute">${st.baseline} vs 2026 · ${L.BALLOT_LABEL[st.ballot]}</span>`;
    },
    onClick: (kind, p) => kind === "ward" ? selectWard(String(p.WardId)) : selectMunic(p.MunicCode),
    draw: project => {
      if(st.view !== "arrows") return "";
      let s = "";
      for(const m of marks){
        const [x, y] = project(m.pt);
        if(m.v == null) continue;
        const sel = m.code === (st.level === "ward" ? st.ward : st.area);
        const len = st.measure === "share" ? Math.min(40, 2 * Math.abs(m.v)) : 40 * Math.sqrt(Math.abs(m.v) / voteMax);
        const tiny = st.measure === "share" ? Math.abs(m.v) < 0.05 : m.v === 0;
        if(tiny){ s += `<line x1="${x}" y1="${y - 3}" x2="${x}" y2="${y + 3}" stroke="${ZERO}" stroke-width="1.5"/>`; continue; }
        s += arrow(x, y, Math.sign(m.v) * Math.max(len, 1.5), sel);
      }
      return s;
    }});
  function arrow(x, y, dx, sel){
    const c = dx > 0 ? BLUE : ORANGE, h = 3.5, ex = x + dx, d = Math.sign(dx);
    return `<g${sel ? ' class="sel"' : ""}><line x1="${x}" y1="${y}" x2="${ex - d * h}" y2="${y}" stroke="${c}" stroke-width="${sel ? 2.5 : 1.5}"/>`
      + `<path d="M${ex},${y} L${ex - d * h * 1.6},${y - h} L${ex - d * h * 1.6},${y + h} Z" fill="${c}"/></g>`;
  }

  // ---------- render ----------
  let current = [];   // rows for the current unit (municipalities in scope, or wards of one municipality)
  async function render(opts = {}){
    await loadBase(st.baseline);
    $("baseline").value = st.baseline; $("ballot").value = st.ballot; $("province").value = st.province; $("measure").value = st.measure;
    document.querySelectorAll(".viewswitch button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.view === st.view)));
    const all = municRows();
    if(st.area && !byCode[st.area]){ st.area = ""; st.level = "municipality"; }
    if(st.level === "ward" && st.area){
      if(!wardData || wardData.code !== st.area || wardData.key !== st.baseline + st.ballot){ if(!await loadWards(st.area)) return; }
      current = wardData.rows;
    }else{
      st.level = "municipality"; st.ward = ""; wardData = null; atlas.clearWards();
      current = all.filter(r => !st.province || r.prov === st.province);
    }
    const scopeName = st.level === "ward" ? byCode[st.area].name : st.province || "South Africa";
    $("mapTitle").textContent = `DA ${st.measure === "share" ? "share" : "vote"} change by ${st.level === "ward" ? "ward, " + byCode[st.area].name : "municipality"}`;
    $("lede").textContent = `Where DA support rose and fell between the ${st.baseline} and 2026 local elections.`;
    $("basis").textContent = `${L.BALLOT_LABEL[st.ballot].replace(" ballot", "")} ballot · 2026 vs ${st.baseline} · ${now.manifest.status === "final" && base[st.baseline].manifest.status === "final" ? "Final results, as declared by the IEC" : "Provisional"} · IEC data as of ${L.fmtSAST(now.generated)}`;

    // map colours and marks
    const edges = bins(current);
    voteMax = Math.max(1, ...current.filter(r => r.ok).map(r => Math.abs(r.ch.dvotes)));
    if(st.level === "municipality") voteMax = Math.max(1, ...all.filter(r => r.ok).map(r => Math.abs(r.ch.dvotes)));
    const colours = {};
    const pts = (await L.points()).munics;
    if(st.level === "ward"){
      atlas.paintMunics(Object.fromEntries(m26.map(m => [m.code, m.code === st.area ? null : "#f6f7f9"])));
      current.forEach(r => colours[r.code] = !r.ok ? NODATA : st.view === "shading" ? colourOf(val(r), edges) : LAND);
      atlas.paintWards(colours);
      marks = current.filter(r => r.pt).map(r => ({code: r.code, pt: r.pt, v: val(r)}));
    }else{
      all.forEach(r => colours[r.code] = st.province && r.prov !== st.province ? "#f6f7f9" : !r.ok ? NODATA : st.view === "shading" ? colourOf(val(r), edges) : LAND);
      atlas.paintMunics(colours);
      marks = current.map(r => ({code: r.code, pt: pts[r.code], v: val(r)}));
    }
    atlas.select(st.area); atlas.selectWard(st.level === "ward" ? st.ward : "");
    atlas.redraw();
    legend(edges);

    // one-sentence summary, pooled over the whole scope (never an average of places)
    let sum = "";
    if(st.level === "municipality"){
      const scope = m26.filter(m => !st.province || m.province === st.province);
      const p1 = L.pool(scope, st.ballot), p0 = L.pool(scope.map(m => mBase[st.baseline][m.code]), st.ballot);
      const provOK = !st.province || cmp.baselines[st.baseline].provinces[st.province].ok;
      if(p1 && p0 && provOK){
        const d = p1.share - p0.share;
        sum = Math.abs(d) < 0.05 ? `DA share was almost unchanged across ${scopeName} (${L.fmtPct(p0.share)} → ${L.fmtPct(p1.share)}).`
          : `DA share ${d > 0 ? "rose" : "fell"} by ${Math.abs(d).toFixed(1)} percentage points across ${scopeName}, from ${L.fmtPct(p0.share)} to ${L.fmtPct(p1.share)} (all ${scope.length} municipalities, ${L.BALLOT_LABEL[st.ballot].replace("Municipal", "municipal").replace("Ward", "ward")}).`;
      }
    }else{
      const ok = current.filter(r => r.ok);
      if(ok.length){
        const d0 = ok.reduce((a, r) => a + r.ch.d0, 0), v0 = ok.reduce((a, r) => a + r.ch.v0, 0), d1 = ok.reduce((a, r) => a + r.ch.d1, 0), v1 = ok.reduce((a, r) => a + r.ch.v1, 0);
        const d = 100 * d1 / v1 - 100 * d0 / v0;
        sum = `Across ${ok.length} comparable wards of ${current.length}, DA share ${Math.abs(d) < 0.05 ? "was almost unchanged" : (d > 0 ? "rose" : "fell") + " by " + Math.abs(d).toFixed(1) + " percentage points"} (${L.fmtPct(100 * d0 / v0)} → ${L.fmtPct(100 * d1 / v1)}).`;
      }else sum = `No comparable ward results for this selection. ${st.baseline} ward boundaries in ${E(byCode[st.area].name)} do not match 2026; the municipality total is still compared.`;
    }
    $("summary").innerHTML = sum;
    rankings(); table(); detail();
    if(opts.zoom){
      if(st.level === "ward" || st.area) atlas.zoomTo(st.area);
      else if(st.province) atlas.zoomToProvince(st.province); else atlas.zoomToSA();
    }
    $("methodSource").innerHTML = `Data: IEC “Downloadable detailed results” files, 2026 snapshot ${E(now.manifest.snapshot)} (IEC file generated ${L.fmtSAST(now.generated)}), ${st.baseline} snapshot ${E(base[st.baseline].manifest.snapshot)}. Comparability: <code>data/archive/compare.json</code>, built by <code>scripts/compare.py</code>.`;
  }

  function legend(edges){
    const no = `<span class="lg-item"><i class="sw" style="background:${NODATA}"></i>No comparison (boundaries changed)</span>`;
    if(st.view === "arrows"){
      const samples = st.measure === "share" ? [-10, -5, 0, 5, 10] : (() => { const M = niceMax(voteMax); return [-M, -M / 4, 0, M / 4, M]; })();
      const items = samples.map(v => {
        const len = st.measure === "share" ? Math.min(40, 2 * Math.abs(v)) : 40 * Math.sqrt(Math.abs(v) / voteMax);
        const g = v === 0 ? `<line x1="24" y1="7" x2="24" y2="15" stroke="${ZERO}" stroke-width="1.5"/>` : arrow(24 - Math.sign(v) * len / 2, 11, Math.sign(v) * len, false);
        return `<span class="lg-arrow"><svg width="48" height="22" aria-hidden="true">${g}</svg>${v === 0 ? "0" : fmtVal(v).replace(" votes", "")}</span>`;
      }).join("");
      $("legend").innerHTML = `<div class="lg-row">${items}${st.measure === "share" ? `<span class="lg-note">Arrows stop growing at 20 pp; exact values are in the details.</span>` : `<span class="lg-note">DA votes; arrow length grows with the square root of the change.</span>`}</div>
        <p class="lg-note">Blue, pointing right: DA ${st.measure === "share" ? "share" : "votes"} up. Orange, pointing left: down. Orange does not stand for any party. Arrows show the size of the change at each place, not people moving.</p><div class="lg-row">${no}</div>`;
    }else{
      const lab = st.measure === "share" ? ["≤−20", "−10", "−5", "−1", "+1", "+5", "+10", "≥+20"] : edges.map(e => (e > 0 ? "+" : "−") + L.fmtVotes(Math.abs(e)));
      const w = st.measure === "share" ? 40 : 62;
      $("legend").innerHTML = `<svg class="lg-svg" viewBox="0 0 ${PAL.length * w + 20} 34" width="${PAL.length * w + 20}" height="34" role="img" aria-label="Colour scale from ${lab[0]} to ${lab[lab.length - 1]}">
        ${PAL.map((c, i) => `<rect x="${10 + i * w}" y="0" width="${w}" height="12" fill="${c}"/>`).join("")}
        ${lab.map((t, i) => `<text x="${10 + (i + 1) * w}" y="28" text-anchor="middle">${t}</text>`).join("")}</svg>
        <p class="lg-note">${st.measure === "share" ? "Change in DA share, percentage points" : "Change in DA votes"}. Orange: down, blue: up, pale grey around zero. Orange does not stand for any party.</p><div class="lg-row">${no}</div>`;
    }
  }

  function rankings(){
    const ok = current.filter(r => r.ok);
    const sorted = [...ok].sort((a, b) => val(b) - val(a) || a.code.localeCompare(b.code));
    const gains = sorted.filter(r => val(r) > 0).slice(0, 10), losses = [...ok].sort((a, b) => val(a) - val(b) || a.code.localeCompare(b.code)).filter(r => val(r) < 0).slice(0, 10);
    const M = Math.max(1e-9, ...[...gains, ...losses].map(r => Math.abs(val(r))));
    const row = (r, i) => `<li><button type="button" class="rk${r.code === (st.level === "ward" ? st.ward : st.area) ? " on" : ""}" data-code="${r.code}">
      <span class="rk-n">${i + 1}</span><span class="rk-name">${E(r.name)}<small>${E(r.prov)}</small></span>
      <span class="rk-s">${L.fmtPct(r.ch.s0)} → ${L.fmtPct(r.ch.s1)}</span>
      <span class="rk-v"><i style="width:${(48 * Math.abs(val(r)) / M).toFixed(1)}px;background:${val(r) > 0 ? BLUE : ORANGE}"></i>${fmtVal(val(r)).replace(" votes", "")}</span></button></li>`;
    $("gains").innerHTML = gains.map(row).join("") || `<li class="note">No ${unitWord()} with a DA ${st.measure === "share" ? "share" : "vote"} gain here.</li>`;
    $("losses").innerHTML = losses.map(row).join("") || `<li class="note">No ${unitWord()} with a DA ${st.measure === "share" ? "share" : "vote"} loss here.</li>`;
    const out = current.length - ok.length;
    $("rankTitle").textContent = st.measure === "share" ? "Largest gains and losses in DA share" : "Most DA votes added and lost";
    $("rankNote").textContent = `${ok.length} ${unitWord() === "ward" ? "wards" : "municipalities"} with comparable boundaries ranked${out ? `; ${out} left out because their boundaries changed (see View all)` : ""}. ${st.measure === "share" ? "Change in percentage points." : "Change in DA votes."}`;
    document.querySelectorAll(".rk").forEach(b => b.onclick = () => st.level === "ward" ? selectWard(b.dataset.code) : selectMunic(b.dataset.code));
  }

  // ---------- complete table ----------
  let sortKey = "chg", sortDir = -1;
  const COLS = [["name", "Place"], ["prov", "Province"], ["d0", "DA votes, then"], ["d1", "DA votes, 2026"], ["s0", "DA share, then"], ["s1", "DA share, 2026"], ["chg", "Change (pp)"], ["dv", "Change (votes)"], ["status", "Comparison"]];
  const cell = (r, k) => ({name: r.name, prov: r.prov, d0: r.ch && r.ch.d0, d1: r.ch && r.ch.d1, s0: r.ch && r.ch.s0, s1: r.ch && r.ch.s1, chg: r.ch && r.ch.dpp, dv: r.ch && r.ch.dvotes, status: r.reason})[k];
  const flipped = r => r.lead0 && r.lead1 && r.lead0.party !== r.lead1.party;
  function tableRows(){
    let rows = current.filter(r => !$("flipOnly").checked || (r.ok && flipped(r)));
    return rows.sort((a, b) => {
      const x = cell(a, sortKey), y = cell(b, sortKey);
      if(x == null && y == null) return a.code.localeCompare(b.code); if(x == null) return 1; if(y == null) return -1;
      return (typeof x === "string" ? x.localeCompare(y) : x - y) * sortDir || a.code.localeCompare(b.code);
    });
  }
  function table(){
    $("flipLabel").textContent = st.ballot === "pr" ? "PR lead changed only" : "Ward-ballot leader changed only";
    $("table").innerHTML = `<caption class="sr-only">All ${unitWord() === "ward" ? "wards" : "municipalities"} in this view</caption><thead><tr>${COLS.map(([k, t]) =>
      `<th scope="col" aria-sort="${k === sortKey ? (sortDir > 0 ? "ascending" : "descending") : "none"}"><button type="button" data-k="${k}">${t.replace("then", st.baseline)}</button></th>`).join("")}</tr></thead>
      <tbody>${tableRows().map(r => `<tr${r.code === (st.level === "ward" ? st.ward : st.area) ? ' class="on"' : ""}><th scope="row"><button type="button" class="linkbtn" data-code="${r.code}">${E(r.name)}</button>${flipped(r) && r.ok ? `<small class="flip">${st.ballot === "pr" ? "PR lead changed" : "Ward-ballot leader changed"}: ${L.partyShort(r.lead0.party)} → ${L.partyShort(r.lead1.party)}</small>` : ""}</th>
        <td>${E(r.prov)}</td><td class="n">${r.ch ? L.fmtVotes(r.ch.d0) : "–"}</td><td class="n">${r.ch ? L.fmtVotes(r.ch.d1) : "–"}</td>
        <td class="n">${r.ch ? L.fmtPct(r.ch.s0) : "–"}</td><td class="n">${r.ch ? L.fmtPct(r.ch.s1) : "–"}</td>
        <td class="n">${r.ch ? L.fmtPP(r.ch.dpp) : "–"}</td><td class="n">${r.ch ? L.fmtDelta(r.ch.dvotes) : "–"}</td><td class="st">${E(r.reason)}</td></tr>`).join("")}</tbody>`;
    $("table").querySelectorAll("thead button").forEach(b => b.onclick = () => { sortDir = sortKey === b.dataset.k ? -sortDir : (b.dataset.k === "name" || b.dataset.k === "prov" ? 1 : -1); sortKey = b.dataset.k; table(); });
    $("table").querySelectorAll("tbody button").forEach(b => b.onclick = () => st.level === "ward" ? selectWard(b.dataset.code) : selectMunic(b.dataset.code));
  }
  $("flipOnly").onchange = table;
  $("csv").onclick = () => {
    const rows = tableRows();
    L.downloadCSV(`lge2026-shift-${st.level === "ward" ? st.area + "-wards" : (st.province ? L.PROV[st.province] : "ZA")}-${st.ballot}-vs${st.baseline}.csv`,
      ["id", "name", "parent", "ballot", "baseline_year", "current_year", "da_votes_baseline", "da_votes_2026", "valid_votes_baseline", "valid_votes_2026",
        "da_share_baseline_pct", "da_share_2026_pct", "change_pp", "change_votes", "comparable", "comparison_note", "leader_baseline", "leader_2026", "snapshot_2026", "snapshot_baseline", "status_2026"],
      rows.map(r => [r.code, r.name, r.prov, L.BALLOT_LABEL[st.ballot], +st.baseline, 2026, r.ch && r.ch.d0, r.ch && r.ch.d1, r.ch && r.ch.v0, r.ch && r.ch.v1,
        r.ch && r.ch.s0, r.ch && r.ch.s1, r.ch && r.ch.dpp, r.ch && r.ch.dvotes, r.ok ? "yes" : "no", r.reason,
        r.lead0 && r.lead0.party, r.lead1 && r.lead1.party, now.manifest.snapshot, base[st.baseline].manifest.snapshot, now.manifest.status]));
  };

  // ---------- selected place ----------
  function dumbbell(s0, s1, y0){
    const W = 300, x = v => 12 + v / 100 * (W - 24), a = x(s0), b = x(s1);
    return `<svg class="dumbbell" viewBox="0 0 ${W} 58" role="img" aria-label="DA share ${y0}: ${s0.toFixed(1)}%, 2026: ${s1.toFixed(1)}%">
      <line x1="12" x2="${W - 12}" y1="30" y2="30" stroke="#d9dfe5"/>${[0, 50, 100].map(v => `<line x1="${x(v)}" x2="${x(v)}" y1="26" y2="34" stroke="#b5bdc5"/><text x="${x(v)}" y="52" text-anchor="middle">${v}%</text>`).join("")}
      <line x1="${a}" x2="${b}" y1="30" y2="30" stroke="#55616d" stroke-width="2"/>
      <circle cx="${a}" cy="30" r="6" fill="#fff" stroke="#17212b" stroke-width="2"/><circle cx="${b}" cy="30" r="6" fill="${BLUE}"/>
      ${Math.abs(b - a) < 90 ? `<text x="${Math.min(Math.max((a + b) / 2, 80), W - 80)}" y="14" text-anchor="middle">○ ${y0}: ${s0.toFixed(1)}% · ● 2026: <tspan font-weight="700">${s1.toFixed(1)}%</tspan></text>`
        : `<text x="${Math.min(Math.max(a, 44), W - 44)}" y="14" text-anchor="middle">${y0}: ${s0.toFixed(1)}%</text><text x="${Math.min(Math.max(b, 44), W - 44)}" y="14" text-anchor="middle" font-weight="700">2026: ${s1.toFixed(1)}%</text>`}</svg>`;
  }
  async function detail(){
    const d = $("detail");
    const sel = st.level === "ward" && st.ward ? current.find(r => r.code === st.ward) : st.area ? municRows().find(r => r.code === st.area) : null;
    if(!sel){
      const pin = await L.pinnedOnly();
      d.innerHTML = `<h3 class="dt-title">Pick a place</h3><p>Click a municipality on the map, or use the lists and search, to see how the DA's result changed there.</p>
        ${pin && byCode[pin] ? `<p><button type="button" class="linkbtn" id="goPin">Your municipality: ${E(byCode[pin].name)}</button></p>` : ""}`;
      if($("goPin")) $("goPin").onclick = () => selectMunic(pin);
      return;
    }
    const isWard = st.level === "ward" && st.ward, m = byCode[st.area];
    const leadLabel = st.ballot === "pr" ? "PR leader" : isWard ? "Most votes on the ward ballot" : "Most ward-ballot votes";
    const lead = (x, y) => x ? `${E(L.partyShort(x.party))} ${L.fmtPct(x.share)}${x.tie ? " (tied)" : ""}` : "–";
    let h = `<h3 class="dt-title">${E(isWard ? `${sel.name}, ${m.name}` : m.name)}</h3>
      <p class="dt-sub">${isWard ? `${E(m.province)} · ward ${E(sel.code)}` : `${E(m.province)} · ${E(m.code)}`}</p>`;
    if(sel.ch){
      const big = st.measure === "share" ? `${L.fmtPP(sel.ch.dpp)}<small>DA share change</small>` : `${L.fmtDelta(sel.ch.dvotes)}<small>DA votes</small>`;
      h += `<p class="dt-big ${val(sel) > 0 ? "up" : val(sel) < 0 ? "dn" : ""}">${big}</p>
        <p class="dt-pair">${st.baseline}: <b>${L.fmtPct(sel.ch.s0)}</b> · 2026: <b>${L.fmtPct(sel.ch.s1)}</b></p>
        <p class="dt-line">DA votes: ${L.fmtVotes(sel.ch.d0)} → ${L.fmtVotes(sel.ch.d1)} (${L.fmtDelta(sel.ch.dvotes)})</p>
        <p class="dt-line">Valid votes: ${L.fmtVotes(sel.ch.v0)} → ${L.fmtVotes(sel.ch.v1)}</p>
        ${dumbbell(sel.ch.s0, sel.ch.s1, st.baseline)}`;
    }else{
      const cur = isWard ? null : L.daOf(m, st.ballot);
      h += `<p class="dt-line">${E(sel.reason)}</p>${cur ? `<p class="dt-line">2026 DA share: <b>${L.fmtPct(cur.share)}</b> (${L.fmtVotes(cur.d)} of ${L.fmtVotes(cur.v)} valid votes)</p>` : ""}`;
    }
    h += `<dl class="dt-kv"><dt>${leadLabel}, 2026</dt><dd>${lead(sel.lead1)}</dd><dt>${leadLabel}, ${st.baseline}</dt><dd>${sel.ch ? lead(sel.lead0) : "–"}</dd>
      <dt>Boundaries</dt><dd>${E(sel.reason)}</dd><dt>Ballot</dt><dd>${L.BALLOT_LABEL[st.ballot]}</dd></dl>
      <div class="dt-actions">
        ${isWard ? `<button type="button" class="btn" id="backMun">Back to ${E(m.name)}</button>` : st.level !== "ward" ? `<button type="button" class="btn" id="viewWards">View wards</button>` : ""}
        ${st.level === "ward" && !isWard ? `<button type="button" class="btn" id="backAll">Back to municipalities</button>` : ""}
        <a class="btn" href="explore.html?area=${m.code}${isWard ? "&ward=" + sel.code : ""}&ballot=${st.ballot === "pr" ? "municipal-pr" : "ward"}">View full result</a>
        <a class="btn" href="votes.html?baseline=${st.baseline}&area=${m.code}">See where votes changed</a>
        <button type="button" class="btn" id="pin">Pin municipality</button>
        <button type="button" class="btn" id="copy">Copy link</button>
      </div>`;
    d.innerHTML = h;
    if($("viewWards")) $("viewWards").onclick = () => { st.level = "ward"; st.ward = ""; save(); render({zoom: true}); };
    if($("backAll")) $("backAll").onclick = () => { st.level = "municipality"; st.ward = ""; save(); render({zoom: true}); };
    if($("backMun")) $("backMun").onclick = () => { st.ward = ""; save(); render(); };
    $("pin").onclick = async () => { await L.pinCode(m.code); $("pin").textContent = "Pinned"; L.announce(`${m.name} pinned`); };
    $("copy").onclick = () => navigator.clipboard.writeText(location.href).then(() => { $("copy").textContent = "Link copied"; });
    L.announce(`${isWard ? sel.name + ", " : ""}${m.name}: ${sel.ch ? fmtVal(val(sel)) : sel.reason}`);
  }
  function selectMunic(code){
    if(!byCode[code]) return;
    if(st.level === "ward" && st.area !== code){ st.level = "municipality"; st.ward = ""; }
    if(st.area === code && st.level === "municipality") return;
    st.area = code; save(); render();
    if(matchMedia("(max-width:999px)").matches) $("detail").scrollIntoView({behavior: L.prefersReduced() ? "auto" : "smooth", block: "nearest"});
  }
  function selectWard(id){ st.ward = id; save(); render(); }

  // ---------- controls ----------
  $("baseline").onchange = e => { st.baseline = e.target.value; save(); render(); };
  $("ballot").onchange = e => { st.ballot = e.target.value; save(); render(); };
  $("province").onchange = e => { st.province = e.target.value; if(st.area && st.province && byCode[st.area].province !== st.province){ st.area = ""; st.level = "municipality"; st.ward = ""; } save(); render({zoom: true}); };
  $("measure").onchange = e => { st.measure = e.target.value; save(); render(); };
  document.querySelectorAll(".viewswitch button").forEach(b => b.onclick = () => { st.view = b.dataset.view; save(); render(); });
  window.addEventListener("popstate", () => { st = readURL(); render({zoom: true}); });

  // search: municipalities (with familiar city names) and every ward with its parent
  const items = m26.flatMap(m => [{label: m.name, sub: `${m.province} · ${m.code}`, code: m.code, keys: (AKA[m.code] || "").toLowerCase()},
    ...Array.from({length: m.wards}, (_, i) => ({label: `Ward ${i + 1}, ${m.name}`, sub: m.province, code: "", mun: m.code, ward: i + 1, keys: `ward ${i + 1} ${(AKA[m.code] || "").toLowerCase()}`}))]);
  L.combobox($("q"), $("qlist"), q => L.searchItems(items, q), async it => {
    if(!it.ward){ st.level = "municipality"; st.ward = ""; st.area = it.code; save(); return render({zoom: true}); }
    st.area = it.mun; st.level = "ward"; save(); await render({zoom: true});
    const r = current.find(x => L.wardNo(x.code) === it.ward); if(r) selectWard(r.code);
  });

  save(false);
  render({zoom: !!(st.area || st.province)});
})();
