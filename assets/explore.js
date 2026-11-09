// Every result: the official result for any municipality, ward or voting district, on one ballot and
// in one election year. Data: data/archive/<year>/ (IEC counts), geo/ (IEC 2026 boundaries).
(async function(){
  const L = window.LGE, K = window.Charts, $ = id => document.getElementById(id), E = L.esc;
  const NODATA = "#e2e6ea", TIE = "#6b7580";
  const DA_BINS = [20, 40, 60, 80], DA_PAL = ["#e3eef8", "#b3d1ec", "#6fa9db", "#2f7cc0", "#0b4f8a"];
  const PART_BINS = [40, 50, 60, 70], PART_PAL = ["#eef0f3", "#c9d0d8", "#9aa6b3", "#66788a", "#34475b"];
  const AKA = {JHB: "Johannesburg", TSH: "Pretoria", ETH: "Durban", NMA: "Gqeberha", BUF: "East London", MAN: "Bloemfontein", EKU: "Ekurhuleni", CPT: "Cape Town"};

  function readURL(){
    const q = new URLSearchParams(location.search);
    return {year: ["2021", "2016"].includes(q.get("year")) ? q.get("year") : "2026", ballot: q.get("ballot") === "ward" ? "ward" : "pr",
      mode: ["da", "part"].includes(q.get("map")) ? q.get("map") : "leader", area: q.get("area") || "", ward: q.get("ward") || "", vd: q.get("vd") || ""};
  }
  const urlFor = s => "?" + new URLSearchParams(Object.entries({year: s.year, ballot: s.ballot === "pr" ? "municipal-pr" : "ward", map: s.mode, area: s.area, ward: s.ward, vd: s.vd}).filter(([, v]) => v));
  let st = readURL();
  const save = (push = true) => history[push ? "pushState" : "replaceState"](null, "", urlFor(st));

  const snaps = {}, lists = {};
  let cmp;
  try{ [snaps[2026], cmp] = await Promise.all([L.snapshot(2026), L.compareInfo()]); lists[2026] = await snaps[2026].municipalities(); }
  catch(e){ $("detail").innerHTML = `<p class="pg-error">Results could not be loaded. <a href="">Try again</a>.</p>`; return; }
  try{ await document.fonts.ready; }catch(e){}
  async function year(y){ if(!snaps[y]){ snaps[y] = await L.snapshot(+y); lists[y] = await snaps[y].municipalities(); } return lists[y]; }
  const byCode = Object.fromEntries(lists[2026].map(m => [m.code, m]));

  // ---------- helpers ----------
  const b = (u, ballot = st.ballot) => u && u.ballots && u.ballots[ballot];
  const part = u => { const x = b(u); return x && u.registered > 0 ? 100 * (x.valid + x.spoilt) / u.registered : null; };
  const bin = (v, edges, pal) => { let i = 0; while(i < edges.length && v >= edges[i]) i++; return pal[i]; };
  function colourOf(u){
    if(!b(u) || !(b(u).valid > 0)) return NODATA;
    if(st.mode === "leader"){ const l = L.leader(u, st.ballot); return l.tie ? TIE : L.partyColour(l.party); }
    if(st.mode === "da") return bin(L.daOf(u, st.ballot).share, DA_BINS, DA_PAL);
    const p = part(u); return p == null ? NODATA : bin(p, PART_BINS, PART_PAL);
  }
  function sumUnits(units){
    const out = {registered: 0, ballots: {}};
    for(const u of units){ out.registered += u.registered || 0;
      for(const [k, x] of Object.entries(u.ballots)){ const t = out.ballots[k] || (out.ballots[k] = {valid: 0, spoilt: 0, votes: {}});
        t.valid += x.valid; t.spoilt += x.spoilt || 0; for(const [p, v] of Object.entries(x.votes)) t.votes[p] = (t.votes[p] || 0) + v; } }
    return out;
  }

  // ---------- map ----------
  let munFile = null, reqKey = 0;
  const atlas = await Atlas.create({container: $("atlas"), loadingText: "Loading the map…",
    hover: (kind, p) => {
      const u = kind === "ward" ? munFile && munFile.wards[String(p.WardId)] : unitsNow[p.MunicCode];
      const name = kind === "ward" ? `Ward ${p.WardNo}, ${byCode[st.area].name}` : (byCode[p.MunicCode] || {}).name;
      if(!u || !b(u)) return `<b>${E(name)}</b><br><span class="tip-mute">No result for this view</span>`;
      const l = L.leader(u, st.ballot), r = Object.entries(b(u).votes).sort((x, y) => y[1] - x[1]).slice(0, 2);
      const extra = st.mode === "da" ? `DA ${L.fmtPct(L.daOf(u, st.ballot).share)}<br>` : st.mode === "part" ? `Ballots cast / registered ${L.fmtPct(part(u))}<br>` : "";
      return `<b>${E(name)}</b><br>${extra}${r.map(([pp, v]) => `${E(L.partyShort(pp))} ${L.fmtPct(100 * v / b(u).valid)}`).join(" · ")}${l.tie ? " (tied)" : ""}<br><span class="tip-mute">${st.year} · ${L.BALLOT_LABEL[st.ballot]}</span>`;
    },
    onClick: (kind, p) => { if(kind === "ward"){ st.ward = String(p.WardId); st.vd = ""; } else { if(st.area === p.MunicCode && !st.ward) return; st.area = p.MunicCode; st.ward = ""; st.vd = ""; } save(); render({zoom: kind !== "ward"}); }});

  let unitsNow = {};
  async function render(opts = {}){
    const key = ++reqKey;
    $("year").value = st.year; $("ballot").value = st.ballot; $("mode").value = st.mode;
    $("detail").setAttribute("aria-busy", "true");
    const list = await year(st.year);
    if(st.area && !byCode[st.area]){ $("detail").innerHTML = `<p class="pg-error">No municipality with code “${E(st.area)}”. <a href="explore.html">Start from South Africa</a>.</p>`; st.area = ""; }
    const histOK = c => st.year === "2026" || cmp.baselines[st.year].munics[c].ok;
    unitsNow = Object.fromEntries(list.filter(m => histOK(m.code)).map(m => [m.code, m]));
    munFile = st.area ? await snaps[st.year].municipality(st.area) : null;
    let feats = [];
    if(st.area && st.year === "2026") feats = await atlas.showWards(st.area); else atlas.clearWards();
    if(key !== reqKey) return;   // a newer selection has started
    $("detail").setAttribute("aria-busy", "false");
    if(st.ward && !(munFile && munFile.wards[st.ward])){ st.ward = ""; st.vd = ""; }

    atlas.paintMunics(Object.fromEntries(lists[2026].map(m => [m.code, st.area && st.year === "2026" && m.code === st.area ? null : st.area && st.year === "2026" ? "#f6f7f9" : unitsNow[m.code] ? colourOf(unitsNow[m.code]) : NODATA])));
    if(feats.length) atlas.paintWards(Object.fromEntries(Object.entries(munFile.wards).map(([id, w]) => [id, colourOf(w)])));
    atlas.select(st.area); atlas.selectWard(st.ward);
    $("mapTitle").textContent = `${{leader: st.ballot === "pr" ? "Leading party" : "Most votes on the ward ballot", da: "DA share", part: "Ballots cast as a share of registered voters"}[st.mode]} · ${L.BALLOT_LABEL[st.ballot].replace(" ballot", "")} · ${st.year}${st.area && st.year === "2026" ? " · wards of " + byCode[st.area].name : ""}`;
    $("basis").textContent = `${L.BALLOT_LABEL[st.ballot]} · ${st.year} · ${snaps[st.year].manifest.status === "final" ? "Final results, as declared by the IEC" : "Provisional"} · IEC data as of ${L.fmtSAST(snaps[st.year].generated)}`;
    legend(); trail(); detail(); children();
    if(opts.zoom) st.area ? atlas.zoomTo(st.area) : atlas.zoomToSA();
    $("methodSource").textContent = `Snapshot ${snaps[st.year].manifest.snapshot} (${st.year}), IEC file generated ${L.fmtSAST(snaps[st.year].generated)}.`;
  }

  function legend(){
    const sw = (c, t) => `<span class="lg-item"><i class="sw" style="background:${c}"></i>${t}</span>`;
    let h;
    if(st.mode === "leader"){
      const seen = {}; Object.values(st.area && munFile && st.year === "2026" ? munFile.wards : unitsNow).forEach(u => { const l = L.leader(u, st.ballot); if(l && !l.tie) seen[l.party] = (seen[l.party] || 0) + 1; });
      h = Object.entries(seen).sort((a, c) => c[1] - a[1]).map(([p, n]) => sw(L.partyColour(p), `${E(L.partyShort(p))} (${n})`)).join("") + sw(TIE, "Tied");
      h = `<div class="lg-row">${h}</div><p class="lg-note">Colour shows the party with most votes on this ballot, not who governs the council. Number of places in brackets.</p>`;
    }else{
      const [edges, pal, unit] = st.mode === "da" ? [DA_BINS, DA_PAL, "DA share of valid votes"] : [PART_BINS, PART_PAL, "ballots cast (valid + spoilt) ÷ registered voters, calculated"];
      h = `<div class="lg-row">${pal.map((c, i) => sw(c, i === 0 ? `under ${edges[0]}%` : i === pal.length - 1 ? `${edges[i - 1]}% or more` : `${edges[i - 1]}–${edges[i]}%`)).join("")}</div><p class="lg-note">${unit}</p>`;
    }
    h += `<div class="lg-row">${sw(NODATA, st.year === "2026" ? "No result" : "Boundary changed since " + st.year + ": see the table")}</div>`;
    $("legend").innerHTML = h;
  }

  function trail(){
    const parts = [`<a href="${urlFor({...st, area: "", ward: "", vd: ""})}" data-go="sa">South Africa</a>`];
    if(st.area){ parts.push(`<span>${E(byCode[st.area].province)}</span>`, `<a href="${urlFor({...st, ward: "", vd: ""})}" data-go="mun">${E(byCode[st.area].name)}</a>`); }
    if(st.ward) parts.push(`<a href="${urlFor({...st, vd: ""})}" data-go="ward">Ward ${L.wardNo(st.ward)}</a>`);
    if(st.vd) parts.push(`<span>Voting district ${E(st.vd)}</span>`);
    $("trail").innerHTML = parts.join(" / ");
    $("trail").querySelectorAll("a").forEach(a => a.onclick = e => { e.preventDefault(); const g = a.dataset.go;
      if(g === "sa") st.area = ""; if(g !== "ward") st.ward = ""; st.vd = ""; save(); render({zoom: g !== "ward"}); });
  }

  // ---------- the selected place ----------
  function current(){
    if(st.vd && munFile && munFile.vds[st.vd]) return {u: munFile.vds[st.vd], title: `Voting district ${st.vd}`, sub: `${munFile.vds[st.vd].station ? L.titleCase(munFile.vds[st.vd].station) + " · " : ""}Ward ${L.wardNo(munFile.vds[st.vd].ward)}, ${byCode[st.area].name}`, kind: "vd"};
    if(st.ward && munFile) return {u: munFile.wards[st.ward], title: `Ward ${L.wardNo(st.ward)}, ${byCode[st.area].name}`, sub: `${byCode[st.area].province} · ward ${st.ward}`, kind: "ward"};
    if(st.area){ const m = lists[st.year].find(x => x.code === st.area); return {u: m, title: m.name, sub: `${m.province} · ${m.code} · municipality`, kind: "munic"}; }
    return {u: sumUnits(lists[st.year]), title: "South Africa", sub: `All ${lists[st.year].length} local and metropolitan municipalities`, kind: "sa"};
  }
  let showAll = false;
  async function detail(){
    const c = current(), x = b(c.u), d = $("detail");
    let h = `<h3 class="dt-title">${E(c.title)}</h3><p class="dt-sub">${E(c.sub)}</p>
      <p class="dt-sub">${L.BALLOT_LABEL[st.ballot]} · ${st.year} · ${snaps[st.year].manifest.status === "final" ? "Final" : "Provisional"} · ${L.fmtSAST(snaps[st.year].generated)}</p>
      <div class="dt-actions">${st.area ? `<button type="button" class="btn" id="pin">Pin municipality</button>` : ""}<button type="button" class="btn" id="copy">Copy link</button><button type="button" class="btn" id="csv">Download CSV</button></div>`;
    if(!c.kind || !x || !(x.valid > 0)){ d.innerHTML = h + `<p class="dt-line">No ${L.BALLOT_LABEL[st.ballot].toLowerCase()} result for this place in ${st.year}.</p>`; wire(c); return; }
    const l = L.leader(c.u, st.ballot);
    h += `<p class="dt-lead">${l.tie ? `Tied: ${E(L.partyShort(l.party))} and ${E(L.partyShort(l.runner))} have the same number of votes`
      : `<b>${E(L.titleCase(l.party))}</b> ${st.ballot === "pr" ? "leads the municipal PR vote" : "has the most votes on the ward ballot"} with ${L.fmtPct(l.share)}, ${L.fmtPP(l.lead).replace("+", "")} ahead of ${E(L.partyShort(l.runner || "–"))}.`}</p>`;
    if(c.kind === "sa" && !st.area){ const pin = await L.pinnedOnly(); if(pin && byCode[pin]) h += `<p><button type="button" class="linkbtn" id="goPin">Your municipality: ${E(byCode[pin].name)}</button></p>`; else h += `<p class="note">Click a municipality on the map, or search, to see its result.</p>`; }
    const rows = Object.entries(x.votes).sort((p, q) => q[1] - p[1] || p[0].localeCompare(q[0]));
    const vis = showAll ? rows : rows.slice(0, 8);
    h += `<table class="ptable"><caption class="sr-only">Votes by party</caption><thead><tr><th scope="col">Party</th><th scope="col" class="n">Votes</th><th scope="col" class="n">Share</th></tr></thead><tbody>
      ${vis.map(([p, v]) => `<tr${p === L.DA ? ' class="da"' : ""}><th scope="row"><i class="sw" style="background:${L.partyColour(p)}"></i>${E(L.partyShort(p))}<small>${E(L.titleCase(p))}</small>
        <span class="pbar"><i style="width:${(100 * v / x.valid).toFixed(2)}%;background:${L.partyColour(p)}"></i></span></th><td class="n">${L.fmtVotes(v)}</td><td class="n">${L.fmtPct(100 * v / x.valid)}</td></tr>`).join("")}</tbody></table>
      ${rows.length > 8 ? `<button type="button" class="linkbtn" id="more">${showAll ? "Show top 8 only" : `Show all ${rows.length} parties`}</button>` : ""}`;
    const reg = c.u.registered;
    h += `<h4 class="dt-h">Ballots</h4><dl class="dt-kv"><dt>Valid votes</dt><dd>${L.fmtVotes(x.valid)}</dd><dt>Spoilt ballots</dt><dd>${x.spoilt != null ? L.fmtVotes(x.spoilt) : "Unavailable"}</dd>
      <dt>Ballots cast (valid + spoilt)</dt><dd>${x.spoilt != null ? L.fmtVotes(x.valid + x.spoilt) : "Unavailable"}</dd><dt>Registered voters</dt><dd>${reg ? L.fmtVotes(reg) : "Unavailable"}</dd>
      <dt>Ballots cast / registered</dt><dd>${reg && x.spoilt != null ? L.fmtPct(100 * (x.valid + x.spoilt) / reg) + " (calculated; not the IEC's official turnout)" : "Unavailable"}</dd></dl>`;
    h += await history_(c);
    if(st.area) h += `<p class="dt-links"><a href="shift.html?area=${st.area}${st.ward ? "&level=ward&ward=" + st.ward : ""}&ballot=${st.ballot === "pr" ? "municipal-pr" : "ward"}">See the shift</a> · <a href="votes.html?area=${st.area}">Where votes changed</a></p>`;
    d.innerHTML = h; drawHist(); wire(c, rows, x);
  }
  // Earlier elections for the same place, only where the place is comparable.
  async function history_(c){
    if(c.kind === "vd") return "";
    histSeries = null;
    if(c.kind === "ward" && st.year !== "2026") return `<h4 class="dt-h">Earlier elections</h4><p class="dt-line">Earlier elections are shown for 2026 wards only.</p>`;
    const years = ["2026", "2021", "2016"], obs = {};
    for(const y of years){
      if(c.kind === "sa"){ obs[y] = sumUnits(await year(y)); continue; }
      if(c.kind === "munic"){ if(y === "2026" || cmp.baselines[y].munics[st.area].ok) obs[y] = (await year(y)).find(m => m.code === st.area); continue; }
      if(y === "2026"){ obs[y] = c.u; continue; }
      const bw = (cmp.baselines[y].wards[st.area] || {})[st.ward];
      if(bw){ await year(y); obs[y] = (await snaps[y].municipality(st.area)).wards[bw]; }
    }
    const got = years.filter(y => obs[y] && b(obs[y]) && b(obs[y]).valid > 0);
    if(got.length < 2) return `<h4 class="dt-h">Earlier elections</h4><p class="dt-line">${c.kind === "ward" ? "This ward's voting districts changed since 2021 and 2016, so there is no earlier result to compare." : "No comparable earlier result, because the boundary changed."}</p>`;
    // parties: union of the top 3 in each year shown, plus the DA
    const ps = new Set([L.DA]); got.forEach(y => Object.entries(b(obs[y]).votes).sort((p, q) => q[1] - p[1]).slice(0, 3).forEach(([p]) => ps.add(p)));
    const sh = (y, p) => { const x = b(obs[y]); return x.votes[p] != null ? 100 * x.votes[p] / x.valid : null; };
    const yrs = [...got].reverse(), da = yrs.map(y => sh(y, L.DA));
    histSeries = {years: yrs, series: [...ps].map(p => ({label: L.partyShort(p), vals: yrs.map(y => sh(y, p)), colour: L.partyColour(p), strong: p === L.DA}))};
    const where = c.kind === "ward" ? c.title : c.title, daTxt = da.every(v => v != null) ? `DA share here: ${yrs.map((y, i) => `${L.fmtPct(da[i])} in ${y}`).join(", ").replace(/, ([^,]*)$/, " and $1")}.` : "";
    return `<h4 class="dt-h">Earlier elections</h4><p class="dt-line">${E(daTxt)}</p>
      <svg id="histFig" class="ch-svg" role="img" aria-label="Party shares in ${E(where)}, ${yrs.join(", ")}"></svg>
      <p class="note">Same ${c.kind === "ward" ? "voting districts" : "boundary"}, ${L.BALLOT_LABEL[st.ballot].replace(/^./, x => x.toLowerCase())}. The top three parties of each year, plus the DA.</p>
      <details class="dt-more"><summary>Show the numbers</summary>
      <table class="ptable"><thead><tr><th scope="col">Party</th>${got.map(y => `<th scope="col" class="n">${y}</th>`).join("")}</tr></thead><tbody>
      ${[...ps].map(p => `<tr${p === L.DA ? ' class="da"' : ""}><th scope="row"><i class="sw" style="background:${L.partyColour(p)}"></i>${E(L.partyShort(p))}</th>${got.map(y => `<td class="n">${L.fmtPct(sh(y, p))}</td>`).join("")}</tr>`).join("")}
      <tr><th scope="row">Valid votes</th>${got.map(y => `<td class="n">${L.fmtVotes(b(obs[y]).valid)}</td>`).join("")}</tr></tbody></table>
      <p class="note">A dash means the party had no votes listed that year.</p></details>`;
  }
  let histSeries = null;
  function drawHist(){
    const svg = $("histFig"); if(!svg || !histSeries) return;
    K.slope(svg, {years: histSeries.years, series: histSeries.series, fmt: v => v.toFixed(1) + "%", w: Math.max(260, Math.round(svg.getBoundingClientRect().width))});
  }
  function wire(c, rows, x){
    if($("more")) $("more").onclick = () => { showAll = !showAll; detail(); };
    if($("goPin")) $("goPin").onclick = async () => { st.area = await L.pinnedOnly(); save(); render({zoom: true}); };
    if($("pin")) $("pin").onclick = async () => { await L.pinCode(st.area); $("pin").textContent = "Pinned"; L.announce("Municipality pinned"); };
    $("copy").onclick = () => navigator.clipboard.writeText(location.href).then(() => { $("copy").textContent = "Link copied"; });
    $("csv").onclick = () => {
      if(!rows) return;
      L.downloadCSV(`lge-${st.year}-${st.vd || st.ward || st.area || "ZA"}-${st.ballot}.csv`,
        ["year", "area_type", "area_id", "area_name", "municipality_code", "ballot", "party", "votes", "valid_votes", "share_pct", "spoilt", "registered", "status", "snapshot", "source_generated_sast"],
        rows.map(([p, v]) => [+st.year, c.kind, st.vd || st.ward || st.area || "ZA", c.title, st.area, L.BALLOT_LABEL[st.ballot], p, v, x.valid, 100 * v / x.valid, x.spoilt, c.u.registered,
          snaps[st.year].manifest.status, snaps[st.year].manifest.snapshot, snaps[st.year].manifest.sourceGenerated]));
    };
    L.announce(`${c.title}: ${st.year}, ${L.BALLOT_LABEL[st.ballot]}`);
  }

  // ---------- child table: municipalities, wards or voting districts ----------
  function children(){
    let rows, title, note = "";
    if(st.ward && munFile){
      rows = Object.entries(munFile.vds).filter(([, v]) => v.ward === st.ward).map(([id, v]) => ({id, name: `${id}${v.station ? " · " + L.titleCase(v.station) : ""}`, u: v, go: () => { st.vd = id; save(); render(); }}));
      title = `Voting districts in ward ${L.wardNo(st.ward)}`; note = "Voting districts have no boundaries in the IEC files, so they are listed here rather than mapped.";
    }else if(st.area && munFile){
      rows = Object.entries(munFile.wards).map(([id, w]) => ({id, name: `Ward ${L.wardNo(id)}`, u: w, go: () => { st.ward = id; st.vd = ""; save(); render(); }})).sort((a, c) => L.wardNo(a.id) - L.wardNo(c.id));
      title = `Wards of ${byCode[st.area].name}, ${st.year}`;
      if(st.year !== "2026") note = `The map shows 2026 wards only, so ${st.year} wards are listed here.`;
    }else{
      rows = lists[st.year].map(m => ({id: m.code, name: m.name, u: m, go: () => { st.area = m.code; save(); render({zoom: true}); }})).sort((a, c) => a.name.localeCompare(c.name));
      title = `All municipalities, ${st.year}`;
    }
    const kind = st.ward ? "voting districts" : st.area ? "wards" : "municipalities";
    $("children").hidden = false; $("childTitle").textContent = st.ward ? (rows.length === 1 ? `Show the voting district in ward ${L.wardNo(st.ward)}` : `Show all ${rows.length} voting districts in ward ${L.wardNo(st.ward)}`)
      : st.area ? `Show all ${rows.length} wards of ${byCode[st.area].name} (${st.year})` : `Show all ${rows.length} municipalities (${st.year})`; $("childNote").textContent = note;
    $("childCsv").onclick = () => L.downloadCSV(`lge-${st.year}-${st.ward || st.area || "ZA"}-${kind.replace(" ", "-")}-${st.ballot}.csv`,
      ["year", "id", "name", "ballot", "leader", "leader_share_pct", "da_share_pct", "valid_votes", "status", "snapshot"],
      rows.map(r => { const l = L.leader(r.u, st.ballot), da = L.daOf(r.u, st.ballot); return [+st.year, r.id, r.name, L.BALLOT_LABEL[st.ballot], l && l.party, l && l.share, da && da.share, b(r.u) && b(r.u).valid, snaps[st.year].manifest.status, snaps[st.year].manifest.snapshot]; }));
    $("childTable").innerHTML = `<thead><tr><th scope="col">Place</th><th scope="col">Leader</th><th scope="col" class="n">Leader share</th><th scope="col" class="n">DA share</th><th scope="col" class="n">Valid votes</th></tr></thead><tbody>
      ${rows.map((r, i) => { const l = L.leader(r.u, st.ballot), da = L.daOf(r.u, st.ballot);
        return `<tr><th scope="row"><button type="button" class="linkbtn" data-i="${i}">${E(r.name)}</button></th><td>${l ? `<i class="sw" style="background:${l.tie ? TIE : L.partyColour(l.party)}"></i>${E(L.partyShort(l.party))}${l.tie ? " (tied)" : ""}` : "No result"}</td>
          <td class="n">${l ? L.fmtPct(l.share) : "–"}</td><td class="n">${da ? L.fmtPct(da.share) : "–"}</td><td class="n">${b(r.u) ? L.fmtVotes(b(r.u).valid) : "–"}</td></tr>`; }).join("")}</tbody>`;
    $("childTable").querySelectorAll("button").forEach(btn => btn.onclick = () => rows[+btn.dataset.i].go());
  }

  // ---------- controls ----------
  $("year").onchange = e => { st.year = e.target.value; if(st.year !== "2026"){ st.ward = ""; st.vd = ""; } save(); render(); };
  $("ballot").onchange = e => { st.ballot = e.target.value; save(); render(); };
  $("mode").onchange = e => { st.mode = e.target.value; save(); render(); };
  window.addEventListener("popstate", () => { st = readURL(); render({zoom: true}); });
  const items = lists[2026].flatMap(m => [{label: m.name, sub: `${m.province} · ${m.code}`, code: m.code, keys: (AKA[m.code] || "").toLowerCase()},
    ...Array.from({length: m.wards}, (_, i) => ({label: `Ward ${i + 1}, ${m.name}`, sub: m.province, mun: m.code, ward: i + 1, keys: `ward ${i + 1} ${(AKA[m.code] || "").toLowerCase()}`}))]);
  L.combobox($("q"), $("qlist"), q => L.searchItems(items, q), async it => {
    st.vd = "";
    if(!it.ward){ st.area = it.code; st.ward = ""; save(); return render({zoom: true}); }
    st.area = it.mun; st.year = "2026";
    const f = await snaps[2026].municipality(it.mun);
    st.ward = Object.keys(f.wards).find(id => L.wardNo(id) === it.ward) || ""; save(); render({zoom: true});
  });
  save(false);
  render({zoom: !!st.area});
})();
