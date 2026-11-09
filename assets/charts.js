// Chart helpers shared by the analysis pages: colours, text measuring, label placement that avoids
// collisions, a tooltip, a scale stretched near zero, a beeswarm layout and a slope chart.
// Layout only: every number drawn is computed by the page from IEC counts.
(function(){
  const C = {up: "#0077c8", dn: "#b65c20", upInk: "#005a9c", dnInk: "#9a4a12", ink: "#17212b", mute: "#55616d",
    grid: "#e2dccf", axis: "#8f9aa5", slate: "#8795a3", paper: "#f6f1e6", none: "#e2e6ea"};
  const sideCol = v => v > 0 ? C.up : v < 0 ? C.dn : C.axis;
  const sideInk = v => v > 0 ? C.upInk : v < 0 ? C.dnInk : C.mute;

  const ctx = document.createElement("canvas").getContext("2d");
  function textW(s, size = 12, weight = 400){ ctx.font = `${weight} ${size}px Inter, system-ui, sans-serif`; return ctx.measureText(String(s)).width; }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));

  // Greedy label placement. items (in priority order): {x, y, r, text, size, weight}. Each label tries
  // eight spots around its anchor and keeps the first that stays inside `bounds` and clear of every
  // label already placed and every box in `blocks`. Labels with no free spot are dropped.
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  function placeLabels(items, bounds, blocks = []){
    const taken = [...blocks], out = [];
    for(const it of items){
      const size = it.size || 12, w = textW(it.text, size, it.weight || 600), h = size + 2, g = (it.r || 0) + 3, d = g * 0.72;
      const spots = [[g, -h / 2], [-g - w, -h / 2], [-w / 2, -g - h], [-w / 2, g], [d, -d - h], [-d - w, -d - h], [d, d], [-d - w, d]];
      for(const [k, [dx, dy]] of spots.entries()){
        const b = {x: it.x + dx, y: it.y + dy, w, h};
        if(k === 2 || k === 3) b.x = Math.min(Math.max(b.x, bounds.x0), bounds.x1 - w);   // above/below: slide sideways to stay inside
        if(b.x < bounds.x0 || b.x + w > bounds.x1 || b.y < bounds.y0 || b.y + h > bounds.y1) continue;
        if(taken.some(t => hit(b, t))) continue;
        taken.push(b); out.push({...it, bx: b.x, by: b.y, w, h, size}); break;
      }
    }
    return out;
  }
  const labelSVG = l => `<text class="ch-lbl" x="${l.bx.toFixed(1)}" y="${(l.by + l.size * 0.86).toFixed(1)}" font-size="${l.size}" font-weight="${l.weight || 600}">${esc(l.text)}</text>`;

  // Spread values (e.g. end labels of a slope chart) so neighbours are at least `gap` apart, within [lo, hi].
  function spread(ys, gap, lo, hi){
    const o = ys.map((y, i) => ({y: Math.min(hi, Math.max(lo, y)), i})).sort((a, b) => a.y - b.y);
    for(let k = 1; k < o.length; k++) if(o[k].y - o[k - 1].y < gap) o[k].y = o[k - 1].y + gap;
    for(let k = o.length - 1; k >= 0; k--){ const cap = k === o.length - 1 ? hi : o[k + 1].y - gap; if(o[k].y > cap) o[k].y = cap; }
    const out = []; o.forEach(p => out[p.i] = p.y); return out;
  }

  // A tooltip inside a positioned wrapper element.
  function tip(wrap){
    let el = wrap.querySelector(":scope > .ch-tip");
    if(!el){ el = document.createElement("div"); el.className = "atlas-tip ch-tip"; el.hidden = true; wrap.appendChild(el); }
    return {
      show(html, x, y){
        el.innerHTML = html; el.hidden = false;
        const W = wrap.clientWidth, w = el.offsetWidth;
        let l = x + 14; if(l + w > W - 4) l = x - w - 14; if(l < 4) l = Math.max(4, Math.min(W - w - 4, x - w / 2));
        el.style.left = l + "px"; el.style.top = (y + 16) + "px";
      },
      hide(){ el.hidden = true; }};
  }

  // A scale that is linear near zero and logarithmic further out (inverse hyperbolic sine), so a
  // change of 300 votes and one of 200 000 both stay readable. Each decade gets the same width.
  const stretch = c => ({f: v => Math.asinh(v / c), c});
  function decades(lo, hi, c){
    const out = [0]; let p = 10 ** Math.ceil(Math.log10(Math.max(c, 1)));
    for(; p <= Math.max(-lo, hi) * 1.0001; p *= 10){ if(p <= hi) out.push(p); if(-p >= lo) out.push(-p); }
    return out.sort((a, b) => a - b);
  }
  function niceUp(x){ if(!(x > 0)) return 1; const p = 10 ** Math.floor(Math.log10(x)); return [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map(k => k * p).find(k => k >= x - 1e-9); }
  function niceStep(span, n){ const raw = span / n, p = 10 ** Math.floor(Math.log10(raw)); return [1, 2, 2.5, 5, 10].map(k => k * p).find(k => k >= raw); }
  // Keep only ticks whose labels don't overlap; 0 first, then by size of the value.
  function thinTicks(ticks, X, label, size = 12, pad = 10){
    const order = [...ticks].sort((a, b) => (a === 0 ? -1 : b === 0 ? 1 : Math.abs(b) - Math.abs(a))), kept = [];
    for(const t of order){ const w = textW(label(t), size), b = {x: X(t) - w / 2 - pad / 2, w: w + pad};
      if(kept.every(k => b.x + b.w <= k.b.x || k.b.x + k.b.w <= b.x)) kept.push({t, b}); }
    return kept.map(k => k.t).sort((a, b) => a - b);
  }

  // Beeswarm: vertical offsets so circles with centres xs and minimum centre distance D don't overlap.
  function swarm(xs, D){
    const idx = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]), ys = [], done = [];
    for(const i of idx){
      const iv = [];
      for(const j of done){ const dx = Math.abs(xs[i] - xs[j]); if(dx < D){ const h = Math.sqrt(D * D - dx * dx); iv.push([ys[j] - h, ys[j] + h]); } }
      const cands = [0, ...iv.flat()].sort((a, b) => Math.abs(a) - Math.abs(b) || a - b);
      ys[i] = cands.find(y => iv.every(([a, b]) => y <= a + 1e-6 || y >= b - 1e-6));
      done.push(i);
    }
    return ys;
  }

  // Slope chart. series: [{label, vals: [..], colour, strong, key}]; years: [..]; fmt: value -> text.
  // Values at the first and last year are written at the line ends; names sit at the right.
  function slope(svg, {years, series, fmt, w, sel}){
    series = series.filter(s => s.vals[s.vals.length - 1] != null);
    const last = s => s.vals[s.vals.length - 1];
    const right = Math.min(190, Math.max(...series.map(s => textW(s.label, 13, 700) + textW(fmt(last(s)), 13, 400))) + 22);
    const left = Math.max(30, ...series.filter(s => s.vals[0] != null).map(s => textW(fmt(s.vals[0]), 13))) + 12;
    const rowGap = 17, top = 28, n = series.length;
    const vals = series.flatMap(s => s.vals.filter(v => v != null)), lo0 = Math.min(...vals), hi0 = Math.max(...vals);
    const h = Math.max(150, Math.min(300, n * rowGap * 1.6 + 60)), bottom = h - 12;
    const span = Math.max(hi0 - lo0, 4), lo = lo0 - span * 0.08, hi = hi0 + span * 0.08;
    const Y = v => bottom - (v - lo) / (hi - lo) * (bottom - top), x0 = left, x1 = w - right;
    const X = i => x0 + i * (x1 - x0) / (years.length - 1);
    const endY = spread(series.map(s => Y(last(s))), rowGap, top + 4, bottom);
    const firsts = series.map((s, i) => i).filter(i => series[i].vals[0] != null), fy = spread(firsts.map(i => Y(series[i].vals[0])), rowGap, top + 4, bottom);
    const startY = []; firsts.forEach((i, k) => startY[i] = fy[k]);   // only parties on the first year's ballot get a label there
    let g = years.map((y, i) => `<line x1="${X(i)}" x2="${X(i)}" y1="${top - 6}" y2="${bottom + 4}" stroke="${C.grid}"/><text x="${X(i)}" y="${top - 12}" text-anchor="middle" class="ch-ax" font-weight="600">${y}</text>`).join("");
    const order = series.map((s, i) => i).sort((a, b) => (series[a].strong || series[a].key === sel ? 1 : 0) - (series[b].strong || series[b].key === sel ? 1 : 0));
    for(const i of order){
      const s = series[i], on = s.key && s.key === sel, wdt = on ? 3.5 : s.strong ? 2.75 : 2;
      const pts = s.vals.map((v, k) => v == null ? null : [X(k), Y(v)]);
      const segs = []; pts.forEach((p, k) => { if(p && pts[k - 1]) segs.push([pts[k - 1], p]); });   // no line across a year the party wasn't on the ballot
      g += `<g class="ch-slope${s.key ? " ch-hot" : ""}"${s.key ? ` data-key="${esc(s.key)}"` : ""}>${segs.map(([a, b]) => `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${s.colour}" stroke-width="${wdt}" stroke-linecap="round"/>`).join("")}
        ${pts.filter(Boolean).map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="${on ? 5 : 4}" fill="${s.colour}" stroke="${C.paper}" stroke-width="2"/>`).join("")}
        <text x="${x1 + 10}" y="${endY[i] + 4.5}"><tspan font-weight="${on || s.strong ? 700 : 600}">${esc(s.label)}</tspan> ${fmt(last(s))}</text>
        ${s.vals[0] != null ? `<text x="${x0 - 8}" y="${startY[i] + 4.5}" text-anchor="end" class="ch-muted">${fmt(s.vals[0])}</text>` : ""}
        ${s.key ? `<rect x="0" y="${Math.min(startY[i], endY[i]) - 10}" width="${w}" height="${Math.abs(endY[i] - startY[i]) + 20}" fill="transparent"/>` : ""}</g>`;
    }
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.innerHTML = g;
  }

  // Arrow rows: one row per item, from its earlier value (open circle) to its 2026 value (arrow head),
  // on one axis. rows: [{label, a, b, key}]. The name and both values sit at the left; the change at the right.
  function arrows(svg, {rows, w, fmt, fmtD, sel, years}){
    const rh = 44, top = 30, labW = Math.min(w * 0.42, Math.max(...rows.map(r => Math.max(textW(r.label, 14, 600), textW(`${fmt(r.a)} → ${fmt(r.b)}`, 12)))) + 14);
    const dW = Math.max(...rows.map(r => textW(fmtD(r.b - r.a), 13, 700))) + 12;
    const vals = rows.flatMap(r => [r.a, r.b]), step = niceStep(Math.max(...vals) - Math.min(...vals), w < 420 ? 2 : 4);
    const lo = Math.floor(Math.min(...vals) / step) * step, hi = Math.ceil(Math.max(...vals) / step) * step;
    const x0 = labW + 10, x1 = w - dW - 10, X = v => x0 + (v - lo) / ((hi - lo) || 1) * (x1 - x0), h = top + rows.length * rh + 2;
    const ticks = []; for(let t = lo; t <= hi + 1e-9; t += step) ticks.push(+t.toFixed(6));
    let g = ticks.map(t => `<line x1="${X(t)}" x2="${X(t)}" y1="${top - 4}" y2="${h}" stroke="${C.grid}"/><text x="${X(t)}" y="${top - 10}" text-anchor="middle" class="ch-ax">${fmt(t).replace(".0%", "%")}</text>`).join("");
    g += `<g class="ch-ax"><circle cx="5" cy="${top - 14}" r="4" fill="${C.paper}" stroke="${C.mute}" stroke-width="1.5"/><text x="13" y="${top - 10}" class="ch-ax">${years[0]}</text>
      <path d="M${textW(years[0], 12) + 26},${top - 18} l8,4 l-8,4z" fill="${C.mute}"/><text x="${textW(years[0], 12) + 38}" y="${top - 10}" class="ch-ax">${years[1]}</text></g>`;
    rows.forEach((r, i) => {
      const y = top + i * rh + rh / 2, xa = X(r.a), xb = X(r.b), d = Math.sign(r.b - r.a), col = sideCol(r.b - r.a), on = r.key === sel, hd = 7;
      g += `<g class="ch-hot" data-key="${esc(r.key)}"><rect x="0" y="${y - rh / 2}" width="${w}" height="${rh}" fill="${on ? "#eee7d8" : "transparent"}"/>
        <line x1="0" x2="${w}" y1="${y + rh / 2}" y2="${y + rh / 2}" stroke="#d9dfe5"/>
        <text x="0" y="${y - 3}" font-size="14" font-weight="${on ? 700 : 600}">${esc(r.label)}</text><text x="0" y="${y + 13}" class="ch-ax">${fmt(r.a)} → ${fmt(r.b)}</text>
        ${Math.abs(xb - xa) > hd + 1 ? `<line x1="${xa}" x2="${xb - d * hd}" y1="${y}" y2="${y}" stroke="${col}" stroke-width="2.5"/>` : ""}
        <circle cx="${xa}" cy="${y}" r="4.5" fill="${C.paper}" stroke="${col}" stroke-width="2"/>
        ${d ? `<path d="M${xb},${y} l${-d * hd},-5 v10z" fill="${col}" stroke="${C.paper}" stroke-width="1" stroke-linejoin="round"/>` : `<circle cx="${xb}" cy="${y}" r="3" fill="${col}"/>`}
        <text x="${w}" y="${y + 5}" text-anchor="end" font-weight="700" fill="${sideInk(r.b - r.a)}">${fmtD(r.b - r.a)}</text></g>`;
    });
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.innerHTML = g;
  }

  window.Charts = {arrows, C, sideCol, sideInk, textW, placeLabels, labelSVG, spread, tip, stretch, decades, niceUp, niceStep, thinTicks, swarm, slope, esc};
})();
