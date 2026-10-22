// Vlastní styl mapy nad vektorovými dlaždicemi OpenFreeMap (schéma OpenMapTiles).
import { THEMES } from './themes.js';

const NAME = ['coalesce', ['get', 'name:cs'], ['get', 'name:latin'], ['get', 'name']];
const F_REG = ['Noto Sans Regular'], F_BOLD = ['Noto Sans Bold'], F_IT = ['Noto Sans Italic'];

const w = stops => ['interpolate', ['exponential', 1.55], ['zoom'], ...stops.flat()];
const WIDTH = {
  motorway: [[5, 0.6], [9, 1.6], [12, 3.2], [15, 9], [18, 28]],
  trunk: [[6, 0.5], [9, 1.2], [12, 2.8], [15, 8], [18, 24]],
  primary: [[7, 0.4], [10, 1.2], [12, 2.4], [15, 7], [18, 22]],
  secondary: [[8, 0.3], [11, 1], [13, 2.2], [15, 6], [18, 18]],
  tertiary: [[9, 0.3], [12, 1], [14, 2.6], [16, 6], [18, 14]],
  minor: [[12, 0.4], [14, 1.6], [16, 4.5], [18, 11]],
  service: [[14, 0.3], [16, 2], [18, 6]],
  track: [[13, 0.4], [16, 1.2], [18, 3]],
};
const casingW = stops => stops.map(([z, v]) => [z, v * 1.35 + 0.8]);

function roadLayers(c) {
  const L = [];
  const order = ['track', 'service', 'minor', 'tertiary', 'secondary', 'primary', 'trunk', 'motorway'];
  const minz = { motorway: 5, trunk: 6, primary: 7, secondary: 8, tertiary: 9, minor: 12, service: 14, track: 13 };
  const cls = k => k === 'minor' ? ['minor', 'residential', 'unclassified', 'living_street'] : [k];
  for (const brunnel of ['tunnel', 'ground', 'bridge']) {
    const bf = brunnel === 'ground' ? ['!', ['match', ['get', 'brunnel'], ['tunnel', 'bridge'], true, false]] : ['==', ['get', 'brunnel'], brunnel];
    for (const k of order) {
      if (k === 'track' || k === 'service') {
        if (brunnel !== 'ground') continue;
      }
      const filter = ['all', ['match', ['get', 'class'], cls(k), true, false], bf];
      const big = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'].includes(k);
      if (big || k === 'minor') L.push({
        id: `road-${brunnel}-${k}-casing`, type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: Math.max(minz[k], big ? 10 : 13), filter,
        layout: { 'line-cap': brunnel === 'tunnel' ? 'butt' : 'round', 'line-join': 'round' },
        paint: { 'line-color': c.road.casing, 'line-width': w(casingW(WIDTH[k])), 'line-opacity': brunnel === 'tunnel' ? 0.5 : 1 },
      });
      L.push({
        id: `road-${brunnel}-${k}`, type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: minz[k], filter,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': c.road[k], 'line-width': w(WIDTH[k]),
          'line-opacity': brunnel === 'tunnel' ? 0.55 : 1,
          ...(k === 'track' ? { 'line-dasharray': [2, 1.5] } : {}),
        },
      });
    }
  }
  L.push({
    id: 'rail', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 11,
    filter: ['==', ['get', 'class'], 'rail'],
    paint: { 'line-color': c.road.rail, 'line-width': w([[11, 0.6], [16, 2]]), 'line-dasharray': [3, 2] },
  });
  return L;
}

export function buildStyle(themeId) {
  const c = THEMES[themeId].map;
  return {
    version: 8,
    name: 'navigace-' + themeId,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: '© <a href="https://openfreemap.org">OpenFreeMap</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': c.bg } },
      { id: 'landcover', type: 'fill', source: 'omt', 'source-layer': 'landcover',
        paint: { 'fill-color': ['match', ['get', 'class'], 'wood', c.wood, 'forest', c.wood, 'grass', c.grass, 'wetland', c.grass, 'farmland', c.farm, c.land2], 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.7, 12, 1] } },
      { id: 'landuse', type: 'fill', source: 'omt', 'source-layer': 'landuse', minzoom: 8,
        paint: { 'fill-color': ['match', ['get', 'class'], ['industrial', 'commercial', 'retail', 'railway'], c.industrial, ['cemetery', 'pitch', 'stadium', 'playground'], c.grass, c.residential], 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 12, 0.9] } },
      { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': c.grass, 'fill-opacity': 0.8 } },
      { id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway', minzoom: 9,
        paint: { 'line-color': c.waterLine, 'line-width': w([[9, 0.4], [14, 1.6], [18, 5]]) } },
      { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': c.water } },
      { id: 'boundary-country', type: 'line', source: 'omt', 'source-layer': 'boundary',
        filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
        paint: { 'line-color': c.boundary, 'line-width': w([[3, 0.6], [10, 1.6]]), 'line-dasharray': [4, 2], 'line-opacity': 0.7 } },
      { id: 'building', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 14, maxzoom: 16,
        paint: { 'fill-color': c.building, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, 0.9] } },
      { id: 'building-3d', type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', minzoom: 15.5,
        paint: { 'fill-extrusion-color': c.building3d, 'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': 0.85 } },
      ...roadLayers(c),
      { id: 'waterlabel', type: 'symbol', source: 'omt', 'source-layer': 'water_name', minzoom: 10,
        layout: { 'text-field': NAME, 'text-font': F_IT, 'text-size': 12 },
        paint: { 'text-color': c.waterLine, 'text-halo-color': c.halo, 'text-halo-width': 1.2 } },
      { id: 'road-label', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 13,
        filter: ['match', ['get', 'class'], ['primary', 'secondary', 'tertiary', 'minor', 'residential', 'unclassified', 'trunk'], true, false],
        layout: { 'symbol-placement': 'line', 'text-field': NAME, 'text-font': F_REG, 'text-size': w([[13, 10], [17, 13]]), 'text-max-angle': 30 },
        paint: { 'text-color': c.roadLabel, 'text-halo-color': c.halo, 'text-halo-width': 1.4 } },
      { id: 'road-shield', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 8,
        filter: ['all', ['has', 'ref'], ['match', ['get', 'class'], ['motorway', 'trunk', 'primary'], true, false]],
        layout: { 'symbol-placement': 'line', 'symbol-spacing': 400, 'text-field': ['get', 'ref'], 'text-font': F_BOLD, 'text-size': 10, 'text-rotation-alignment': 'viewport' },
        paint: { 'text-color': c.labelStrong, 'text-halo-color': c.road.motorway, 'text-halo-width': 3 } },
      { id: 'place-minor', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 11,
        filter: ['match', ['get', 'class'], ['village', 'hamlet', 'suburb', 'neighbourhood', 'quarter'], true, false],
        layout: { 'text-field': NAME, 'text-font': F_REG, 'text-size': w([[11, 10], [16, 14]]) },
        paint: { 'text-color': c.label, 'text-halo-color': c.halo, 'text-halo-width': 1.4 } },
      { id: 'place-town', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 7,
        filter: ['==', ['get', 'class'], 'town'],
        layout: { 'text-field': NAME, 'text-font': F_REG, 'text-size': w([[7, 10], [12, 15], [15, 18]]) },
        paint: { 'text-color': c.labelStrong, 'text-halo-color': c.halo, 'text-halo-width': 1.5, 'text-opacity': 0.88 } },
      { id: 'place-city', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 4,
        filter: ['==', ['get', 'class'], 'city'],
        layout: { 'text-field': NAME, 'text-font': F_BOLD, 'text-size': w([[4, 11], [10, 17], [14, 22]]), 'text-letter-spacing': 0.02 },
        paint: { 'text-color': c.labelStrong, 'text-halo-color': c.halo, 'text-halo-width': 1.6 } },
    ],
  };
}
