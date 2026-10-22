// Statická data z OSM (radary, úsekové měření, prahy, pumpy, exity dálnic) + prostorové indexy.
import { Grid } from './geo.js?v=b41a3a0790';

const V = 'b41a3a0790';
export const db = {
  cams: [], sections: [], bumps: [], fuel: [], exits: [],
  camGrid: new Grid(0.02), bumpGrid: new Grid(0.01), fuelGrid: new Grid(0.05),
  ready: false,
};

async function j(url) {
  const r = await fetch(url + '?v=' + V);
  if (!r.ok) throw new Error(url);
  return r.json();
}

export async function loadData() {
  const [rad, ex, fuel] = await Promise.all([j('data/radary.json'), j('data/exity.json'), j('data/pumpy.json').catch(() => [])]);
  db.cams = rad.cams.map(([lon, lat, ms], i) => ({ id: 'c' + i, lon, lat, ms }));
  db.sections = rad.sections.map(([lon1, lat1, lon2, lat2, ms], i) => ({ id: 's' + i, a: [lon1, lat1], b: [lon2, lat2], ms }));
  for (const c of db.cams) db.camGrid.add(c.lon, c.lat, c);
  db.exits = ex.map(([lon, lat, ref, name]) => ({ lon, lat, ref, name }));
  db.fuel = fuel.map(([lon, lat, name]) => ({ lon, lat, name }));
  for (const f of db.fuel) db.fuelGrid.add(f.lon, f.lat, f);
  db.ready = true;
  // prahy jsou větší, dotáhnout až potom
  j('data/prahy.json').then(b => {
    db.bumps = b.map(([lon, lat]) => ({ lon, lat }));
    for (const p of db.bumps) db.bumpGrid.add(p.lon, p.lat, p);
  }).catch(() => {});
}

export function camsGeoJSON() {
  return {
    type: 'FeatureCollection',
    features: [
      ...db.cams.map(c => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [c.lon, c.lat] }, properties: { kind: 'cam', ms: c.ms || '' } })),
      ...db.sections.flatMap(s => [s.a, s.b].map((p, i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: { kind: i ? 'secEnd' : 'sec', ms: s.ms || '' } }))),
    ],
  };
}
export function sectionsGeoJSON() {
  return { type: 'FeatureCollection', features: db.sections.map(s => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: [s.a, s.b] }, properties: { ms: s.ms } })) };
}
export function bumpsGeoJSON() {
  return { type: 'FeatureCollection', features: db.bumps.map(p => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: { kind: 'bump' } })) };
}
