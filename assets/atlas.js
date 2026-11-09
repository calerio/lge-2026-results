// Shared map for the post-election pages: MapLibre with no basemap, official IEC 2026 municipal and
// ward boundaries, province outlines, and an SVG layer on top for arrows and circles.
// The map starts locked (the page scrolls normally); "Explore map" unlocks pan and zoom. Clicking a
// place works either way.
(function(){
  const SA = [[16.3, -35], [33, -22]];
  const MAPLIBRE = "https://unpkg.com/maplibre-gl@5.6.0/dist/maplibre-gl.js";
  let libReady = null;
  function loadLib(){
    if(!libReady) libReady = new Promise((ok, no) => {
      if(window.maplibregl) return ok();
      const c = document.createElement("link"); c.rel = "stylesheet"; c.href = MAPLIBRE.replace(/\.js$/, ".css"); document.head.appendChild(c);
      const s = document.createElement("script"); s.src = MAPLIBRE; s.onload = ok; s.onerror = no; document.head.appendChild(s);
    });
    return libReady;
  }

  // A point inside a polygon: the centroid if it falls inside, else the middle of the widest
  // horizontal run through the shape's middle (no estimation of results, only where to draw).
  function inside(pt, ring){
    let c = false;
    for(let i = 0, j = ring.length - 1; i < ring.length; j = i++){
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  function inPoly(pt, poly){ return inside(pt, poly[0]) && !poly.slice(1).some(h => inside(pt, h)); }
  function pointOnSurface(geom){
    const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
    let best = null, bestA = -1;
    for(const p of polys){ const r = p[0]; let a = 0;
      for(let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
      if(Math.abs(a) > bestA){ bestA = Math.abs(a); best = p; } }
    const r = best[0]; let cx = 0, cy = 0; r.forEach(q => { cx += q[0]; cy += q[1]; }); cx /= r.length; cy /= r.length;
    if(inPoly([cx, cy], best)) return [cx, cy];
    const ys = r.map(q => q[1]), y = (Math.min(...ys) + Math.max(...ys)) / 2, xs = [];
    for(const ring of best) for(let i = 0, j = ring.length - 1; i < ring.length; j = i++){
      const [x1, y1] = ring[j], [x2, y2] = ring[i];
      if((y1 > y) !== (y2 > y)) xs.push(x1 + (y - y1) * (x2 - x1) / (y2 - y1));
    }
    xs.sort((a, b) => a - b); let w = -1, mid = [cx, cy];
    for(let i = 0; i + 1 < xs.length; i += 2) if(xs[i + 1] - xs[i] > w){ w = xs[i + 1] - xs[i]; mid = [(xs[i] + xs[i + 1]) / 2, y]; }
    return mid;
  }
  function bboxOf(features){
    let a = [180, 90, -180, -90];
    const walk = c => typeof c[0] === "number" ? (a = [Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.max(a[2], c[0]), Math.max(a[3], c[1])]) : c.forEach(walk);
    features.forEach(f => walk(f.geometry.coordinates));
    return [[a[0], a[1]], [a[2], a[3]]];
  }

  // opts: {container, onClick(kind, props, lngLat), onHover(kind, props, point) , onLeave(), draw(svg, project)}
  async function create(opts){
    const el = opts.container;
    el.classList.add("atlas");
    el.innerHTML = `<div class="atlas-map"></div><svg class="atlas-svg" aria-hidden="true"></svg>
      <div class="atlas-tip" hidden></div>
      <div class="atlas-ctrl"><button type="button" class="atlas-unlock">Explore map</button><button type="button" class="atlas-recentre">Recentre</button></div>
      <p class="atlas-loading">${opts.loadingText || "Loading map…"}</p>`;
    const [_, munics, provs] = await Promise.all([loadLib(), LGE.json("geo/munics.json"), LGE.json("geo/provinces.json")]);
    munics.features.forEach(f => f.id = f.properties.MunicId);
    const map = new maplibregl.Map({container: el.querySelector(".atlas-map"),
      style: {version: 8, sources: {}, layers: [{id: "bg", type: "background", paint: {"background-color": "#fafbfc"}}]},
      bounds: SA, fitBoundsOptions: {padding: 16}, maxBounds: [[8, -42], [42, -15]], minZoom: 3,
      dragRotate: false, attributionControl: false, dragPan: false, scrollZoom: false, doubleClickZoom: false,
      touchZoomRotate: false, keyboard: false, boxZoom: false});
    const svg = el.querySelector(".atlas-svg"), tip = el.querySelector(".atlas-tip");
    let locked = true, extent = SA, wardFeatures = [];
    const unlockBtn = el.querySelector(".atlas-unlock");
    function setLocked(v){
      locked = v;
      ["dragPan", "scrollZoom", "doubleClickZoom", "touchZoomRotate", "keyboard"].forEach(h => v ? map[h].disable() : map[h].enable());
      if(!v) map.touchZoomRotate.disableRotation();
      unlockBtn.textContent = v ? "Explore map" : "Lock map";
      unlockBtn.setAttribute("aria-pressed", String(!v));
    }
    unlockBtn.onclick = () => setLocked(!locked);
    const fit = (b, pad = 24) => map.fitBounds(b, {padding: pad, duration: LGE.prefersReduced() ? 0 : 600});
    el.querySelector(".atlas-recentre").onclick = () => fit(extent);

    await new Promise(r => map.on("load", r));
    el.querySelector(".atlas-loading").remove();
    map.addSource("mun", {type: "geojson", data: munics});
    map.addLayer({id: "mun-fill", type: "fill", source: "mun", paint: {"fill-color": ["coalesce", ["feature-state", "c"], "#f1f3f5"]}});
    map.addLayer({id: "mun-line", type: "line", source: "mun", paint: {"line-color": "#c3cad1", "line-width": 0.35}});
    map.addSource("prov", {type: "geojson", data: provs});
    map.addLayer({id: "prov-line", type: "line", source: "prov", paint: {"line-color": "#8a96a3", "line-width": 0.8}});
    map.addSource("ward", {type: "geojson", data: {type: "FeatureCollection", features: []}});
    map.addLayer({id: "ward-fill", type: "fill", source: "ward", paint: {"fill-color": ["coalesce", ["feature-state", "c"], "#f1f3f5"]}});
    map.addLayer({id: "ward-line", type: "line", source: "ward", paint: {"line-color": "#9aa5b0", "line-width": 0.5}});
    map.addLayer({id: "mun-sel", type: "line", source: "mun", paint: {"line-color": "#17212b", "line-width": 2}, filter: ["==", ["id"], -1]});
    map.addLayer({id: "ward-sel", type: "line", source: "ward", paint: {"line-color": "#17212b", "line-width": 2}, filter: ["==", ["get", "WardId"], -1]});

    const project = ll => { const p = map.project(ll); return [p.x, p.y]; };
    const redraw = () => { if(opts.draw) svg.innerHTML = opts.draw(project, map.getZoom()); };
    map.on("move", redraw); map.on("resize", redraw);

    function showTip(html, pt){
      tip.innerHTML = html; tip.hidden = false;
      const W = el.clientWidth, H = el.clientHeight, w = tip.offsetWidth, h = tip.offsetHeight;
      let x = pt.x + 14, y = pt.y + 14;
      if(x + w > W - 8) x = pt.x - w - 14; if(y + h > H - 8) y = pt.y - h - 14;
      tip.style.left = Math.max(8, x) + "px"; tip.style.top = Math.max(8, y) + "px";
    }
    const hideTip = () => { tip.hidden = true; };
    for(const [layer, kind] of [["ward-fill", "ward"], ["mun-fill", "munic"]]){
      map.on("mousemove", layer, e => {
        if(kind === "munic" && map.queryRenderedFeatures(e.point, {layers: ["ward-fill"]}).length) return;
        map.getCanvas().style.cursor = "pointer";
        const html = opts.hover && opts.hover(kind, e.features[0].properties);
        html ? showTip(html, e.point) : hideTip();
      });
      map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; hideTip(); });
      map.on("click", layer, e => {
        if(kind === "munic" && map.queryRenderedFeatures(e.point, {layers: ["ward-fill"]}).length) return;
        hideTip(); opts.onClick && opts.onClick(kind, e.features[0].properties);
      });
    }

    const byCode = {}; munics.features.forEach(f => byCode[f.properties.MunicCode] = f);
    const api = {
      map, munics, byCode, redraw, setLocked, pointOnSurface,
      // colours: {MunicCode: "#hex"}
      paintMunics(colours){ munics.features.forEach(f => map.setFeatureState({source: "mun", id: f.id}, {c: colours[f.properties.MunicCode] || null})); },
      paintWards(colours){ wardFeatures.forEach(f => map.setFeatureState({source: "ward", id: f.id}, {c: colours[String(f.properties.WardId)] || null})); },
      select(code){ map.setFilter("mun-sel", ["==", ["id"], code && byCode[code] ? byCode[code].id : -1]); },
      selectWard(id){ map.setFilter("ward-sel", ["==", ["get", "WardId"], id ? +id : -1]); },
      async showWards(code){
        const f = byCode[code]; if(!f) return [];
        const g = await LGE.json(`geo/wards/${f.properties.MunicId}.json`);
        g.features.forEach(w => { w.id = w.properties.WardId; if(!w.properties.pt) w.properties.pt = pointOnSurface(w.geometry); });
        wardFeatures = g.features;
        map.getSource("ward").setData({type: "FeatureCollection", features: wardFeatures.map(w => ({...w, properties: {MunicId: w.properties.MunicId, WardId: w.properties.WardId, WardNo: w.properties.WardNo}}))});
        return wardFeatures;
      },
      clearWards(){ wardFeatures = []; map.getSource("ward").setData({type: "FeatureCollection", features: []}); },
      wards: () => wardFeatures,
      zoomTo(code){ const f = byCode[code]; if(f){ extent = bboxOf([f]); fit(extent); } },
      zoomToProvince(name){ const fs = munics.features.filter(f => f.properties.Province === name); if(fs.length){ extent = bboxOf(fs); fit(extent); } },
      zoomToSA(){ extent = SA; fit(SA, 16); },
      hideTip,
    };
    redraw();
    return api;
  }

  window.Atlas = {create, pointOnSurface};
})();
