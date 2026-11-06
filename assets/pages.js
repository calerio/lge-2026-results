// Bootstrap shared by shift.html, explore.html and votes.html: navigation, the data-basis line,
// and (with ?check in the URL) a self-test of the archive and core calculations.
(async function(){
  const L = window.LGE, page = document.body.dataset.page;
  L.renderNav(document.getElementById("pagenav"), page);
  let now;
  try{
    now = await L.snapshot(2026);
    document.getElementById("basis").textContent = L.statusLine(now.manifest);
  }catch(e){ document.getElementById("basis").textContent = "Results data isn't available right now."; return; }
  if(!new URLSearchParams(location.search).has("check")) return;

  // ---- self-test: national DA share on the PR ballot, 2026 vs 2021, and ward comparability ----
  const then = await L.snapshot(2021);
  const [m26, m21] = await Promise.all([now.municipalities(), then.municipalities()]);
  const da26 = L.pooledShare(m26, L.DA), da21 = L.pooledShare(m21, L.DA);
  const code = await L.pinnedCode();
  const [w26, w21] = await Promise.all([now.municipality(code), then.municipality(code)]);
  let comparable = 0, total = 0;
  for(const w of Object.values(w26.wards)){ total++; if(L.wardBaseline(w, w21).comparable) comparable++; }
  const rows = [
    ["Snapshot", `${now.manifest.snapshot} · ${now.manifest.vds.toLocaleString()} districts in the file`],
    ["DA, PR ballot, all municipalities", `${L.fmtPct(da26, 2)} in 2026 vs ${L.fmtPct(da21, 2)} in 2021 (${L.fmtPP(da26 - da21, 2)})`],
    [`Wards in ${w26.name} comparable with 2021`, `${comparable} of ${total}`],
  ];
  document.getElementById("page").insertAdjacentHTML("beforeend", `<section class="card pg-check"><h2>Data check</h2>
    <table>${rows.map(r => `<tr><th>${r[0]}</th><td>${r[1]}</td></tr>`).join("")}</table></section>`);
})();
