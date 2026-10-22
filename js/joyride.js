// Joy ride: okružní projížďka na zadaný čas. Varianty v různých směrech, okresky se zatáčkami,
// volitelně dálniční úsek (130), jídlo, kafe, vyhlídka a tankování po cestě.
import { dest, dist, bearing, cumDist, project, pointAt } from './geo.js';
import { valhallaRoute, enrich } from './route.js';
import { db } from './data.js';
import { profile, funMeters } from './pacenotes.js';

const PHOTON = 'https://photon.komoot.io/reverse';

function merge(parts, label) {
  const coords = [], maneuvers = [];
  parts.forEach((r, pi) => {
    const off = coords.length ? coords.length - 1 : 0;
    coords.push(...(coords.length ? r.coords.slice(1) : r.coords));
    for (const m of r.maneuvers) {
      if (pi > 0 && [1, 2, 3].includes(m.type)) continue;
      if (pi < parts.length - 1 && [4, 5, 6].includes(m.type) && !r.stopAtEnd) continue;
      maneuvers.push({ ...m, idx: m.idx + off, stop: [4, 5, 6].includes(m.type) && pi < parts.length - 1 ? r.stopAtEnd : null });
    }
  });
  const cum = cumDist(coords);
  for (const m of maneuvers) m.s = cum[Math.min(m.idx, cum.length - 1)];
  return { label, coords, cum, maneuvers, length: cum[cum.length - 1], vTime: parts.reduce((a, r) => a + r.vTime, 0), legs: parts.length };
}

// waypoints: [{p, type:'break'|'through', mw:true pro úsek na dálnici od tohoto bodu, stop}]
async function buildLoop(wps, prefs, label, signal) {
  const groups = [];
  let cur = null;
  for (let i = 0; i < wps.length - 1; i++) {
    const mw = !!wps[i].mw;
    if (!cur || cur.mw !== mw || wps[i].stop) { cur = { mw, pts: [wps[i]] }; groups.push(cur); }
    cur.pts.push(wps[i + 1]);
  }
  const parts = await Promise.all(groups.map(g => valhallaRoute(
    g.pts.map((w, k) => Object.assign([w.p[0], w.p[1]], { type: k === 0 || k === g.pts.length - 1 ? 'break' : (w.stop ? 'break' : 'through') })),
    { prefs: { ...prefs, avoidHighways: false }, auto: g.mw ? {} : { use_highways: 0, use_tolls: 0 } }, signal)));
  parts.forEach((r, i) => { const last = groups[i].pts[groups[i].pts.length - 1]; r.stopAtEnd = last.stop || null; });
  const route = parts.length === 1 ? parts[0] : merge(parts, label);
  route.label = label;
  return route;
}

// zajímavá místa přes Photon (rychlé, jen pojmenovaná místa z OSM)
async function poi(center, radiusM, tag, signal) {
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 3500);
  signal && signal.addEventListener('abort', () => ctrl.abort());
  try {
    const r = await fetch(`${PHOTON}?lat=${center[1]}&lon=${center[0]}&radius=${Math.round(radiusM / 1000)}&limit=25&osm_tag=${tag}`, { signal: ctrl.signal });
    const j = await r.json();
    return j.features.map(f => ({ p: f.geometry.coordinates, tags: { name: f.properties.name, kind: f.properties.osm_value } }));
  } catch (e) { if (signal && signal.aborted) throw e; return []; } finally { clearTimeout(t); }
}

// rychlý odhad bez atributů hran: čas z Valhally, zábavnost z geometrie
function quick(route) {
  const pr = profile(route.coords, route.cum);
  route.q = { time: route.vTime * 0.86, fun: funMeters(pr, () => false), funScore: Math.min(10, funMeters(pr, () => false) / route.length * 60) };
  return route;
}

function nearestOnRoute(route, items, sFrom, sTo, maxD) {
  let best = null;
  for (const it of items) {
    const pr = project(route.coords, route.cum, it.p);
    if (pr.d > maxD || pr.s < sFrom || pr.s > sTo) continue;
    const sc = pr.d + Math.abs(pr.s - (sFrom + sTo) / 2) * 0.05;
    if (!best || sc < best.sc) best = { ...it, s: pr.s, d: pr.d, sc };
  }
  return best;
}

export async function planJoyride(opts, onProgress = () => {}, signal) {
  const { start, minutes, wants, prefs } = opts;
  const P = { ...prefs, sport: true };
  const target = minutes * 60;
  const avg = wants.topspeed ? 62 : 52; // km/h průměr na projížďce
  const L = target / 3600 * avg * 1000 * (minutes > 120 ? 0.9 : 1);
  const base = Math.random() * 360;
  const dirs = [0, 90, 180, 270].map(d => (base + d) % 360);
  onProgress('Hledám zatáčky ve čtyřech směrech…');

  const variant = async (theta, rScale = 1) => {
    const r = L / (1.32 * 3.29) * rScale;
    const p1 = dest(start, theta - 40, r), p2 = dest(start, theta + 40, r);
    const wps = [{ p: start }, { p: p1 }];
    let mwInfo = null;
    if (wants.topspeed) {
      const e1 = db.exits.filter(e => dist([e.lon, e.lat], p1) < r * 0.8).sort((a, b) => dist([a.lon, a.lat], p1) - dist([b.lon, b.lat], p1))[0];
      const e2 = e1 && db.exits.filter(e => { const d = dist([e.lon, e.lat], [e1.lon, e1.lat]); return d > 14000 && d < 38000; })
        .sort((a, b) => dist([a.lon, a.lat], p2) - dist([b.lon, b.lat], p2))[0];
      if (e1 && e2) { wps.push({ p: [e1.lon, e1.lat], mw: true }, { p: [e2.lon, e2.lat] }); mwInfo = { from: e1, to: e2 }; }
    }
    wps.push({ p: p2 }, { p: start });
    const route = quick(await buildLoop(wps, P, '', signal));
    route.wps = wps; route.mw = mwInfo; route.theta = theta; route.rScale = rScale;
    return route;
  };

  // každý směr ve dvou velikostech najednou, bez dalšího kola přepočtu
  const scales = [0.8, 1.15];
  const jobs = (wants.topspeed ? dirs.slice(0, 3) : dirs).flatMap(t => scales.map(k => variant(t, k).catch(() => null)));
  const all = (await Promise.all(jobs)).filter(Boolean);
  if (!all.length) throw new Error('Projížďku se nepodařilo naplánovat');
  const byDir = new Map();
  for (const r of all) { const b = byDir.get(r.theta); if (!b || Math.abs(1 - r.q.time / target) < Math.abs(1 - b.q.time / target)) byDir.set(r.theta, r); }
  let routes = [...byDir.values()];
  const fit = r => Math.abs(1 - r.q.time / target);
  const val = r => r.q.funScore * 1.2 - fit(r) * 12 + (wants.topspeed && r.mw ? 2 : 0);
  routes.sort((a, b) => val(b) - val(a));
  routes = routes.slice(0, 5);

  // zastávky a finální přepočet s atributy hran (víc kandidátů, protože až teď víme o zácpách a uzavírkách)
  onProgress(wants.food || wants.coffee || wants.view || wants.fuel ? 'Vybírám, kde se najíst a natankovat…' : 'Počítám rychlosti a zatáčky…');
  routes = (await Promise.all(routes.map(async r => {
    const stops = [];
    const at = f => pointAt(r.coords, r.cum, r.length * f);
    const noFuelDb = !db.fuel || !db.fuel.length;
    const [food, coffee, view, fuelPoi] = await Promise.all([
      wants.food ? poi(at(0.55), 5000, 'amenity:restaurant', signal) : [],
      wants.coffee ? poi(at(0.45), 6000, 'amenity:cafe', signal) : [],
      wants.view ? poi(at(0.4), 12000, 'tourism:viewpoint', signal) : [],
      wants.fuel && noFuelDb ? poi(at(0.5), 9000, 'amenity:fuel', signal) : [],
    ]);
    const pick = (items, a, b, maxD) => nearestOnRoute(r, items, r.length * a, r.length * b, maxD);
    if (wants.food) { const f = pick(food, 0.35, 0.75, 1500); if (f) stops.push({ ...f, kind: 'food', name: f.tags.name }); }
    if (wants.coffee) { const f = pick(coffee, 0.2, 0.8, 1500); if (f) stops.push({ ...f, kind: 'coffee', name: f.tags.name }); }
    if (wants.view) { const f = pick(view, 0.1, 0.9, 4000); if (f) stops.push({ ...f, kind: 'view', name: f.tags.name || 'Vyhlídka' }); }
    if (wants.fuel) {
      let items = fuelPoi;
      if (!noFuelDb) {
        const cand = new Set();
        for (let s = r.length * 0.2; s < r.length * 0.8; s += 2000) { const p = pointAt(r.coords, r.cum, s); for (const x of db.fuelGrid.near(p[0], p[1], 1)) cand.add(x); }
        items = [...cand].map(x => ({ p: [x.lon, x.lat], tags: { name: x.name } }));
      }
      const f = pick(items, 0.2, 0.8, noFuelDb ? 1200 : 600);
      if (f) stops.push({ ...f, kind: 'fuel', name: f.tags.name || 'Čerpací stanice' });
    }
    let out = r;
    if (stops.length) {
      const wps = r.wps.map((w, i) => ({ ...w, s: i === 0 ? 0 : i === r.wps.length - 1 ? r.length : project(r.coords, r.cum, w.p).s }));
      for (const st of stops) wps.push({ p: st.p, s: st.s, stop: { kind: st.kind, name: st.name } });
      wps.sort((a, b) => a.s - b.s);
      // úsek po dálnici musí zůstat mezi exity
      for (let i = 0; i < wps.length - 2; i++) if (wps[i].mw && wps[i + 1].stop) { const t = wps[i + 1]; wps[i + 1] = wps[i + 2]; wps[i + 2] = t; }
      try { out = await buildLoop(wps, P, '', signal); out.wps = wps; out.mw = r.mw; out.stops = stops.sort((a, b) => a.s - b.s); }
      catch (e) { if (signal && signal.aborted) throw e; out = r; r.stops = []; }
    }
    try { await enrich(out, P, signal); } catch (e) { if (signal && signal.aborted) throw e; return null; }
    if (out.stops) for (const st of out.stops) st.s = project(out.coords, out.cum, st.p).s;
    return out;
  }))).filter(Boolean);
  if (!routes.length) throw new Error('Projížďku se nepodařilo naplánovat');

  // finální výběr podle skutečného času (zácpy, uzavírky) a zatáček
  const fitA = r => Math.abs(1 - r.a.time / target);
  const valA = r => r.a.funScore * 1.2 - fitA(r) * 14 - r.a.closures * 20 - r.a.delay / 60 * 0.3
    + (wants.topspeed && r.mw ? 2 : 0) + (r.stops ? r.stops.length * 0.8 : 0);
  routes.sort((a, b) => valA(b) - valA(a));
  routes = routes.slice(0, 3);
  // jména podle charakteru, ne podle pořadí
  const used = new Set();
  const name = (r, l) => { r.label = l; used.add(r); };
  name(routes.reduce((m, r) => r.a.funScore > m.a.funScore ? r : m, routes[0]), 'Zatáčková');
  for (const r of routes) if (!used.has(r) && r.mw) { name(r, 'Svižná'); break; }
  const rest = routes.filter(r => !used.has(r)).sort((a, b) => fitA(a) - fitA(b));
  if (rest[0]) name(rest[0], 'Přesně na čas');
  if (rest[1]) name(rest[1], rest[1].a.urbanShare < 0.12 ? 'Klidná' : 'Jiný směr');
  routes.forEach(r => { r.joy = true; r.dirName = dirName(bearing(start, pointAt(r.coords, r.cum, r.length * 0.5))); });
  return routes;
}

function dirName(b) { return ['na sever', 'na severovýchod', 'na východ', 'na jihovýchod', 'na jih', 'na jihozápad', 'na západ', 'na severozápad'][Math.round(b / 45) % 8]; }

// Okruhy a polygony pro opravdovou maximální rychlost (legálně, na track day)
export const TRACKS = [
  { name: 'Autodrom Most', p: [13.6045, 50.5196], url: 'https://www.autodrom-most.cz' },
  { name: 'Automotodrom Brno (Masarykův okruh)', p: [16.4457, 49.2034], url: 'https://www.automotodrombrno.cz' },
  { name: 'Autodrom Sosnová', p: [14.5394, 50.6633], url: 'https://www.autodromsosnova.cz' },
  { name: 'Polygon Most', p: [13.6110, 50.5222], url: 'https://www.polygonmost.cz' },
];
