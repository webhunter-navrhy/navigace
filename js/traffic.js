// Živá doprava z NDIC: které kraje stáhnout, obnova každé 3 minuty, indexy pro výpočet tras a vrstvy mapy.
import { Grid, bearing, dist } from './geo.js';

// kód kraje (RÚIAN) → přibližný obdélník [západ, jih, východ, sever]
const REGIONS = {
  19: [14.22, 49.94, 14.71, 50.18], 27: [13.40, 49.53, 15.55, 50.63], 35: [13.50, 48.55, 15.60, 49.62],
  43: [12.40, 49.05, 13.85, 50.10], 51: [12.09, 49.90, 13.30, 50.47], 60: [12.90, 50.15, 14.65, 51.06],
  78: [14.40, 50.45, 15.55, 51.06], 86: [15.30, 50.00, 16.60, 50.80], 94: [15.35, 49.55, 16.90, 50.20],
  108: [14.95, 48.95, 16.40, 49.83], 116: [15.55, 48.55, 17.65, 49.65], 124: [16.70, 49.30, 17.90, 50.45],
  132: [17.15, 49.40, 18.86, 50.30], 141: [17.15, 48.85, 18.45, 49.50],
};
const TTL = 3 * 60 * 1000;

export const traffic = {
  regions: new Map(), // code → {events, fcd, t}
  eventGrid: new Grid(0.02), fcdGrid: new Grid(0.01),
  events: [], fcd: [],
  onChange: null, loading: false, error: null,
};

let worker = null, seq = 0;
const pending = new Map();
function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./traffic.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = e => { const p = pending.get(e.data.id); if (p) { pending.delete(e.data.id); p(e.data.regions); } };
  return worker;
}

export function regionsFor(points, margin = 0.03) {
  const set = new Set();
  for (const [lon, lat] of points) for (const [c, b] of Object.entries(REGIONS))
    if (lon >= b[0] - margin && lon <= b[2] + margin && lat >= b[1] - margin && lat <= b[3] + margin) set.add(+c);
  return [...set];
}

function rebuild() {
  const ev = new Map(), fcd = [];
  for (const r of traffic.regions.values()) { for (const e of r.events) ev.set(e.id, e); fcd.push(...r.fcd); }
  traffic.events = [...ev.values()];
  traffic.fcd = fcd;
  traffic.eventGrid = new Grid(0.02);
  for (const e of traffic.events) {
    traffic.eventGrid.add(e.lon, e.lat, e);
    if (e.line) for (let i = 0; i < e.line.length; i += 3) traffic.eventGrid.add(e.line[i][0], e.line[i][1], e);
  }
  // body zácpy po ~40 m se směrem jízdy, aby šly přiřadit k trase
  traffic.fcdGrid = new Grid(0.01);
  for (const s of fcd) {
    const c = s.coords;
    for (let i = 0; i < c.length - 1; i++) {
      const L = dist(c[i], c[i + 1]), n = Math.max(1, Math.round(L / 40)), b = bearing(c[i], c[i + 1]);
      for (let k = 0; k < n; k++) {
        const t = k / n, p = [c[i][0] + t * (c[i + 1][0] - c[i][0]), c[i][1] + t * (c[i + 1][1] - c[i][1])];
        traffic.fcdGrid.add(p[0], p[1], { p, b, lvl: s.lvl, v: s.v, free: s.free });
      }
    }
  }
  traffic.onChange && traffic.onChange();
}

export async function ensureTraffic(points, { force = false } = {}) {
  const codes = regionsFor(points).filter(c => force || !traffic.regions.has(c) || Date.now() - traffic.regions.get(c).t > TTL);
  if (!codes.length) return;
  traffic.loading = true;
  const id = ++seq;
  const regions = await new Promise(res => { pending.set(id, res); getWorker().postMessage({ id, codes }); });
  traffic.loading = false;
  let ok = 0;
  for (const r of regions) if (!r.error) { traffic.regions.set(r.code, r); ok++; }
  traffic.error = ok ? null : (regions[0] && regions[0].error);
  rebuild();
}

let timer = null;
export function startAutoRefresh(getPoints) {
  clearInterval(timer);
  timer = setInterval(() => ensureTraffic(getPoints()).catch(() => {}), 60 * 1000);
}

const KIND_CS = { accident: 'Nehoda', jam: 'Kolona', closure: 'Uzavírka', works: 'Práce na silnici', hazard: 'Nebezpečí', info: 'Dopravní info' };
export const kindName = k => KIND_CS[k] || 'Dopravní info';

export function trafficGeoJSON() {
  return {
    flow: { type: 'FeatureCollection', features: traffic.fcd.map(s => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: s.coords }, properties: { lvl: s.lvl, v: s.v } })) },
    events: { type: 'FeatureCollection', features: traffic.events.filter(e => e.kind !== 'info').map(e => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [e.lon, e.lat] }, properties: { id: e.id, kind: e.kind, full: e.full ? 1 : 0 } })) },
    lines: { type: 'FeatureCollection', features: traffic.events.filter(e => e.line && (e.kind === 'closure' || e.kind === 'jam' || e.kind === 'accident')).map(e => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: e.line }, properties: { kind: e.kind, full: e.full ? 1 : 0 } })) },
  };
}
export const findEvent = id => traffic.events.find(e => e.id === id);
