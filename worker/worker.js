// Checks the IEC's published LGE 2026 results on a schedule (and when a visitor presses Refresh),
// keeps every new count in KV, and serves it to the dashboard. Mirrors scripts/update.py.
const BASE = "https://results.elections.org.za/dashboards/lge/MapsJason/2026/";
const EEID = "EEID1887";
const MIN_GAP_MS = 60_000; // visitor refreshes hit the IEC at most once a minute
const UA = { "User-Agent": "lge2026-results-dashboard (calerio.github.io/lge-2026-results)" };
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };

const SHORT = {
  "AFRICAN NATIONAL CONGRESS": "ANC", "DEMOCRATIC ALLIANCE": "DA", "UMKHONTO WESIZWE PARTY": "MK",
  "ECONOMIC FREEDOM FIGHTERS": "EFF", "INKATHA FREEDOM PARTY": "IFP", "PATRIOTIC ALLIANCE": "PA",
  "ACTIONSA": "ActionSA", "VRYHEIDSFRONT PLUS | FREEDOM FRONT PLUS": "FF+", "SOUTH AFRICAN COMMUNIST PARTY": "SACP",
  "OTHER": "Other", "IND": "Independent", "UNITED DEMOCRATIC MOVEMENT": "UDM", "AFRICAN CHRISTIAN DEMOCRATIC PARTY": "ACDP",
  "GOOD": "GOOD", "AL JAMA-AH": "Al Jama-ah", "BUILD ONE SOUTH AFRICA": "BOSA", "RISE MZANSI": "Rise Mzansi",
  "CAPE COLOURED CONGRESS": "CCC", "NATIONAL COLOURED CONGRESS": "NCC",
};
const short = n => SHORT[n] || n.replace(/\|/g, " ").split(/\s+/).filter(w => /^[A-Za-z]+$/.test(w) && !["OF", "THE", "AND", "FOR"].includes(w)).map(w => w[0]).join("").slice(0, 6) || n.slice(0, 6);
const titleCase = s => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

const progress = o => ({ vd: o.VDsComplete || 0, vdTotal: o.VDExpected || 0, councilsDone: o.MuncipalitiesComplete || 0,
  councilsTotal: o.MunicExpected || 0, hung: o.HungCouncils || 0, majority: o.MajorityCouncils || 0,
  seats: o.SeatsComplete || 0, seatsTotal: o.SeatsExpected || 0, registered: o.RegPop || 0, reportDate: o.ReportDate });
const parties = l => l.map(p => ({ id: p.ID, name: titleCase(p.Name), short: short(p.Name), pct: p.PercOfVotes, votes: p.TotalValidVotes,
  seats: p.TotalSeatsWon || 0, councils: p.CouncilsWon || 0, majorities: p.MajorityWon || 0 }))
  .sort((a, b) => (a.short === "Other") - (b.short === "Other") || b.pct - a.pct);
const cast = l => { const p = l[0] || {}; return { cast: p.TotalVotesCast || 0, valid: p.ValidVotesCast || 0, spoilt: p.SpoiltVotes || 0, registered: p.RegisteredVoters || 0 }; };

function summarise(nat) {
  const s = { reportDate: nat.ReportDate, fetchedAt: new Date().toISOString(),
    national: { ...progress(nat), ...cast(nat.PartyBallotResults), parties: parties(nat.PartyBallotResults) }, provinces: [], munics: {} };
  for (const pr of nat.ProvinceResults) {
    s.provinces.push({ id: pr.ProvinceID, name: pr.Province, ...progress(pr), parties: parties(pr.PartyBallotResults) });
    for (const m of pr.MunicipalityResults) {
      const ps = parties(m.PartyBallotResults), [code, ...rest] = m.Municipality.split(" - ");
      const w = m.PartyBallotResults.find(p => p.IsCouncilWinner);
      s.munics[m.MunicipalityID] = { code, name: rest.join(" - ") || code, prov: pr.Province, vdPct: m.Perc_VDsComplete || 0,
        vd: m.VDsComplete || 0, vdTotal: m.VDExpected || 0, seats: m.SeatsComplete || 0, seatsTotal: m.SeatsExpected || 0,
        done: (m.MuncipalitiesComplete || 0) > 0, hung: (m.HungCouncils || 0) > 0, winner: w ? short(w.Name) : null,
        parties: ps.filter(p => p.short !== "Other").slice(0, 4).map(p => [p.short, p.pct, p.seats]), reportDate: m.ReportDate };
    }
  }
  return s;
}

// The national file lists only the leader for most municipalities; the province files list the top three.
async function provinceParties(provIds) {
  const out = {};
  await Promise.all(provIds.map(async id => {
    try {
      const r = await fetch(`${BASE}${EEID}Province${id}.js?rnd=${Date.now()}`, { headers: UA, cf: { cacheTtl: 0 } });
      if (!r.ok) return;
      const d = JSON.parse((await r.text()).replace(/^\uFEFF/, ""));
      for (const m of d.MunicipalityResults || []) out[m.MunicipalityID] = parties(m.PartyBallotResults || []);
    } catch (e) {}
  }));
  return out;
}

async function check(env, source) {
  const r = await fetch(`${BASE}${EEID}LiteMapsNational.js?rnd=${Date.now()}`, { headers: UA, cf: { cacheTtl: 0 } });
  if (!r.ok) throw new Error("IEC " + r.status);
  const nat = JSON.parse((await r.text()).replace(/^﻿/, ""));
  // KV free tier = 1000 writes/day. Budget: check time every 15 min (96) + 3 writes per new IEC count.
  if (source === "schedule" && new Date().getMinutes() % 15 < 5) await env.LGE.put("lastCheck", String(Date.now()));
  const idx = JSON.parse(await env.LGE.get("index") || "[]");
  const prev = JSON.parse(await env.LGE.get("latest") || "null");
  const indexed = idx.some(i => i.reportDate === nat.ReportDate);
  if (prev && prev.reportDate === nat.ReportDate && (source !== "schedule" || indexed)) return { changed: false, reportDate: nat.ReportDate };
  const s = summarise(nat);
  const extra = await provinceParties(nat.ProvinceResults.map(p => p.ProvinceID));
  for (const [id, ps] of Object.entries(extra)) if (s.munics[id] && ps.length > s.munics[id].parties.length)
    s.munics[id].parties = ps.filter(p => p.short !== "Other").slice(0, 4).map(p => [p.short, p.pct, p.seats]);
  const stamp = s.reportDate.slice(0, 19).replace(/[-:]/g, "");
  const hist = { ...s, munics: Object.fromEntries(Object.entries(s.munics).map(([k, m]) =>
    [k, [m.parties[0]?.[0] ?? null, m.parties[0]?.[1] ?? 0, m.vdPct]])) };
  if (source === "schedule" && !idx.some(i => i.reportDate === s.reportDate)) idx.push({ file: `${stamp}.json`, reportDate: s.reportDate,
    vdPct: Math.round(1000 * s.national.vd / Math.max(s.national.vdTotal, 1)) / 10,
    parties: Object.fromEntries(s.national.parties.slice(0, 8).map(p => [p.short, p.pct])), via: source });
  const writes = [env.LGE.put("latest", JSON.stringify(s)), env.LGE.put(`h:${stamp}.json`, JSON.stringify(hist))];
  if (source === "schedule") {
    // fold in counts a visitor refresh stored since the last run (they write only latest + h:<stamp>)
    const listed = await env.LGE.list({ prefix: "h:" });
    for (const k of listed.keys) {
      const file = k.name.slice(2);
      if (file === `${stamp}.json` || idx.some(i => i.file === file)) continue;
      const h = JSON.parse(await env.LGE.get(k.name) || "null"); if (!h) continue;
      idx.push({ file, reportDate: h.reportDate, vdPct: Math.round(1000 * h.national.vd / Math.max(h.national.vdTotal, 1)) / 10,
        parties: Object.fromEntries(h.national.parties.slice(0, 8).map(p => [p.short, p.pct])), via: "visitor" });
    }
    idx.sort((a, b) => a.reportDate.localeCompare(b.reportDate));
    writes.push(env.LGE.put("index", JSON.stringify(idx)));
  }
  await Promise.all(writes);
  return { changed: true, reportDate: s.reportDate };
}

const json = (body, extra = {}) => new Response(typeof body === "string" ? body : JSON.stringify(body),
  { headers: { "Content-Type": "application/json", ...CORS, ...extra } });

// Visit counter: one Durable Object holds totals in SQLite. Visitors are identified only by a
// salted hash of IP + browser + date, so nothing personal is stored and it resets daily.
import { DurableObject } from "cloudflare:workers";
export class Counter extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS days (day TEXT PRIMARY KEY, views INTEGER, uniques INTEGER)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS seen (day TEXT, h TEXT, PRIMARY KEY (day, h))");
  }
  hit(day, h) {
    const fresh = this.sql.exec("INSERT OR IGNORE INTO seen (day, h) VALUES (?, ?)", day, h).rowsWritten > 0;
    this.sql.exec(`INSERT INTO days (day, views, uniques) VALUES (?, 1, ?)
      ON CONFLICT(day) DO UPDATE SET views = views + 1, uniques = uniques + ?`, day, fresh ? 1 : 0, fresh ? 1 : 0);
    this.sql.exec("DELETE FROM seen WHERE day < ?", day);   // only today's hashes are kept
  }
  stats() {
    const days = this.sql.exec("SELECT day, views, uniques FROM days ORDER BY day").toArray();
    return { days, totalViews: days.reduce((t, d) => t + d.views, 0) };
  }
}

async function visitorHash(req, day) {
  const raw = `${req.headers.get("CF-Connecting-IP")}|${req.headers.get("User-Agent")}|${day}|lge2026`;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return [...new Uint8Array(buf).slice(0, 12)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export default {
  async scheduled(_, env, ctx) { ctx.waitUntil(check(env, "schedule")); },

  async fetch(req, env, ctx) {
    const url = new URL(req.url), p = url.pathname;
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    // Busy-day protection: latest/index are cached at the edge for 20 s, so a crowd of visitors
    // costs a couple of KV reads per minute per data centre instead of one per page view.
    if (p === "/api/latest" || p === "/api/index") {
      const key = new Request("https://lge2026.internal" + p), cache = caches.default;
      if (url.searchParams.get("fresh") !== "1") { const hit = await cache.match(key); if (hit) return hit; }
      const body = p === "/api/latest" ? await env.LGE.get("latest") || "null" : await env.LGE.get("index") || "[]";
      const extra = p === "/api/latest" ? { "X-Last-Check": new Date(+(await env.LGE.get("lastCheck") || 0)).toISOString(),
        "Access-Control-Expose-Headers": "X-Last-Check" } : {};
      const res = json(body, { "Cache-Control": "public, max-age=20", ...extra });
      ctx.waitUntil(cache.put(key, res.clone()));
      return res;
    }
    let m = p.match(/^\/api\/history\/(\d{8}T\d{6}\.json)$/);
    if (m) { const v = await env.LGE.get("h:" + m[1]); return v ? json(v, { "Cache-Control": "public, max-age=86400" }) : json({ error: "not found" }); }
    if (p === "/api/hit" && req.method === "POST") {
      const day = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);   // SAST date
      const stub = env.COUNTER.get(env.COUNTER.idFromName("site"));
      ctx.waitUntil(visitorHash(req, day).then(h => stub.hit(day, h)));
      return new Response(null, { status: 204, headers: CORS });
    }
    if (p === "/api/stats") return json(await env.COUNTER.get(env.COUNTER.idFromName("site")).stats(), { "Cache-Control": "no-store" });
    if (p === "/api/refresh" && req.method === "POST") {
      const gate = new Request("https://lge2026.internal/refresh-gate"), cache = caches.default;
      if (await cache.match(gate)) return json({ checked: false, reason: "checked under a minute ago" });
      ctx.waitUntil(cache.put(gate, new Response("1", { headers: { "Cache-Control": `max-age=${MIN_GAP_MS / 1000}` } })));
      try { return json({ checked: true, ...(await check(env, "visitor")) }); }
      catch (e) { return json({ checked: false, reason: String(e.message || e) }); }
    }
    m = p.match(/^\/api\/wards\/(\d{3,5})$/);
    if (m) { // pass the IEC's municipality file straight through (compressed, cached at the edge for a minute)
      const r = await fetch(`${BASE}${EEID}Munic${m[1]}.js`, { headers: UA, cf: { cacheTtl: 60, cacheEverything: true } });
      return new Response(r.body, { status: r.status, headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60", ...CORS } });
    }
    return json({ ok: true, endpoints: ["/api/latest", "/api/index", "/api/history/<file>", "POST /api/refresh", "/api/wards/<MunicId>"] });
  },
};
