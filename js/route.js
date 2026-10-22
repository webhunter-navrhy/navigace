// Výpočet tras: několik kandidátů paralelně (Valhalla + alternativy z OSRM), pak vlastní model reálného času
// (limity, zatáčky, úsekové měření a radary, živé zácpy NDIC, uzavírky) a řazení podle zvolené priority.
import { decodePolyline, encodePolyline, cumDist, project, dist, bearing, angDiff, flat, segProj, Grid, pointAt } from './geo.js';
import { db } from './data.js';
import { traffic } from './traffic.js';
import { profile, buildNotes, funMeters } from './pacenotes.js';

const VALHALLA = 'https://valhalla1.openstreetmap.de';
const OSRM = 'https://routing.openstreetmap.de/routed-car/route/v1/driving/';

// --- fronta požadavků (veřejný server, max 3 souběžně, opakování při 429/5xx) ---
let active = 0; const waiting = [];
async function slot(fn) {
  if (active >= 5) await new Promise(r => waiting.push(r));
  active++;
  try { return await fn(); } finally { active--; const n = waiting.shift(); n && n(); }
}
async function post(path, body, signal, tries = 3) {
  return slot(async () => {
    for (let k = 0; ; k++) {
      const r = await fetch(VALHALLA + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
      if (r.ok) return r.json();
      if (k >= tries - 1 || ![429, 500, 502, 503, 504].includes(r.status)) {
        let msg = r.status;
        try { msg = (await r.json()).error || msg; } catch { }
        throw new Error('Valhalla: ' + msg);
      }
      await new Promise(res => setTimeout(res, 400 * (k + 1)));
    }
  });
}

// --- požadavek na trasu ---
export function costing(prefs = {}, extra = {}) {
  const auto = {
    use_highways: prefs.avoidHighways ? 0 : 1, use_tolls: prefs.avoidHighways ? 0 : 1,
    use_tracks: 0, use_living_streets: 0.1, use_ferry: 0.2, ...extra,
  };
  return { costing: 'auto', costing_options: { auto } };
}

export async function valhallaRoute(locs, opts = {}, signal) {
  const body = {
    locations: locs.map((l, i) => ({
      lat: l[1], lon: l[0], type: l.type || (i === 0 || i === locs.length - 1 ? 'break' : 'break'),
      ...(l.heading != null ? { heading: Math.round(l.heading), heading_tolerance: 60 } : {}),
      ...(i === 0 ? { radius: 30 } : {}),
    })),
    ...costing(opts.prefs, opts.auto),
    language: 'cs-CZ', units: 'kilometers', directions_type: 'instructions',
    ...(opts.exclude && opts.exclude.length ? { exclude_polygons: opts.exclude } : {}),
  };
  const j = await post('/route', body, signal);
  return parseTrip(j.trip, opts.label);
}

function parseTrip(trip, label) {
  const coords = [], maneuvers = [];
  for (const leg of trip.legs) {
    const shape = decodePolyline(leg.shape, 6);
    const off = coords.length ? coords.length - 1 : 0;
    if (coords.length) shape.shift();
    coords.push(...shape);
    for (const m of leg.maneuvers) {
      if (coords.length > shape.length && m.type === 1) continue; // start dalšího úseku
      maneuvers.push({
        type: m.type, text: m.instruction, alert: m.verbal_transition_alert_instruction || m.verbal_pre_transition_instruction || m.instruction,
        pre: m.verbal_pre_transition_instruction || m.instruction, post: m.verbal_post_transition_instruction || '',
        street: (m.street_names || m.begin_street_names || []).join(' / '), idx: off + m.begin_shape_index, len: m.length * 1000,
        exit: m.roundabout_exit_count || 0, sign: m.sign || null, highway: !!m.highway,
      });
    }
  }
  const cum = cumDist(coords);
  for (const m of maneuvers) m.s = cum[Math.min(m.idx, cum.length - 1)];
  return { label, coords, cum, maneuvers, length: cum[cum.length - 1], vTime: trip.summary.time, hasHighway: !!trip.summary.has_highway, legs: trip.legs.length };
}

// --- atributy hran (limity, třída silnice, hustota zástavby) ---
async function attributes(route, signal) {
  const body = {
    encoded_polyline: encodePolyline(route.coords, 6), costing: 'auto', shape_match: 'edge_walk',
    filters: { attributes: ['edge.speed_limit', 'edge.road_class', 'edge.length', 'edge.begin_shape_index', 'edge.end_shape_index', 'edge.density', 'edge.speed', 'edge.use', 'edge.names', 'edge.toll'], action: 'include' },
  };
  let j;
  try { j = await post('/trace_attributes', body, signal, 2); }
  catch (e) { if (e.name === 'AbortError') throw e; body.shape_match = 'map_snap'; j = await post('/trace_attributes', body, signal, 2); }
  return j.edges || [];
}

// výchozí limity v ČR podle třídy silnice, když OSM limit nezná
function defaultLimit(cls, urban, vEst, use) {
  if (use === 'living_street') return 20;
  if (cls === 'motorway') return 130;
  if (cls === 'trunk') return urban ? 50 : vEst >= 95 ? 110 : 90;
  if (cls === 'service_other') return urban ? 30 : 50;
  if (cls === 'residential') return urban ? 50 : 70;
  return urban ? 50 : 90;
}

// --- hlavní analýza trasy ---
export function analyze(route, edges, prefs = {}) {
  const n = route.coords.length, segs = n - 1;
  const lim = new Float32Array(segs), cls = new Array(segs).fill('unclassified'), urban = new Uint8Array(segs), vEst = new Float32Array(segs).fill(60);
  const known = new Uint8Array(segs);
  if (edges && edges.length) {
    let fallbackIdx = 0;
    for (const e of edges) {
      let a = e.begin_shape_index, b = e.end_shape_index;
      if (a == null || b == null) { a = fallbackIdx; const L = (e.length || 0) * 1000; let s = route.cum[a]; b = a; while (b < segs && route.cum[b] - s < L) b++; }
      fallbackIdx = b;
      const u = (e.density || 0) >= 7 || (e.speed && e.speed <= 40 && e.road_class !== 'motorway');
      for (let i = a; i < Math.min(b, segs); i++) {
        cls[i] = e.road_class || 'unclassified'; urban[i] = u ? 1 : 0; vEst[i] = e.speed || 60;
        lim[i] = e.speed_limit && e.speed_limit < 200 ? e.speed_limit : defaultLimit(cls[i], u, e.speed || 60, e.use);
        known[i] = e.speed_limit ? 1 : 0;
      }
    }
  }
  for (let i = 0; i < segs; i++) if (!lim[i]) lim[i] = 70;

  const segAt = s => { let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (route.cum[m] <= s) lo = m; else hi = m; } return lo; };

  // radary a úsekové měření na trase
  const cams = [], seenCam = new Set(), { kx, ky } = flat(route.coords[0][1]);
  const near = (p, maxD, from = 0, to = n - 1) => { const r = project(route.coords, route.cum, p, from, to); return r.d <= maxD ? r : null; };
  const step = Math.max(1, Math.floor(n / 4000));
  for (let i = 0; i < n; i += Math.max(step, 6)) {
    const [lon, lat] = route.coords[i];
    for (const c of db.camGrid.near(lon, lat, 1)) {
      if (seenCam.has(c.id)) continue;
      const r = near([c.lon, c.lat], 28, Math.max(0, i - 80), i + 80);
      if (r) { seenCam.add(c.id); cams.push({ s: r.s, ms: c.ms || lim[Math.min(r.i, segs - 1)], kind: 'cam' }); }
    }
  }
  const sections = [];
  for (const sec of db.sections) {
    // rychlé předfiltrování
    const ra = near(sec.a, 45); if (!ra) continue;
    const rb = near(sec.b, 45); if (!rb || rb.s <= ra.s + 100) continue;
    sections.push({ s0: ra.s, s1: rb.s, ms: sec.ms || lim[Math.min(ra.i, segs - 1)] });
  }
  const bumps = [], seenB = new Set();
  for (let i = 0; i < n; i += Math.max(step, 4)) {
    const [lon, lat] = route.coords[i];
    for (const b of db.bumpGrid.near(lon, lat, 1)) {
      if (seenB.has(b)) continue;
      const r = near([b.lon, b.lat], 12, Math.max(0, i - 40), i + 40);
      if (r) { seenB.add(b); bumps.push({ s: r.s }); }
    }
  }
  cams.sort((a, b) => a.s - b.s); bumps.sort((a, b) => a.s - b.s);
  // dva radary pár metrů od sebe (oba směry, semafor + rychlost) hlásit jako jeden
  for (let k = cams.length - 1; k > 0; k--) if (cams[k].s - cams[k - 1].s < 120) cams.splice(k, 1);
  const enforced = new Uint8Array(segs);
  for (const c of cams) for (let i = segAt(c.s - 350); i <= segAt(c.s + 80); i++) enforced[i] = 1;
  for (const z of sections) for (let i = segAt(z.s0); i <= segAt(z.s1); i++) enforced[i] = 2;

  // živá doprava: zácpy (FCD) a události podél trasy
  const fcdV = new Float32Array(segs), evOn = new Map();
  if (traffic.fcd.length || traffic.events.length) {
    let lastS = -1e9;
    for (let i = 0; i < segs; i++) {
      const s = route.cum[i];
      if (s - lastS < 35 && i < segs - 1) continue;
      lastS = s;
      const p = route.coords[i], b = bearing(route.coords[i], route.coords[Math.min(i + 1, n - 1)]);
      let v = 0;
      for (const f of traffic.fcdGrid.near(p[0], p[1], 1)) {
        const dx = (f.p[0] - p[0]) * kx, dy = (f.p[1] - p[1]) * ky;
        if (dx * dx + dy * dy < 22 * 22 && Math.abs(angDiff(f.b, b)) < 40) v = v ? Math.min(v, f.v || 10) : (f.v || 10);
      }
      if (v) { let j = i; while (j < segs && route.cum[j] - s < 35) fcdV[j++] = v; }
      for (const e of traffic.eventGrid.near(p[0], p[1], 1)) {
        if (evOn.has(e.id) || e.kind === 'info') continue;
        let d = Infinity;
        if (e.line) { for (let k = 0; k < e.line.length - 1; k++) d = Math.min(d, segProj(p, e.line[k], e.line[k + 1], kx, ky).d); }
        else d = Math.hypot((e.lon - p[0]) * kx, (e.lat - p[1]) * ky);
        if (d < 25) evOn.set(e.id, { s, ev: e });
      }
    }
  }
  // úplná uzavírka se počítá jen tehdy, když opravdu vede po trase (ne po sjezdu nebo silnici pod mostem)
  for (const [id, x] of evOn) {
    const e = x.ev;
    if (e.kind !== 'closure' || !e.full) continue;
    let on = false;
    if (e.line && e.line.length > 1) {
      const pts = cumDist(e.line), L = pts[pts.length - 1], k = Math.max(3, Math.min(12, Math.round(L / 40)));
      let hit = 0, s0 = Infinity, s1 = -Infinity;
      for (let j = 0; j <= k; j++) {
        const q = pointAt(e.line, pts, L * j / k), r = project(route.coords, route.cum, q);
        if (r.d < 18) { hit++; s0 = Math.min(s0, r.s); s1 = Math.max(s1, r.s); }
      }
      on = hit / (k + 1) >= 0.7 && s1 - s0 >= Math.min(L * 0.6, 150);
    }
    if (!on) evOn.set(id, { ...x, ev: { ...e, full: false } });
  }
  const events = [...evOn.values()].sort((a, b) => a.s - b.s);

  // zatáčky
  const pr = profile(route.coords, route.cum);
  const turnS = route.maneuvers.filter(m => ![1, 4, 5, 6, 7, 8, 22, 25].includes(m.type)).map(m => m.s);
  const notes = buildNotes(pr, (s0, s1) => {
    const i = segAt(s0);
    if (urban[i] && urban[segAt(s1)]) return true;
    return turnS.some(t => t > s0 - 40 && t < s1 + 40);
  });
  const fun = funMeters(pr, s => { const i = segAt(s); return urban[i] || cls[i] === 'motorway' || cls[i] === 'trunk'; });

  // časový model
  const tempo = prefs.tempo || 1, aLat = prefs.sport ? 4.2 : 3.2;
  const curveV = new Float32Array(segs).fill(250);
  for (let k = 0; k < pr.n; k++) { const v = Math.sqrt(aLat * Math.min(pr.R[k], 3000)) * 3.6; const i = segAt(pr.s[k]); if (v < curveV[i]) curveV[i] = v; }
  let time = 0, timeFree = 0, motorway = 0, urbanM = 0, unknownM = 0;
  const tCum = new Float64Array(n);
  for (let i = 0; i < segs; i++) {
    const L = route.cum[i + 1] - route.cum[i];
    let t1 = enforced[i] ? Math.min(tempo, 1) : tempo;
    if (urban[i]) t1 = Math.min(t1, 1);
    let v = Math.min(lim[i] * t1, Math.max(curveV[i], 15));
    if (urban[i]) v = Math.min(v, Math.max(vEst[i] * 1.1, 18));
    const vFree = v;
    if (fcdV[i]) v = Math.min(v, Math.max(fcdV[i], 4));
    time += L / (v / 3.6); timeFree += L / (vFree / 3.6);
    tCum[i + 1] = time;
    if (cls[i] === 'motorway') motorway += L;
    if (urban[i]) urbanM += L;
    if (!known[i]) unknownM += L;
  }
  const turnPenalty = route.maneuvers.reduce((a, m) => a + ([26, 27].includes(m.type) ? 7 : [9, 10, 11, 14, 15, 16, 2, 3].includes(m.type) ? 5 : 0), 0);
  let eventDelay = 0, closures = 0;
  for (const { ev } of events) {
    if (ev.kind === 'closure' && ev.full) closures++;
    if (ev.kind === 'accident') eventDelay += 180;
    if (ev.kind === 'jam' && !fcdV.some(Boolean)) eventDelay += 300;
  }
  time += turnPenalty + eventDelay + closures * 2700;
  timeFree += turnPenalty;

  const secLen = sections.reduce((a, z) => a + z.s1 - z.s0, 0);
  return {
    lim, cls, urban, enforced, fcdV, tCum, curveV, cams, sections, bumps, events, notes, fun,
    time, timeFree, delay: Math.max(0, time - timeFree - closures * 2700), closures,
    motorwayShare: motorway / route.length, urbanShare: urbanM / route.length, limitKnown: 1 - unknownM / route.length,
    secLen, curvyKm: fun / 1000,
    funScore: Math.min(10, Math.round((fun / Math.max(route.length, 1)) * 60 * 10) / 10),
  };
}

export function score(r, priority) {
  const a = r.a;
  switch (priority) {
    case 'fun': return a.time - a.fun * 0.09 - (1 - a.urbanShare) * 120;
    case 'calm': return a.time + a.cams.length * 45 + a.secLen / 1000 * 25 + a.delay * 0.6 + a.bumps.length * 6;
    case 'short': return r.length / 13 + a.time * 0.25;
    default: return a.time + a.cams.length * 2;
  }
}

// podobnost dvou tras (podíl bodů B blíže než 30 m k A)
function overlap(A, B) {
  const g = new Grid(0.003);
  for (let i = 0; i < A.coords.length; i += 2) g.add(A.coords[i][0], A.coords[i][1], A.coords[i]);
  const { kx, ky } = flat(B.coords[0][1]);
  let hit = 0, tot = 0;
  for (let s = 0; s < B.length; s += 200) {
    const p = pointAt(B.coords, B.cum, s); tot++;
    if (g.near(p[0], p[1], 1).some(q => Math.hypot((q[0] - p[0]) * kx, (q[1] - p[1]) * ky) < 40)) hit++;
  }
  return tot ? hit / tot : 1;
}

async function osrmShapes(from, to, signal) {
  try {
    const r = await fetch(`${OSRM}${from[0]},${from[1]};${to[0]},${to[1]}?alternatives=2&overview=simplified&geometries=geojson`, { signal });
    const j = await r.json();
    return (j.routes || []).map(x => x.geometry.coordinates);
  } catch (e) { if (e.name === 'AbortError') throw e; return []; }
}

export async function enrich(route, prefs, signal) {
  let edges = null;
  try { edges = await attributes(route, signal); } catch (e) { if (e.name === 'AbortError') throw e; }
  route.edges = edges; // kvůli přepočtu, když dorazí čerstvá doprava
  route.a = analyze(route, edges, prefs);
  return route;
}

// Naplánuje trasy; onUpdate(seznam) se volá průběžně, jak přibývají kandidáti.
export async function planRoutes(stops, prefs, onUpdate, signal) {
  const from = stops[0], to = stops[stops.length - 1];
  const cands = [];
  const push = r => {
    if (cands.some(c => overlap(c, r) > 0.9 && overlap(r, c) > 0.9)) return false;
    cands.push(r);
    cands.sort((x, y) => score(x, prefs.priority) - score(y, prefs.priority));
    onUpdate && onUpdate([...cands]);
    return true;
  };
  const tryRoute = async (locs, opts) => {
    try { const r = await valhallaRoute(locs, { prefs, ...opts }, signal); await enrich(r, prefs, signal); push(r); return r; }
    catch (e) { if (e.name === 'AbortError') throw e; console.warn(opts.label, e); return null; }
  };
  const main = tryRoute(stops, { label: 'Hlavní' });
  const back = tryRoute(stops, { label: 'Okresky', auto: { use_highways: 0, use_tolls: 0 } });
  const short = tryRoute(stops, { label: 'Nejkratší', auto: { shortest: true } });
  // alternativy z OSRM převedené přes průjezdní body na Valhallu (kvůli českým pokynům a stejnému modelu)
  const alts = stops.length === 2 ? osrmShapes(from, to, signal).then(shapes => Promise.all(shapes.slice(1).map((sh, k) => {
    const c = cumDist(sh), L = c[c.length - 1];
    const via = [0.3, 0.55, 0.8].map(f => Object.assign(pointAt(sh, c, L * f), { type: 'through' }));
    return tryRoute([from, ...via, to], { label: 'Alternativa ' + (k + 1) });
  }))) : Promise.resolve();
  await Promise.all([main, back, short, alts]);
  if (!cands.length) throw new Error('Trasu se nepodařilo najít');

  // uzavírka na nejlepší trase → přepočítat s vyloučením uzavřených úseků
  const best = cands[0];
  if (best.a.closures) {
    const polys = best.a.events.filter(e => e.ev.kind === 'closure' && e.ev.full).slice(0, 8).map(({ ev }) => box(ev));
    await tryRoute(stops, { label: 'Objízdná', exclude: polys });
  }
  return cands;
}

function box(ev) {
  const pts = ev.line || [[ev.lon, ev.lat]];
  let w = 180, s = 90, e = -180, n = -90;
  for (const [x, y] of pts) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  const d = 0.0004;
  return [[w - d, s - d], [e + d, s - d], [e + d, n + d], [w - d, n + d], [w - d, s - d]];
}

// rychlý přepočet při sjetí z trasy
export async function reroute(pos, heading, rest, prefs, signal) {
  const start = Object.assign([pos[0], pos[1]], { heading });
  const r = await valhallaRoute([start, ...rest], { prefs, label: 'Přepočet' }, signal);
  await enrich(r, prefs, signal);
  return r;
}

// limit v místě mimo trasu (volná jízda)
export async function locateLimit(p, heading, signal) {
  const j = await post('/locate', { locations: [{ lat: p[1], lon: p[0], ...(heading != null ? { heading: Math.round(heading), heading_tolerance: 50 } : {}) }], costing: 'auto', verbose: true }, signal, 1);
  const edges = (j[0] && j[0].edges) || [];
  const e = edges.find(x => x.edge && !['footway', 'track', 'cycleway', 'path'].includes(x.edge.classification.use)) || edges[0];
  if (!e) return null;
  const cls = e.edge.classification.classification;
  const sl = e.edge_info && e.edge_info.speed_limit;
  const v = e.edge.speeds && e.edge.speeds.default;
  return { limit: sl && sl < 200 ? sl : defaultLimit(cls, v && v <= 40, v || 60, e.edge.classification.use), known: !!(sl && sl < 200), name: (e.edge_info.names || [])[0] || '' };
}

export const fmtTime = s => { s = Math.round(s / 60); const h = Math.floor(s / 60), m = s % 60; return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`; };
export const fmtDist = m => m >= 10000 ? `${Math.round(m / 1000)} km` : m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m / 10) * 10} m`;
export { pointAt };
