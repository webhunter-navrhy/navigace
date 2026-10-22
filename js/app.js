// Hlavní řízení aplikace: mapa, poloha, hledání, plánování, navigace, joy ride, jízdy, hlášení a nastavení.
import { THEMES, THEME_ORDER } from './themes.js?v=b41a3a0790';
import { buildStyle } from './mapstyle.js?v=b41a3a0790';
import { icon, hydrateIcons, maneuverSVG, mapIcon } from './icons.js?v=b41a3a0790';
import { db, loadData, camsGeoJSON, sectionsGeoJSON, bumpsGeoJSON } from './data.js?v=b41a3a0790';
import { traffic, ensureTraffic, startAutoRefresh, trafficGeoJSON, kindName, findEvent } from './traffic.js?v=b41a3a0790';
import { planRoutes, score, enrich, analyze, reroute, locateLimit, valhallaRoute, fmtTime, fmtDist } from './route.js?v=b41a3a0790';
import { planJoyride, TRACKS } from './joyride.js?v=b41a3a0790';
import { Navigator, Simulator } from './nav.js?v=b41a3a0790';
import * as voice from './voice.js?v=b41a3a0790';
import { Recorder, stats, toGPX, drawThumb } from './record.js?v=b41a3a0790';
import { settings as S, saveSettings, places, savePlaces, recents, addRecent, learned, learnSample, parking, trips, lastPos } from './store.js?v=b41a3a0790';
import { dist, bearing, cumDist, pointAt, project, dest } from './geo.js?v=b41a3a0790';
import { REPORT_TYPES, reportType, allReports, shared, startReportSync, addReport as postReport, voteReport, canVote } from './reports.js?v=b41a3a0790';
import { lookAhead } from './drive.js?v=b41a3a0790';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clock = t => new Date(t).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
const pl = (n, a, b, c) => n === 1 ? a : n >= 2 && n <= 4 ? b : c;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shortTime = s => { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`; };
const speakTime = s => { const m = Math.max(1, Math.round(s / 60)), h = Math.floor(m / 60), r = m % 60; return [h ? `${h} ${pl(h, 'hodina', 'hodiny', 'hodin')}` : '', r ? `${r} ${pl(r, 'minuta', 'minuty', 'minut')}` : ''].filter(Boolean).join(' '); };
const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'právě teď' : m < 60 ? `před ${m} min` : m < 1440 ? `před ${Math.round(m / 60)} h` : new Date(t).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' }); };
const fc = features => ({ type: 'FeatureCollection', features });
const line = (coords, properties = {}) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties });
const point = (p, properties = {}) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties });
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;

const st = {
  mode: 'home', theme: null, pos: null, heading: null, speed: 0, lastFix: null, follow: true,
  limit: null, limitKnown: false, routes: [], selR: null, userPicked: false, stops: [], planCtl: null, planError: null,
  nav: null, navRoute: null, navState: null, navStops: [], sim: null, simMult: 1, rally: false, joy: false, wake: null,
  joyMin: 90, joyWants: { curvy: true }, joyRoutes: null, joyMsg: '', arrived: false,
  geo: 'wait', approx: false, drive: null, hazard: null, ask: null,
};
const rec = new Recorder();
let reports = allReports();
voice.configure({ persona: S.persona, voiceURI: S.voiceURI, volume: S.volume, muted: S.muted });

// ---------- vzhled ----------
function effectiveTheme() {
  if (S.autoNight && S.theme === 'atlas') { const h = new Date().getHours(); if (h >= 20 || h < 6) return 'pulnoc'; }
  return S.theme;
}
function applyTheme() {
  const t = effectiveTheme();
  if (t === st.theme) return;
  st.theme = t;
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name=theme-color]').content = THEMES[t].ui.bg;
  if (map) map.setStyle(buildStyle(t, S.relief), { diff: false });
}
let map = null;
applyTheme();
const C = () => THEMES[st.theme].map;

// ---------- mapa ----------
const lp = lastPos.get();
map = new maplibregl.Map({
  container: 'map', style: buildStyle(st.theme, S.relief), center: lp ? [lp.lon, lp.lat] : [15.45, 49.8], zoom: lp ? 14.5 : 6.3, maxPitch: 70,
  attributionControl: { compact: true }, fadeDuration: 120, maxBounds: [[7, 45.5], [24, 54]], dragRotate: true,
});
map.touchZoomRotate.enableRotation();

const srcData = {};
const SOURCES = ['acc', 'flow', 'tlines', 'tevents', 'sections', 'cams', 'bumps', 'reports', 'trip', 'routes', 'routeJam', 'routeLabels', 'stops'];
function setData(id, data) { srcData[id] = data; const s = map.getSource(id); if (s) s.setData(data); }

const IMG = {
  cam: ['cam', '#ffffff', '#16181d', '#d4231c'], sec: ['speed', '#ffffff', '#16181d', '#d4231c'], secEnd: ['check', '#ffffff', '#16181d', '#8a8a8a'],
  bump: ['bump', '#ffcf3f', '#1b1b1b', '#1b1b1b'], police: ['police', '#2557d6', '#ffffff', '#ffffff'], mcam: ['cam', '#ffcf3f', '#1b1b1b', '#d4231c'],
  jam: ['jam', '#f07a3a', '#ffffff', '#ffffff'], accident: ['accident', '#e5484d', '#ffffff', '#ffffff'], closure: ['closure', '#e5484d', '#ffffff', '#ffffff'],
  works: ['works', '#f4a32e', '#1b1b1b', '#ffffff'], hazard: ['hazard', '#f4a32e', '#1b1b1b', '#ffffff'], info: ['info', '#5d6470', '#ffffff', '#ffffff'],
  fuel: ['fuel', '#1f8a5b', '#ffffff', '#ffffff'], parking: ['parking', '#2f6fd6', '#ffffff', '#ffffff'], food: ['food', '#bf5130', '#ffffff', '#ffffff'], coffee: ['coffee', '#8a5a3c', '#ffffff', '#ffffff'], view: ['view', '#3f7d4f', '#ffffff', '#ffffff'],
};
let imgCache = null;
function pillImage(bg, border, radius) {
  const c = document.createElement('canvas'); c.width = 48; c.height = 32;
  const x = c.getContext('2d');
  x.fillStyle = bg; x.strokeStyle = border; x.lineWidth = 2;
  x.beginPath(); x.roundRect ? x.roundRect(1, 1, 46, 30, radius) : x.rect(1, 1, 46, 30); x.fill(); x.stroke();
  return x.getImageData(0, 0, 48, 32);
}
async function addImages() {
  if (!imgCache) imgCache = Object.fromEntries(await Promise.all(Object.entries(IMG).map(async ([k, a]) => [k, await mapIcon(...a)])));
  for (const [k, img] of Object.entries(imgCache)) if (!map.hasImage('i-' + k)) map.addImage('i-' + k, img, { pixelRatio: 2 });
  const t = THEMES[st.theme], r = st.theme === 'rally' ? 2 : 13;
  const opts = { pixelRatio: 2, stretchX: [[14, 34]], stretchY: [[13, 19]], content: [12, 7, 36, 25] };
  for (const [id, bg, bd] of [['pill-sel', t.map.route, t.map.routeCasing], ['pill', t.dark ? '#1b1f27' : '#fffaf2', t.dark ? '#3a3f48' : '#d3c5ac'], ['shield-d', '#c8102e', '#ffffff'], ['shield', t.dark ? '#e9e6df' : '#ffffff', t.dark ? '#0b0d11' : '#8c7f6c']]) {
    if (map.hasImage(id)) map.removeImage(id);
    map.addImage(id, pillImage(bg, bd, r), opts);
  }
}

let listenersOn = false;
async function onStyle() {
  await addImages();
  const c = C(), w = stops => ['interpolate', ['exponential', 1.5], ['zoom'], ...stops.flat()];
  for (const id of SOURCES) if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: srcData[id] || fc([]) });
  const below = map.getLayer('road-label') ? 'road-label' : undefined;
  const add = (layer, before) => { if (!map.getLayer(layer.id)) map.addLayer(layer, before); };
  const T = c.traffic, lvl = ['match', ['get', 'lvl'], 5, T[2], 4, T[1], T[0]];
  // přesnost polohy
  add({ id: 'acc', type: 'fill', source: 'acc', paint: { 'fill-color': c.route, 'fill-opacity': 0.1, 'fill-outline-color': c.route } }, below);
  // zpomalení jen jemně a zblízka, kolony výrazně i zdálky
  add({ id: 'flow-light', type: 'line', source: 'flow', minzoom: 11.5, filter: ['==', ['get', 'lvl'], 3], layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': T[0], 'line-width': w([[11.5, 1.2], [14, 2.4], [17, 4.5]]), 'line-offset': w([[11.5, 0.5], [14, 2.5], [17, 5]]), 'line-opacity': 0.7 } }, below);
  add({ id: 'flow', type: 'line', source: 'flow', minzoom: 7, filter: ['>=', ['get', 'lvl'], 4], layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': lvl, 'line-width': w([[7, 1.6], [12, 3.4], [16, 6.5]]), 'line-offset': w([[10, 0], [14, 2.5], [17, 5]]), 'line-opacity': 0.95 } }, below);
  add({ id: 'tlines', type: 'line', source: 'tlines', minzoom: 8, filter: ['any', ['!=', ['get', 'kind'], 'closure'], ['==', ['get', 'full'], 1]], layout: { 'line-cap': 'round' },
    paint: { 'line-color': T[2], 'line-width': w([[8, 2], [14, 5]]), 'line-dasharray': [1.2, 1.2] } }, below);
  add({ id: 'sections', type: 'line', source: 'sections', minzoom: 9,
    paint: { 'line-color': '#d4231c', 'line-width': w([[9, 1.5], [15, 3]]), 'line-dasharray': [0.6, 1.6], 'line-opacity': 0.75 } }, below);
  add({ id: 'trip', type: 'line', source: 'trip', layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': c.route, 'line-width': w([[6, 2.5], [14, 5]]), 'line-dasharray': [1.5, 1.2] } }, below);
  add({ id: 'route-alt', type: 'line', source: 'routes', filter: ['==', ['get', 'sel'], 0], layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': c.routeAlt, 'line-width': w([[6, 4], [12, 7], [17, 14]]), 'line-opacity': 0.9 } }, below);
  add({ id: 'route-glow', type: 'line', source: 'routes', filter: ['==', ['get', 'sel'], 1], layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': c.glow, 'line-width': w([[6, 12], [12, 20], [17, 36]]), 'line-blur': w([[6, 6], [17, 14]]) } }, below);
  add({ id: 'route-casing', type: 'line', source: 'routes', filter: ['==', ['get', 'sel'], 1], layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': c.routeCasing, 'line-width': w([[6, 6.5], [12, 10], [17, 19]]) } }, below);
  add({ id: 'route-line', type: 'line', source: 'routes', filter: ['==', ['get', 'sel'], 1], layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': c.route, 'line-width': w([[6, 4], [12, 6.5], [17, 13]]) } }, below);
  add({ id: 'route-jam', type: 'line', source: 'routeJam', layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': lvl, 'line-width': w([[6, 4], [12, 6.5], [17, 13]]) } }, below);
  // pumpy od z14, parkoviště až zblízka (ve městě by jinak zaplavila mapu)
  for (const [id, cls, mz, ic] of [['poi', 'fuel', 13.5, 'i-fuel'], ['poi-park', 'parking', 16.2, 'i-parking']]) add({ id, type: 'symbol', source: 'omt', 'source-layer': 'poi', minzoom: mz, filter: ['==', ['get', 'class'], cls],
    layout: { 'icon-image': ic, 'icon-size': ['interpolate', ['linear'], ['zoom'], 14, 0.4, 17, 0.58], 'symbol-sort-key': ['get', 'rank'],
      'text-field': ['step', ['zoom'], '', 15.5, ['coalesce', ['get', 'name:cs'], ['get', 'name']]], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-optional': true },
    paint: { 'text-color': c.label, 'text-halo-color': c.halo, 'text-halo-width': 1.4 } });
  add({ id: 'road-shield', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 7,
    filter: ['all', ['has', 'ref'], ['<=', ['length', ['get', 'ref']], 6], ['match', ['get', 'class'], ['motorway', 'trunk', 'primary'], true, false]],
    layout: { 'symbol-placement': 'line', 'symbol-spacing': ['step', ['zoom'], 260, 11, 420], 'text-field': ['get', 'ref'], 'text-font': ['Noto Sans Bold'], 'text-size': 10.5,
      'text-rotation-alignment': 'viewport', 'icon-rotation-alignment': 'viewport', 'icon-image': ['case', ['==', ['slice', ['get', 'ref'], 0, 1], 'D'], 'shield-d', 'shield'],
      'icon-text-fit': 'both', 'icon-text-fit-padding': [1, 4, 1, 4] },
    paint: { 'text-color': ['case', ['==', ['slice', ['get', 'ref'], 0, 1], 'D'], '#ffffff', '#1b1b1b'] } });
  add({ id: 'bumps', type: 'symbol', source: 'bumps', minzoom: 14.5, layout: { 'icon-image': 'i-bump', 'icon-size': 0.62, 'icon-allow-overlap': true } });
  add({ id: 'cams', type: 'symbol', source: 'cams', minzoom: 10,
    layout: { 'icon-image': ['match', ['get', 'kind'], 'cam', 'i-cam', 'sec', 'i-sec', 'i-secEnd'], 'icon-size': w([[10, 0.6], [15, 0.9]]), 'icon-allow-overlap': true,
      'text-field': ['step', ['zoom'], '', 13, ['to-string', ['get', 'ms']]], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-offset': [0, 1.5], 'text-optional': true },
    paint: { 'text-color': c.labelStrong, 'text-halo-color': c.halo, 'text-halo-width': 1.5 } });
  // zdálky jen to podstatné (nehody, kolony, úplné uzavírky), omezení a práce až po přiblížení
  const major = ['any', ['in', ['get', 'kind'], ['literal', ['accident', 'jam']]], ['==', ['get', 'full'], 1]];
  const evLayout = { 'icon-image': ['concat', 'i-', ['get', 'kind']], 'icon-size': w([[7.5, 0.55], [13, 0.95]]), 'icon-allow-overlap': ['step', ['zoom'], false, 11, true],
    'symbol-sort-key': ['match', ['get', 'kind'], 'closure', 0, 'accident', 1, 'jam', 2, 3] };
  add({ id: 'tevents-minor', type: 'symbol', source: 'tevents', minzoom: 11, filter: ['!', major], layout: evLayout });
  add({ id: 'tevents', type: 'symbol', source: 'tevents', minzoom: 7.5, filter: major, layout: evLayout });
  add({ id: 'reports', type: 'symbol', source: 'reports', layout: { 'icon-image': ['concat', 'i-', ['get', 'type']], 'icon-size': 1, 'icon-allow-overlap': true } });
  add({ id: 'stops', type: 'symbol', source: 'stops',
    layout: { 'icon-image': ['concat', 'i-', ['get', 'kind']], 'icon-size': 1, 'icon-allow-overlap': true, 'text-field': ['step', ['zoom'], '', 11, ['get', 'name']],
      'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-offset': [0, 1.7], 'text-anchor': 'top', 'text-optional': true },
    paint: { 'text-color': c.labelStrong, 'text-halo-color': c.halo, 'text-halo-width': 1.6 } });
  add({ id: 'route-labels', type: 'symbol', source: 'routeLabels',
    layout: { 'text-field': ['get', 't'], 'text-font': ['Noto Sans Bold'], 'text-size': 14, 'icon-image': ['case', ['==', ['get', 'sel'], 1], 'pill-sel', 'pill'],
      'icon-text-fit': 'both', 'icon-text-fit-padding': [3, 9, 3, 9], 'icon-allow-overlap': true, 'text-allow-overlap': true, 'symbol-sort-key': ['-', 1, ['get', 'sel']] },
    paint: { 'text-color': ['case', ['==', ['get', 'sel'], 1], THEMES[st.theme].dark ? '#14110c' : '#fff', c.labelStrong] } });
  applyVisibility();
  if (!listenersOn) { listenersOn = true; mapListeners(); }
}
map.on('style.load', onStyle);

function applyVisibility() {
  const vis = (ids, on) => ids.forEach(id => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'));
  vis(['flow', 'tlines', 'tevents', 'tevents-minor'], S.showTraffic);
  vis(['flow-light'], S.showTraffic && st.mode !== 'nav');
  vis(['cams', 'sections'], S.showCams);
  vis(['bumps'], S.showBumps);
}

function mapListeners() {
  const pick = e => { const f = e.features && e.features[0]; if (!f) return; const r = (st.mode === 'joy' ? st.joyRoutes : st.routes)[f.properties.idx]; if (r) selectRoute(r); };
  map.on('click', 'route-alt', pick);
  map.on('click', 'route-labels', pick);
  for (const id of ['tevents', 'tevents-minor']) map.on('click', id, e => {
    const ev = findEvent(e.features[0].properties.id); if (!ev) return;
    toast({ icon: KIND_ICON[ev.kind] || 'info', title: ev.title || kindName(ev.kind), sub: [ev.road, ev.loc, ev.to ? 'do ' + ev.to : ''].filter(Boolean).join(' · '), ms: 7000, danger: ev.kind === 'closure' || ev.kind === 'accident' });
  });
  map.on('click', 'cams', e => { const p = e.features[0].properties; toast({ icon: 'cam', title: p.kind === 'cam' ? 'Radar' : p.kind === 'sec' ? 'Začátek úsekového měření' : 'Konec úsekového měření', sub: p.ms ? `limit ${p.ms} km/h` : '' }); });
  map.on('click', 'reports', e => { const id = String(e.features[0].properties.id), r = reports.find(x => String(x.id) === id); r && openRepInfo(r); });
  for (const id of ['route-alt', 'route-labels', 'tevents', 'tevents-minor', 'cams', 'reports']) {
    map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
  }
}

// kamera: uživatel posunul mapu → přestat sledovat polohu
for (const ev of ['dragstart', 'rotatestart', 'pitchstart']) map.on(ev, e => { if (e.originalEvent) setFollow(false); });
map.on('zoomstart', e => { if (e.originalEvent && e.originalEvent.type === 'wheel') setFollow(false); });
// při prohlížení je poloha nad spodním panelem, ne schovaná pod ním
function homePad() {
  if (innerWidth >= 720) return { top: 0, bottom: 0, left: 0, right: sheetEl.offsetWidth + 16 };
  return { top: 70, bottom: Math.min(sheetEl.offsetHeight, innerHeight * 0.5), left: 0, right: 0 };
}
function setFollow(v) { st.follow = v; $('locBtn').classList.toggle('follow', v && !!st.pos); }

// dlouhé podržení prstu (nebo pravé tlačítko) = cíl
let lpT = null, lpAt = null, lpLast = 0;
map.on('touchstart', e => {
  clearTimeout(lpT);
  if (e.originalEvent.touches.length !== 1) return;
  lpAt = e.point; const ll = e.lngLat;
  lpT = setTimeout(() => pickPoint(ll), 600);
});
map.on('touchmove', e => { if (lpAt && (Math.abs(e.point.x - lpAt.x) > 10 || Math.abs(e.point.y - lpAt.y) > 10)) clearTimeout(lpT); });
for (const ev of ['touchend', 'touchcancel', 'movestart']) map.on(ev, () => clearTimeout(lpT));
map.on('contextmenu', e => pickPoint(e.lngLat));
async function pickPoint(ll) {
  if (st.mode === 'nav' || Date.now() - lpLast < 1000 || !$('page').hidden) return;
  lpLast = Date.now();
  navigator.vibrate && navigator.vibrate(15);
  let place = { name: 'Vybrané místo', sub: `${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}`, lon: ll.lng, lat: ll.lat };
  try {
    const j = await (await fetch(`https://photon.komoot.io/reverse?lat=${ll.lat}&lon=${ll.lng}&limit=1&lang=default`)).json();
    if (j.features && j.features[0]) place = { ...placeFromPhoton(j.features[0]), lon: ll.lng, lat: ll.lat };
  } catch {
    try {
      const x = await (await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${ll.lat}&lon=${ll.lng}&format=jsonv2&zoom=17&accept-language=cs`)).json();
      const a = x.address || {}, city = a.city || a.town || a.village || '';
      if (x.display_name) place = { ...place, name: x.name || (a.road ? `${a.road}${a.house_number ? ' ' + a.house_number : ''}` : city) || place.name, sub: city };
    } catch { }
  }
  goTo(place);
}

// ---------- poloha ----------
const puckEl = document.createElement('div');
puckEl.className = 'puck';
puckEl.innerHTML = `<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" style="fill:var(--panel-solid);stroke:var(--accent)" stroke-width="2.5"/><path d="M16 6.5l6.6 15.5L16 18.4 9.4 22z" style="fill:var(--accent)"/></svg>`;
const puck = new maplibregl.Marker({ element: puckEl, rotationAlignment: 'map', pitchAlignment: 'map' });
let puckOn = false, puckAnim = 0, puckCur = null;
function setPuck(p, brg) {
  if (!puckOn) { puck.setLngLat(p).addTo(map); puckOn = true; puckCur = p; }
  if (brg != null) puck.setRotation(brg);
  const from = puckCur || p, t0 = performance.now(), dur = 900, tok = ++puckAnim;
  const step = now => {
    if (tok !== puckAnim) return;
    const k = Math.min(1, (now - t0) / dur);
    puckCur = [from[0] + (p[0] - from[0]) * k, from[1] + (p[1] - from[1]) * k];
    puck.setLngLat(puckCur);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
// poslední známá poloha hned po spuštění (šedě, dokud nepřijde čerstvá)
if (lp && Date.now() - lp.t < 14 * 864e5) { setPuck([lp.lon, lp.lat], null); puckEl.classList.add('stale'); }

// Poloha se čte sama: rychlý odhad ze sítě, pak GPS. Při chybě nižší přesnost a opakování,
// mezitím aspoň přibližně podle IP. Když je zakázaná, panel řekne přesně, kde ji zapnout.
const geo = { watch: null, retry: null, low: false, perm: null, got: false, ipTried: false, lastAt: 0, boot: Date.now() };
const UA = navigator.userAgent;
const inApp = /FBAN|FBAV|Instagram|Messenger|TikTok|musical_ly|Snapchat|Line\/|; wv\)/.test(UA);
const isAndroid = /Android/.test(UA), isMac = /Macintosh/.test(UA) && !isIOS;

function startGPS() {
  if (!('geolocation' in navigator)) return setGeo('none');
  if (!isSecureContext) return setGeo('insecure');
  if (geo.watch != null) navigator.geolocation.clearWatch(geo.watch);
  geo.watch = navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy: !geo.low, maximumAge: 1000, timeout: 20000 });
  if (!geo.got) navigator.geolocation.getCurrentPosition(onPos, () => { }, { enableHighAccuracy: false, maximumAge: 300000, timeout: 10000 });
  if (st.geo !== 'ok') setGeo('wait');
}
function onPos(p) {
  if (st.realFix && p.timestamp < st.realFix.t) return; // starší odhad dorazil po čerstvém fixu
  const c = p.coords;
  clearTimeout(geo.retry);
  geo.got = true; geo.lastAt = Date.now();
  if (geo.low) { geo.low = false; startGPS(); } // první fix je tu, zpátky na plnou přesnost
  st.realFix = { lon: c.longitude, lat: c.latitude, speed: c.speed, heading: c.heading, acc: c.accuracy, t: p.timestamp };
  if (st.geo !== 'ok') setGeo('ok');
  if (!st.sim) handleFix({ ...st.realFix });
}
function onPosErr(err) {
  if (err.code === 1) {
    if (geo.watch != null) navigator.geolocation.clearWatch(geo.watch);
    geo.watch = null; setGeo('denied'); approxFromIP(); return;
  }
  if (geo.got && Date.now() - geo.lastAt < 60000) return; // krátký výpadek, třeba tunel
  setGeo(geo.got ? 'lost' : err.code === 3 ? 'slow' : 'unavail');
  if (!geo.got) approxFromIP();
  clearTimeout(geo.retry);
  geo.retry = setTimeout(() => { geo.low = !geo.low; startGPS(); }, geo.low ? 12000 : 1500);
}
function setGeo(s) { st.geo = s; renderGeo(); }
(async () => {
  try {
    const s = await navigator.permissions.query({ name: 'geolocation' });
    geo.perm = s.state;
    s.onchange = () => { geo.perm = s.state; if (s.state === 'granted') { geo.low = false; startGPS(); } renderGeo(); };
    renderGeo();
  } catch { }
})();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && (st.geo !== 'ok' || Date.now() - geo.lastAt > 20000)) { geo.low = false; startGPS(); }
});
setTimeout(() => renderGeo(), 3200);
setInterval(() => {
  puckEl.classList.toggle('stale', !st.sim && (!geo.lastAt || Date.now() - geo.lastAt > 30000));
  if (geo.got && st.geo === 'ok' && Date.now() - geo.lastAt > 45000 && (st.mode === 'nav' || st.mode === 'drive')) setGeo('lost');
}, 5000);

async function approxFromIP() {
  if (st.pos || geo.ipTried) return;
  geo.ipTried = true;
  try {
    const j = await (await fetch('https://get.geojs.io/v1/ip/geo.json')).json();
    const lon = +j.longitude, lat = +j.latitude;
    if (!isFinite(lon) || !isFinite(lat) || st.pos) return;
    const CITY = { Prague: 'Praha', Pilsen: 'Plzeň', 'Ceske Budejovice': 'České Budějovice', 'Usti nad Labem': 'Ústí nad Labem', 'Hradec Kralove': 'Hradec Králové', Pardubice: 'Pardubice', Liberec: 'Liberec', Zlin: 'Zlín', Jihlava: 'Jihlava', 'Karlovy Vary': 'Karlovy Vary', Brno: 'Brno', Ostrava: 'Ostrava', Olomouc: 'Olomouc' };
    st.approx = { lon, lat, city: j.country_code === 'CZ' ? CITY[j.city] || j.city || '' : '' };
    if (!lp && st.mode === 'home') map.jumpTo({ center: [lon, lat], zoom: 11.5 });
    renderGeo();
  } catch { }
}

const GEO_HELP = {
  denied: () => isIOS ? (standalone()
    ? 'V iPhonu: Nastavení → Soukromí a zabezpečení → Polohové služby → Weby v Safari → <b>Při používání</b>.'
    : 'V Safari klepněte na <b>aA</b> vlevo v adresním řádku → Nastavení webu → Poloha → <b>Povolit</b>. Nebo Nastavení → Soukromí → Polohové služby → Weby v Safari.')
    : isAndroid ? 'Klepněte na ikonu vlevo od adresy → <b>Oprávnění</b> → Poloha → <b>Povolit</b>. A zkontrolujte, že je v telefonu Poloha zapnutá.'
      : isMac ? 'Klepněte na ikonu vlevo od adresy → Poloha → <b>Povolit</b>. Když ani pak nic: Nastavení systému → Soukromí a zabezpečení → <b>Polohové služby</b> → povolit prohlížeč.'
        : 'Klepněte na ikonu zámku vlevo od adresy → Poloha → <b>Povolit</b>.',
  off: () => isIOS ? 'Zapněte <b>Polohové služby</b>: Nastavení → Soukromí a zabezpečení → Polohové služby.'
    : isAndroid ? 'Zapněte <b>Polohu</b> v horní liště telefonu (stáhněte ji prstem dolů).'
      : isMac ? 'Nastavení systému → Soukromí a zabezpečení → <b>Polohové služby</b> → zapnout a povolit prohlížeč.'
        : 'Zapněte polohu v nastavení systému a povolte ji prohlížeči.',
};
function geoCardHTML() {
  const s = st.geo;
  if (s === 'ok' || s === 'lost') return '';
  const early = Date.now() - geo.boot < 3000;
  if (s === 'wait' && early && geo.perm !== 'prompt') return '';
  const approx = st.approx ? `<span class="geo__approx">Zatím ukazuju přibližně podle sítě${st.approx.city ? ': ' + esc(st.approx.city) : ''}.</span>` : '';
  const app = inApp ? `<p>Vestavěný prohlížeč polohu často blokuje. Otevřete odkaz v <b>${isIOS ? 'Safari' : 'Chrome'}</b> (menu ⋯ → Otevřít v prohlížeči).</p>` : '';
  let ic = 'locate', t, p, btn = 'Zkusit znovu', cls = '';
  if (s === 'wait') { t = geo.perm === 'prompt' ? 'Povolte prosím polohu' : 'Hledám, kde jste…'; p = geo.perm === 'prompt' ? 'Prohlížeč se ptá, jestli smí navigace znát polohu. Bez ní nepojede.' : 'Venku pod širým nebem to jde rychleji.'; btn = geo.perm === 'prompt' ? 'Povolit polohu' : ''; cls = 'wait'; }
  else if (s === 'denied') { t = 'Poloha je zakázaná'; p = GEO_HELP.denied(); cls = 'bad'; }
  else if (s === 'unavail' || s === 'slow') { t = 'Telefon zatím neví, kde je'; p = GEO_HELP.off(); }
  else { t = 'Tady poloha nejde'; p = s === 'insecure' ? 'Aplikace musí běžet přes https.' : 'Tenhle prohlížeč polohu nepodporuje. Zkuste Safari nebo Chrome.'; btn = ''; cls = 'bad'; }
  return `<div class="geo ${cls}"><span class="geo__ic">${s === 'wait' ? '<span class="spinner"></span>' : icon(ic)}</span><div class="geo__t"><b>${t}</b><p>${p}</p>${app}${approx}</div>${btn ? `<button class="btn sm" data-act="geo">${btn}</button>` : ''}</div>`;
}
function renderGeo() {
  const el = document.getElementById('geoCard');
  if (el) { const h = geoCardHTML(); if (el.dataset.h !== h) { el.dataset.h = h; el.innerHTML = h; } }
  renderStatus();
}

let firstFix = true, lpSaved = 0;
function handleFix(fix) {
  const prev = st.lastFix, here = [fix.lon, fix.lat];
  const moved = prev ? dist([prev.lon, prev.lat], here) : 0, dt = prev ? (fix.t - prev.t) / 1000 : 0;
  if (fix.speed == null || isNaN(fix.speed)) fix.speed = dt > 0 && moved > (fix.acc || 10) * 0.5 ? Math.min(70, moved / dt) : 0;
  if (fix.heading == null || isNaN(fix.heading)) fix.heading = moved > 4 ? bearing([prev.lon, prev.lat], here) : st.heading;
  st.lastFix = fix; st.pos = here; st.speed = fix.speed * 3.6; if (fix.heading != null) st.heading = fix.heading;
  st.approx = null;
  if (rec.active) rec.add(fix);
  if (!fix.sim && Date.now() - lpSaved > 15000) { lpSaved = Date.now(); lastPos.set({ lon: fix.lon, lat: fix.lat, t: Date.now() }); }
  if (firstFix) {
    firstFix = false; setFollow(true);
    if (st.mode === 'home') {
      const far = dist(map.getCenter().toArray(), here) > 30000;
      far ? map.jumpTo({ center: here, zoom: 14.5, padding: homePad() }) : map.easeTo({ center: here, zoom: Math.max(14.5, map.getZoom()), padding: homePad(), duration: 700 });
    }
    ensureTraffic([here]).catch(() => { });
    if (st.mode === 'home') renderHome();
  }
  if (st.nav) { st.nav.feed(fix); return; }
  setPuck(here, st.heading);
  drawAcc(fix);
  refreshLimit(fix);
  updateSpeedo(st.speed, st.limit, st.limitKnown);
  driveTick(fix);
  if (st.follow && st.mode === 'drive') {
    const v = st.speed, z = v < 40 ? 16.6 : v < 70 ? 16 : v < 100 ? 15.4 : 14.8;
    map.easeTo({ center: here, bearing: st.heading ?? map.getBearing(), pitch: 50, zoom: z, duration: 950, easing: t => t, padding: drivePad() });
  } else if (st.follow && st.mode === 'home') map.easeTo({ center: here, duration: 900, easing: t => t, padding: homePad(), ...(st.speed > 15 ? { bearing: st.heading || 0 } : {}) });
  if ($('hud') && !$('hud').hidden) updateHud();
}
function drivePad() {
  if (innerWidth >= 720) return { top: Math.round(innerHeight * 0.4), bottom: 0, left: 0, right: sheetEl.offsetWidth + 16 };
  return { top: Math.round(innerHeight * 0.4), bottom: sheetEl.offsetHeight, left: 0, right: 0 };
}
// kruh přesnosti, jen když poloha není přesná
function drawAcc(fix) {
  const show = fix.acc > 30 && fix.acc < 5000 && st.mode !== 'nav';
  if (show) {
    const ring = [];
    for (let i = 0; i <= 48; i++) ring.push(dest([fix.lon, fix.lat], i * 7.5, fix.acc));
    setData('acc', fc([{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} }]));
  } else if (srcData.acc && srcData.acc.features.length) setData('acc', fc([]));
}

// limit a název silnice při jízdě bez trasy
const limQ = { t: 0, p: null, busy: false };
async function refreshLimit(fix) {
  if (limQ.busy || fix.speed < 2.5) return;
  const p = [fix.lon, fix.lat];
  if (Date.now() - limQ.t < 5000 || (limQ.p && dist(limQ.p, p) < 120)) return;
  limQ.busy = true; limQ.t = Date.now(); limQ.p = p;
  try {
    const r = await locateLimit(p, fix.heading);
    if (r) { st.limit = r.limit; st.limitKnown = r.known; st.road = r.name; const el = $('driveRoad'); if (el && r.name) el.textContent = r.name; }
  } catch { } finally { limQ.busy = false; }
}

function updateSpeedo(kmh, limit, known = true) {
  const show = st.mode === 'nav' || st.mode === 'drive' || kmh > 4;
  $('speedo').hidden = !show;
  if (!show) return;
  $('speedVal').textContent = Math.round(kmh);
  $('limitSign').hidden = !limit;
  if (limit) $('limitVal').textContent = limit;
  $('limitSign').classList.toggle('unknown', !known);
  $('speedo').classList.toggle('over', !!limit && kmh > limit + (S.overTol || 0));
}

// ---------- jízda bez cíle ----------
// Rozjedete se bez trasy → aplikace sama přepne do jízdního pohledu a hlídá, co je před vámi.
let fastFixes = 0, overN = 0, overSaid = 0;
const said = new Map();
function driveTick(fix) {
  if (st.mode !== 'drive') {
    const can = st.mode === 'home' && $('page').hidden && !fix.sim && Date.now() - (st.driveOff || 0) > 600000;
    fastFixes = can && st.speed >= 20 ? fastFixes + 1 : 0;
    if (fastFixes >= 3) enterDrive();
    return;
  }
  const d = st.drive;
  if (d.prev) d.km += dist(d.prev, st.pos) / 1000;
  d.prev = st.pos; d.max = Math.max(d.max, st.speed);
  if (st.speed < 5) { d.slow = d.slow || Date.now(); if (Date.now() - d.slow > 120000) { exitDrive(); return; } } else d.slow = 0;
  if (S.driveAlerts) driveAlerts(fix);
  if (S.warnOver && st.limitKnown && st.limit) {
    overN = st.speed > st.limit + (S.overTol || 0) + 2 ? overN + 1 : 0;
    if (overN >= 3 && Date.now() - overSaid > 60000) { overSaid = Date.now(); onOver(); }
  }
  const s = $('driveStats'); if (s) s.innerHTML = driveStats();
}
function driveAlerts(fix) {
  const list = lookAhead(st.pos, st.heading, fix.speed || 0, reports, { cams: S.warnCams, bumps: S.warnBumps, traffic: S.warnTraffic });
  const now = Date.now();
  for (const h of list) {
    if (said.has(h.key) && now - said.get(h.key) < 600000) continue;
    said.set(h.key, now);
    if (S.voiceAlerts) voice.say(voice.phraseAlert(h.kind, h.d, { ms: h.ms, text: h.rep && h.rep.label }), { priority: 1 });
    if (['cam', 'police', 'accident', 'closure'].includes(h.kind) || (h.rep && h.rep.type === 'mcam')) navigator.vibrate && navigator.vibrate(40);
  }
  showHazard(list[0]);
}
function enterDrive() {
  st.mode = 'drive'; st.drive = { t0: Date.now(), km: 0, max: 0, slow: 0, prev: st.pos };
  fastFixes = 0; overN = 0;
  setBody(); setFollow(true); wake(true);
  if (S.record && !rec.active) startRec(true);
  renderDrive();
  toast({ icon: 'speed', title: 'Jízda bez cíle', sub: 'Hlídám radary, policii a kolony před vámi.', ms: 3500 });
}
function exitDrive(manual = false) {
  if (manual) st.driveOff = Date.now();
  st.drive = null; showHazard(null); clearAsk(); wake(false);
  if (rec.active && rec.auto) stopRec();
  renderHome(); setFollow(true);
  map.easeTo({ pitch: 0, bearing: 0, zoom: 15, padding: homePad(), duration: 700, ...(st.pos ? { center: st.pos } : {}) });
}
function driveStats() {
  const d = st.drive; if (!d) return '';
  return `<div class="stat"><b>${shortTime((Date.now() - d.t0) / 1000)}</b><span>na cestě</span></div><div class="stat"><b>${d.km < 10 ? d.km.toFixed(1).replace('.', ',') : Math.round(d.km)} km</b><span>ujeto</span></div><div class="stat"><b>${Math.round(d.max)}</b><span>max km/h</span></div>`;
}
function renderDrive() {
  sheet(`
    <div class="drivebar peek">
      <div class="drivebar__road"><span class="label">Jízda bez cíle</span><b id="driveRoad">${esc(st.road || 'Jedeme')}</b></div>
      <button class="round flat" data-act="search" aria-label="Kam jedeme">${icon('search')}</button>
      <button class="round flat" data-act="report" aria-label="Nahlásit">${icon('flagplus')}</button>
      <button class="round flat" data-act="driveend" aria-label="Ukončit">${icon('close')}</button>
    </div>
    <div class="stat-grid three" id="driveStats">${driveStats()}</div>
    <div class="nav-actions">
      <button class="${rec.active ? 'on' : ''}" data-act="rec">${icon('trips')}${rec.active ? 'Nahrávám' : 'Nahrávat'}</button>
      <button data-act="near" data-k="fuel">${icon('fuel')}Pumpa</button>
      <button data-act="near" data-k="food">${icon('food')}Jídlo</button>
      <button data-act="mute">${icon(S.muted ? 'mute' : 'volume')}Hlas</button>
      <button data-act="hud">${icon('hud')}HUD</button>
    </div>`, 'drive', true);
}

// ---------- co je před námi (karta nad rychloměrem) ----------
const HZ = { cam: ['cam', 'Radar'], secStart: ['speed', 'Úsekové měření'], secIn: ['speed', 'V úsekovém měření'], bump: ['bump', 'Zpomalovací práh'] };
function hazardInfo(h) {
  if (h.rep) {
    const R = reportType(h.rep.type) || REPORT_TYPES[0];
    return { ic: R.icon, title: R.label, sub: `${h.rep.mine ? 'vaše hlášení' : 'od řidičů'} · ${ago(h.rep.t)}${h.rep.up > 1 ? ` · ${h.rep.up}× potvrzeno` : ''}`, danger: ['police', 'mcam', 'accident'].includes(h.rep.type) };
  }
  if (h.ev) return { ic: KIND_ICON[h.ev.kind] || 'hazard', title: evName(h.ev), sub: [h.ev.road, h.ev.loc].filter(Boolean).join(' · '), danger: h.ev.kind !== 'jam' };
  const [ic, title] = HZ[h.kind] || ['hazard', 'Pozor'];
  return { ic, title, sub: h.kind === 'secIn' ? 'držte průměr pod limitem' : h.kind === 'cam' ? 'pevný radar' : h.kind === 'secStart' ? 'měří se průměrná rychlost' : '', danger: h.kind === 'cam' || h.kind === 'secStart', ms: h.ms };
}
let askT = null;
function showHazard(h) {
  const el = $('hazard'), prev = st.hazard;
  if (!h) {
    st.hazard = null;
    if (prev && prev.rep && prev.d < 250 && canVote(prev.rep.id)) askVote(prev.rep);
    else if (!st.ask) el.hidden = true;
    return;
  }
  if (st.ask) clearAsk();
  if (!prev || prev.key !== h.key) {
    const I = hazardInfo(h);
    el.className = 'hazard' + (I.danger ? ' danger' : '');
    el.innerHTML = `<span class="hz__ic">${icon(I.ic)}</span><div class="hz__t"><b>${esc(I.title)}</b>${I.sub ? `<span>${esc(I.sub)}</span>` : ''}</div>${I.ms ? `<span class="limit sm">${I.ms}</span>` : ''}<b class="hz__d" id="hzD"></b><i class="hz__bar"><i id="hzBar"></i></i>`;
    st.hazard = { key: h.key, d0: Math.max(h.d, 150), rep: h.rep };
  }
  st.hazard.d = h.d;
  el.hidden = false;
  $('hzD').textContent = h.kind === 'secIn' ? 'ještě ' + fmtDist(h.d) : fmtDist(h.d);
  $('hzBar').style.transform = `scaleX(${Math.max(0.02, Math.min(1, 1 - h.d / st.hazard.d0))})`;
}
function askVote(rep) {
  const R = reportType(rep.type) || REPORT_TYPES[0], el = $('hazard');
  st.ask = rep;
  el.className = 'hazard ask'; el.hidden = false;
  el.innerHTML = `<span class="hz__ic">${icon(R.icon)}</span><div class="hz__t"><b>${R.label} pořád tam?</b><span>Pomůžete ostatním</span></div><button class="hz__btn" data-act="vote" data-id="${esc(rep.id)}" data-v="1">Ano</button><button class="hz__btn no" data-act="vote" data-id="${esc(rep.id)}" data-v="-1">Ne</button>`;
  clearTimeout(askT); askT = setTimeout(clearAsk, 14000);
}
function clearAsk() { st.ask = null; clearTimeout(askT); if (!st.hazard) $('hazard').hidden = true; }

// ---------- stavový řádek nahoře (nahrávání, signál) ----------
let recTimer = null;
function renderStatus() {
  const el = $('status'), items = [];
  if (rec.active) { const s = Math.round((Date.now() - rec.trip.start) / 1000); items.push(`<button class="pill rec" data-act="recstop" aria-label="Zastavit nahrávání"><i></i>${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}</button>`); }
  if (st.geo === 'lost' && (st.mode === 'nav' || st.mode === 'drive')) items.push(`<span class="pill warn">${icon('locate')}Slabý signál GPS</span>`);
  const h = items.join('');
  if (el.dataset.h !== h) { el.dataset.h = h; el.innerHTML = h; }
  el.hidden = !items.length;
}

// ---------- panel ----------
const sheetEl = $('sheet'), sheetBody = $('sheetBody');
// collapsed: při přepnutí do jiného režimu panel sbalit/rozbalit, při překreslení stejného nechat, jak ho má uživatel
function sheet(html, mode = st.mode, collapsed = false) {
  if (sheetEl.dataset.mode !== mode) sheetEl.classList.toggle('collapsed', collapsed);
  sheetEl.dataset.mode = mode;
  sheetBody.innerHTML = html;
  hydrateIcons(sheetBody);
}
new ResizeObserver(() => document.documentElement.style.setProperty('--sheet-h', sheetEl.offsetHeight + 8 + 'px')).observe(sheetEl);
new ResizeObserver(() => document.documentElement.style.setProperty('--man-h', $('maneuver').offsetHeight + 'px')).observe($('maneuver'));
const toggleSheet = open => { sheetEl.classList.toggle('collapsed', open === undefined ? undefined : !open); sheetBody.scrollTop = 0; };
// tažení panelu prstem za úchyt nebo horní část
{
  let y0 = null, dy = 0, drag = false;
  sheetEl.addEventListener('pointerdown', e => {
    if (e.button > 0 || !e.target.closest('.sheet__grip, .peek') || e.target.closest('input, .shortcuts')) return;
    if (!sheetEl.classList.contains('collapsed') && sheetBody.scrollTop > 4 && !e.target.closest('.sheet__grip')) return;
    y0 = e.clientY; dy = 0; drag = false;
  });
  addEventListener('pointermove', e => {
    if (y0 == null) return;
    dy = e.clientY - y0;
    if (!drag && Math.abs(dy) > 8) { drag = true; sheetEl.classList.add('dragging'); }
    if (drag) {
      const col = sheetEl.classList.contains('collapsed');
      const t = col ? (dy < 0 ? dy * 0.35 : dy * 0.15) : (dy > 0 ? dy : dy * 0.15);
      sheetEl.style.transform = `translateY(${t}px)`;
    }
  });
  const end = () => {
    if (y0 == null) return;
    y0 = null; sheetEl.classList.remove('dragging'); sheetEl.style.transform = '';
    if (!drag) return;
    // tažení nesmí zároveň kliknout na tlačítko pod prstem
    addEventListener('click', ev => { ev.stopPropagation(); ev.preventDefault(); }, { capture: true, once: true });
    setTimeout(() => { drag = false; }, 0);
    if (dy > 40) toggleSheet(false); else if (dy < -40) toggleSheet(true);
  };
  addEventListener('pointerup', end); addEventListener('pointercancel', end);
}
$('sheetGrip').onclick = () => toggleSheet();

function setBody() {
  for (const m of ['nav', 'drive', 'plan', 'joy', 'home']) document.body.classList.toggle(m, st.mode === m);
  $('maneuver').hidden = st.mode !== 'nav';
  if (st.mode !== 'nav') $('pace').hidden = true;
  if (st.mode !== 'nav' && st.mode !== 'drive') { showHazard(null); clearAsk(); }
  if (map) applyVisibility();
  renderStatus();
}

let toastT = null;
function toast({ icon: ic = 'info', title, sub = '', danger = false, ms = 4200 }) {
  const el = $('toast');
  el.innerHTML = `<span class="toast__ic ${danger ? 'danger' : ''}">${icon(ic)}</span><div><b>${esc(title)}</b>${sub ? `<div class="toast__sub">${esc(sub)}</div>` : ''}</div>`;
  el.hidden = false; el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, ms);
}
$('toast').onclick = () => { $('toast').hidden = true; };

// malé okno zespodu nad mapou (hlášení, detail hlášení)
function modal(html) {
  $('modalCard').innerHTML = `<i class="modal__grip"></i>${html}`;
  hydrateIcons($('modalCard'));
  $('modal').hidden = false;
}
function closeModal() { $('modal').hidden = true; $('modalCard').innerHTML = ''; }
$('modal').addEventListener('click', e => { if (e.target.id === 'modal' || e.target.classList.contains('modal__scrim')) closeModal(); });

// ---------- domovská obrazovka ----------
function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Dobrou <em>noc</em>' : h < 10 ? 'Dobré <em>ráno</em>' : h < 18 ? 'Dobrý <em>den</em>' : 'Dobrý <em>večer</em>';
}
function trafficMeta() {
  const n = traffic.events.filter(e => e.kind !== 'info').length, r = reports.length;
  const rp = r ? ` · ${r} ${pl(r, 'hlášení', 'hlášení', 'hlášení')} od řidičů` : '';
  if (traffic.loading && !n) return 'načítám dopravu…';
  if (n) return `${n} ${pl(n, 'událost', 'události', 'událostí')} v dopravě${rp}`;
  return (traffic.error ? 'doprava nedostupná' : 'na silnicích klid') + rp;
}
let installEvt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (st.mode === 'home') renderHome(); });
function installHint() {
  if (standalone()) return '';
  if (installEvt) return `<div class="install">${icon('download')}<div><b>Nainstalujte si Navigaci</b><span>Poběží přes celou obrazovku jako běžná aplikace.</span></div><button class="btn sm" data-act="install">Instalovat</button></div>`;
  if (isIOS) return `<div class="install">${icon('share')}<div><b>Do iPhonu jako aplikace</b><span>V Safari klepněte na Sdílet a pak Přidat na plochu.</span></div></div>`;
  return '';
}
function placeShort(p) { return p ? p.name : 'Nastavit'; }
function placeSub(p) { return p ? (st.pos ? fmtDist(dist(st.pos, [p.lon, p.lat])) : esc(p.name)) : 'nastavit'; }
function renderHome() {
  st.mode = 'home'; setBody();
  const pk = parking.get();
  const sc = (act, ic, t, sub = '', extra = '', cls = '') => `<button class="sc ${cls}" data-act="${act}" ${extra}><span class="sc__ic">${icon(ic)}</span><b>${t}</b>${sub ? `<small>${sub}</small>` : ''}</button>`;
  sheet(`
    <div class="peek home-top">
      <div class="hello"><h1>${greeting()}</h1><span class="meta" id="homeMeta">${trafficMeta()}</span></div>
      <div class="searchrow">
        <button class="search-pill" data-act="search">${icon('search')}<span class="search-pill__text">Kam jedeme?</span></button>
        <button class="round flat" data-act="settings" aria-label="Nastavení">${icon('sliders')}</button>
      </div>
      <div id="geoCard">${geoCardHTML()}</div>
      <div class="shortcuts">
        ${sc('joy', 'joy', 'Joy ride', 'projížďka', '', 'hero')}
        ${sc('place', 'home', 'Domů', placeSub(places.home), 'data-k="home"')}
        ${sc('place', 'work', 'Práce', placeSub(places.work), 'data-k="work"')}
        ${sc('near', 'fuel', 'Pumpa', 'v okolí', 'data-k="fuel"')}
        ${sc('near', 'food', 'Jídlo', 'v okolí', 'data-k="food"')}
        ${sc('near', 'parking', 'Parkování', 'v okolí', 'data-k="parking"')}
        ${sc('near', 'coffee', 'Kafe', 'v okolí', 'data-k="coffee"')}
        ${sc('rec', 'trips', rec.active ? 'Nahrávám' : 'Nahrát', rec.active ? 'zastavit' : 'jízdu', '', rec.active ? 'on' : '')}
      </div>
    </div>
    ${installHint()}
    ${recents.length ? `<div class="section-h"><span class="label">Nedávné</span></div><div class="list">${recents.slice(0, 4).map((r, i) => placeRow(r, 'recent', i, 'clock')).join('')}</div>` : ''}
    ${places.fav.length ? `<div class="section-h"><span class="label">Oblíbené</span></div><div class="list">${places.fav.slice(0, 5).map((r, i) => placeRow(r, 'fav', i, 'star')).join('')}</div>` : ''}
    <div class="section-h"><span class="label">Další</span></div>
    <div class="list">
      <button class="row" data-act="trips">${icon('trips')}<div class="row__t"><b>Moje jízdy</b><span>Nahrané trasy, rychlosti, export GPX</span></div>${icon('chevron')}</button>
      ${pk ? `<button class="row" data-act="parkshow">${icon('parking')}<div class="row__t"><b>Zaparkované auto</b><span>${ago(pk.t)}${st.pos ? ' · ' + fmtDist(dist(st.pos, [pk.lon, pk.lat])) : ''}</span></div>${icon('chevron')}</button>` : ''}
      <button class="row" data-act="layers">${icon('layers')}<div class="row__t"><b>Mapa a vzhled</b><span>${THEMES[S.theme].name} · doprava, radary, prahy</span></div>${icon('chevron')}</button>
    </div>
    <p class="note-text">Tip: když se rozjedete bez cíle, navigace sama přepne do jízdy a hlídá radary, policii a kolony před vámi.</p>`, 'home', true);
}
function placeRow(p, act, i, ic = 'pin') {
  return `<button class="row" data-act="${act}" data-i="${i}">${icon(ic)}<div class="row__t"><b>${esc(p.name)}</b><span>${esc(p.sub || '')}</span></div><span class="row__end">${p.d != null ? fmtDist(p.d) : st.pos ? fmtDist(dist(st.pos, [p.lon, p.lat])) : ''}</span></button>`;
}

// ---------- v okolí ----------
const NEAR = { fuel: ['Pumpy v okolí', '[fuel]', 'fuel', 'Čerpací stanice'], food: ['Kde se najíst', 'restaurace', 'food', 'Restaurace'], parking: ['Parkování', '[parking]', 'parking', 'Parkoviště'], coffee: ['Kavárny', 'kavárna', 'coffee', 'Kavárna'] };
let nearList = [];
async function nomBox(q, box, limit = 40) {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=${limit}&viewbox=${box.join(',')}&bounded=1&addressdetails=1&accept-language=cs&countrycodes=cz`);
  if (!r.ok) throw new Error('nominatim ' + r.status);
  return (await r.json()).map(x => {
    const a = x.address || {}, city = a.city || a.town || a.village || a.municipality || '';
    const street = a.road ? `${a.road}${a.house_number ? ' ' + a.house_number : ''}` : '';
    return { name: x.name || '', sub: [street, city].filter(Boolean).join(', '), lon: +x.lon, lat: +x.lat };
  });
}
async function openNearby(k) {
  const [title, q, ic, generic] = NEAR[k];
  const c = st.pos || (st.approx && [st.approx.lon, st.approx.lat]) || map.getCenter().toArray();
  page(title, `<div class="progress"><span class="spinner"></span>Hledám nejbližší…</div>`);
  pageRender = null;
  try {
    let list = [];
    for (const r of [0.03, 0.09, 0.25]) {
      list = await nomBox(q, [c[0] - r * 1.5, c[1] + r, c[0] + r * 1.5, c[1] - r]);
      if (list.length >= 4) break;
      await sleep(1000);
    }
    if ($('page').hidden || $('pageTitle').textContent !== title) return;
    nearList = list.map(p => ({ ...p, name: p.name || generic, d: dist(c, [p.lon, p.lat]) })).sort((a, b) => a.d - b.d).slice(0, 25);
    $('pageBody').innerHTML = nearList.length
      ? `<p class="note-text" style="margin-top:0">${st.pos ? 'Seřazeno podle vzdálenosti vzdušnou čarou.' : 'Poloha zatím není známá, hledám kolem středu mapy.'}</p><div class="list">${nearList.map((p, i) => placeRow(p, 'nearpick', i, ic)).join('')}</div>`
      : `<div class="empty"><b>Nic poblíž</b>V okolí jsme nic nenašli. Zkuste hledání podle názvu.</div>`;
    hydrateIcons($('pageBody'));
  } catch {
    $('pageBody').innerHTML = `<div class="empty"><b>Hledání nejde</b>Zkontrolujte připojení k internetu.</div>`;
  }
}

// ---------- celoobrazovkové stránky ----------
let pageBackFn = null, pageRender = null;
function page(title, html, back = null) {
  $('pageTitle').textContent = title;
  $('pageBody').innerHTML = html;
  hydrateIcons($('pageBody'));
  $('page').hidden = false;
  pageBackFn = back;
}
function closePage() { $('page').hidden = true; $('pageBody').innerHTML = ''; pageRender = null; }
$('pageBack').onclick = () => pageBackFn ? pageBackFn() : closePage();
function rerenderPage() { if (!pageRender) return; const y = $('pageBody').scrollTop; pageRender(); $('pageBody').scrollTop = y; }

// ---------- hledání ----------
let searchPurpose = 'dest', searchResults = [], searchCtl = null, searchT = null;
function openSearch(purpose = 'dest') {
  searchPurpose = purpose;
  const title = { dest: 'Kam jedeme?', home: 'Kde bydlíte?', work: 'Kde pracujete?', stop: 'Přidat zastávku' }[purpose];
  page(title, `
    <div class="field">${icon('search')}<input id="q" type="search" placeholder="Adresa, místo, firma…" autocomplete="off" autocorrect="off" enterkeyhint="search"></div>
    ${purpose === 'dest' ? `<div class="quick">
      <button data-act="place" data-k="home">${icon('home')}<b>Domů</b><span>${esc(placeShort(places.home))}</span></button>
      <button data-act="place" data-k="work">${icon('work')}<b>Práce</b><span>${esc(placeShort(places.work))}</span></button>
      <button data-act="joy">${icon('joy')}<b>Joy ride</b><span>Projížďka</span></button>
    </div>` : ''}
    <div class="list" id="results">${searchDefault()}</div>
    <p class="note-text">Tip: cíl vyberete i dlouhým podržením prstu na mapě.</p>`);
  const q = $('q');
  q.addEventListener('input', () => { clearTimeout(searchT); searchT = setTimeout(() => runSearch(q.value.trim()), 220); });
  q.addEventListener('keydown', e => { if (e.key === 'Enter' && searchResults[0]) pickResult(searchResults[0]); });
  setTimeout(() => q.focus(), 60);
}
function searchDefault() {
  const favs = places.fav.map((p, i) => placeRow(p, 'fav', i, 'star')).join('');
  return favs + recents.map((r, i) => placeRow(r, 'recent', i, 'clock')).join('');
}
function placeFromPhoton(f) {
  const p = f.properties, [lon, lat] = f.geometry.coordinates;
  const street = p.street ? `${p.street}${p.housenumber ? ' ' + p.housenumber : ''}` : '';
  const city = p.city || p.town || p.village || p.locality || p.district || '';
  const name = p.name || street || city || 'Místo';
  const sub = [p.name && street ? street : '', city !== name ? city : '', p.county].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(', ');
  return { name, sub, lon, lat };
}
async function runSearch(q) {
  const box = $('results'); if (!box) return;
  if (q.length < 2) { searchResults = []; box.innerHTML = searchDefault(); hydrateIcons(box); return; }
  searchCtl && searchCtl.abort(); searchCtl = new AbortController();
  const bias = st.pos || map.getCenter().toArray();
  try {
    try {
      const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lang=default&limit=10&bbox=12.0,48.5,18.9,51.1&lat=${bias[1]}&lon=${bias[0]}`, { signal: searchCtl.signal });
      if (!r.ok) throw new Error('photon ' + r.status);
      const j = await r.json();
      searchResults = j.features.filter(f => !f.properties.countrycode || f.properties.countrycode === 'CZ').map(placeFromPhoton);
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      searchResults = await nominatim(q, searchCtl.signal);
    }
    box.innerHTML = searchResults.length ? searchResults.map((p, i) => placeRow(p, 'result', i)).join('') : `<div class="empty"><b>Nic jsme nenašli</b>Zkuste jiný tvar adresy nebo název obce.</div>`;
  } catch (e) {
    if (e.name === 'AbortError') return;
    box.innerHTML = `<div class="empty"><b>Hledání nejde</b>Zkontrolujte připojení k internetu.</div>`;
  }
}
async function nominatim(q, signal) {
  await sleep(400); // Nominatim nesnese dotaz na každé písmeno
  const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&countrycodes=cz&limit=8&addressdetails=1&accept-language=cs`, { signal });
  const j = await r.json();
  return j.map(x => {
    const a = x.address || {}, city = a.city || a.town || a.village || a.municipality || '';
    const street = a.road ? `${a.road}${a.house_number ? ' ' + a.house_number : ''}` : '';
    const name = x.name || street || city || x.display_name.split(',')[0];
    return { name, sub: [street !== name ? street : '', city !== name ? city : ''].filter(Boolean).join(', ') || x.display_name.split(',').slice(1, 3).join(','), lon: +x.lon, lat: +x.lat };
  });
}
function pickResult(p) {
  if (searchPurpose === 'home' || searchPurpose === 'work') {
    places[searchPurpose] = p; savePlaces(); closePage();
    toast({ icon: searchPurpose, title: searchPurpose === 'home' ? 'Domov uložen' : 'Práce uložena', sub: p.name });
    if (st.mode === 'home') renderHome();
    return;
  }
  closePage();
  if (searchPurpose === 'stop' && st.stops.length >= 2) { st.stops.splice(st.stops.length - 1, 0, p); plan(); return; }
  goTo(p);
}

// ---------- plánování ----------
const PRIOS = [['fast', 'Nejrychlejší'], ['fun', 'Zábavná'], ['calm', 'Méně radarů'], ['short', 'Nejkratší']];
const BADGE = { fast: 'Nejrychlejší', fun: 'Nejvíc zatáček', calm: 'Nejklidnější', short: 'Nejkratší' };
const destMarkerEl = document.createElement('div');
destMarkerEl.className = 'pin-marker';
destMarkerEl.innerHTML = `<svg viewBox="0 0 34 44"><path d="M17 43s15-14.5 15-26A15 15 0 002 17c0 11.5 15 26 15 26z" style="fill:var(--accent);stroke:var(--panel-solid)" stroke-width="2"/><circle cx="17" cy="17" r="5.5" style="fill:var(--panel-solid)"/></svg>`;
const destMarker = new maplibregl.Marker({ element: destMarkerEl, anchor: 'bottom' });

function tempo() { return S.learnTempo && learned.samples > 300 ? Math.min(1.2, Math.max(0.85, learned.ratio)) : S.tempo; }
const prefs = () => ({ ...S, tempo: tempo(), sport: S.sport || st.rally });
function origin() {
  if (st.pos) return { name: 'Moje poloha', sub: '', lon: st.pos[0], lat: st.pos[1], here: true };
  const c = map.getCenter();
  return { name: 'Střed mapy', sub: 'poloha zatím není známá', lon: c.lng, lat: c.lat };
}
const locOf = p => Object.assign([p.lon, p.lat], p.here && st.speed > 10 && st.heading != null ? { heading: st.heading } : {});

function goTo(place) {
  addRecent(place);
  st.stops = [origin(), place];
  plan();
}

function sampleLine(pts, step = 15000) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const n = Math.max(1, Math.ceil(dist(pts[i], pts[i + 1]) / step));
    for (let k = 0; k <= n; k++) out.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k / n, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k / n]);
  }
  return out;
}
function sampleRoute(r, step = 15000) { const out = []; for (let s = 0; s < r.length; s += step) out.push(pointAt(r.coords, r.cum, s)); out.push(r.coords[r.coords.length - 1]); return out; }

async function plan() {
  st.planCtl && st.planCtl.abort();
  const ctl = st.planCtl = new AbortController();
  st.mode = 'plan'; setBody();
  st.routes = []; st.selR = null; st.userPicked = false; st.planError = null; st.planDone = false;
  setData('trip', fc([])); setData('stops', fc([]));
  const d = st.stops[st.stops.length - 1];
  destMarker.setLngLat([d.lon, d.lat]).addTo(map);
  drawRoutes(); renderPlan();
  const locs = st.stops.map(locOf);
  fitPoints(locs);
  // živá doprava podél cesty, ale čekat nanejvýš 2,5 s
  const tr = ensureTraffic(sampleLine(locs)).catch(() => { });
  await Promise.race([tr, sleep(2500)]);
  let fitted = false;
  try {
    await planRoutes(locs, prefs(), list => {
      if (ctl.signal.aborted) return;
      st.routes = list;
      if (!st.userPicked || !list.includes(st.selR)) st.selR = list[0];
      drawRoutes(); renderPlan();
      if (!fitted) { fitted = true; fitRoutes(list); }
    }, ctl.signal);
  } catch (e) {
    if (e.name === 'AbortError') return;
    st.planError = e.message || 'Trasu se nepodařilo najít';
  }
  if (ctl.signal.aborted) return;
  st.planDone = true;
  fitRoutes(st.routes);
  renderPlan();
  tr.then(() => { if (st.planCtl === ctl && st.mode === 'plan') reanalyze(); });
}

// přepočet modelu nad uloženými hranami (nová doprava, jiné tempo) bez dotazu na server
function reanalyze() {
  const list = st.mode === 'joy' ? st.joyRoutes : st.routes;
  if (!list || !list.length) return;
  for (const r of list) if (r.edges !== undefined) r.a = analyze(r, r.edges, prefs());
  if (st.mode === 'plan') { list.sort((x, y) => score(x, S.priority) - score(y, S.priority)); if (!st.userPicked) st.selR = list[0]; renderPlan(); }
  else renderJoy();
  drawRoutes();
}

function resort() {
  st.routes.sort((x, y) => score(x, S.priority) - score(y, S.priority));
  st.selR = st.routes[0]; st.userPicked = false;
  drawRoutes(); renderPlan();
}

function selectRoute(r) {
  st.selR = r; st.userPicked = true;
  drawRoutes();
  st.mode === 'joy' ? renderJoy() : renderPlan();
}

function jamFeatures(r, from = 0) {
  const a = r && r.a; if (!a) return fc([]);
  const out = []; let cur = null;
  for (let i = from; i < a.fcdV.length; i++) {
    const v = a.fcdV[i], ratio = v ? v / a.lim[i] : 1;
    const lvl = !v ? 0 : ratio < 0.3 ? 5 : ratio < 0.5 ? 4 : ratio < 0.72 ? 3 : 0;
    if (lvl && cur && cur.lvl === lvl) cur.c.push(r.coords[i + 1]);
    else if (lvl) { cur = { lvl, c: [r.coords[i], r.coords[i + 1]] }; out.push(cur); }
    else cur = null;
  }
  return fc(out.map(x => line(x.c, { lvl: x.lvl })));
}

function drawRoutes() {
  if (st.mode === 'nav') return;
  const list = st.mode === 'joy' ? (st.joyRoutes || []) : st.routes, sel = st.selR;
  const feats = list.map((r, i) => line(r.coords, { sel: r === sel ? 1 : 0, idx: i })).sort((a, b) => a.properties.sel - b.properties.sel);
  setData('routes', fc(feats));
  setData('routeJam', jamFeatures(sel));
  setData('routeLabels', fc(list.map((r, i) => point(labelPoint(r, list), { t: st.mode === 'joy' ? r.label : shortTime(r.a.time), sel: r === sel ? 1 : 0, idx: i }))));
  const stops = sel && sel.stops ? sel.stops.map(s => point(s.p, { kind: s.kind, name: s.name || '' })) : [];
  for (const p of st.mode === 'plan' ? st.stops.slice(1, -1) : []) stops.push(point([p.lon, p.lat], { kind: 'info', name: p.name }));
  setData('stops', fc(stops));
}
// štítek trasy tam, kde se nejvíc liší od ostatních
function labelPoint(r, list) {
  let best = null, bestD = -1;
  for (let f = 0.25; f <= 0.75; f += 0.05) {
    const p = pointAt(r.coords, r.cum, r.length * f);
    let dmin = Infinity;
    for (const o of list) if (o !== r) dmin = Math.min(dmin, project(o.coords, o.cum, p).d);
    if (list.length === 1) dmin = 0;
    if (dmin > bestD) { bestD = dmin; best = p; }
  }
  return best || pointAt(r.coords, r.cum, r.length / 2);
}

function pad() {
  const wide = innerWidth >= 720, top = 96;
  if (wide) return { top: 80, bottom: 60, left: 60, right: sheetEl.offsetWidth + 60 };
  return { top, bottom: Math.max(40, Math.min(sheetEl.offsetHeight + 24, innerHeight - top - 140)), left: 36, right: 36 };
}
function fitPoints(pts) {
  if (!pts.length) return;
  const b = new maplibregl.LngLatBounds(pts[0], pts[0]);
  for (const p of pts) b.extend(p);
  try { map.fitBounds(b, { padding: pad(), duration: 650, maxZoom: 15, bearing: 0, pitch: 0 }); } catch { }
}
function fitRoutes(list) {
  const pts = [];
  for (const r of list || []) for (let i = 0; i < r.coords.length; i += Math.max(1, Math.floor(r.coords.length / 200))) pts.push(r.coords[i]);
  if (pts.length) fitPoints(pts);
}

function funBars(score10) {
  const n = Math.round(score10 / 2);
  return `<span class="fun">${[0, 1, 2, 3, 4].map(i => `<i class="${i < n ? 'f' : ''}"></i>`).join('')}</span>`;
}
function viaName(r) {
  const tally = new Map();
  for (const m of r.maneuvers) {
    const n = (m.street || '').split(' / ')[0];
    if (n) tally.set(n, (tally.get(n) || 0) + (m.len || 0));
  }
  const top = [...tally].filter(([, l]) => l > 2500).sort((a, b) => b[1] - a[1]).slice(0, 2).map(x => x[0]);
  return top.length ? 'přes ' + top.join(', ') : '';
}
function routeFacts(r) {
  const a = r.a, f = [];
  f.push(`<span>${icon('cam')}${a.cams.length} ${pl(a.cams.length, 'radar', 'radary', 'radarů')}</span>`);
  if (a.sections.length) f.push(`<span class="warn">${icon('speed')}${a.sections.length}× úsekové</span>`);
  if (a.delay > 90) f.push(`<span class="${a.delay > 600 ? 'bad' : 'warn'}">${icon('jam')}+${shortTime(a.delay)} zdržení</span>`);
  if (a.closures) f.push(`<span class="bad">${icon('closure')}uzavírka</span>`);
  const acc = a.events.filter(e => e.ev.kind === 'accident').length;
  if (acc) f.push(`<span class="bad">${icon('accident')}${acc}× nehoda</span>`);
  if (a.motorwayShare > 0.12) f.push(`<span>${Math.round(a.motorwayShare * 100)} % dálnice</span>`);
  f.push(`<span>zatáčky ${funBars(a.funScore)}</span>`);
  return f.join('');
}
function routeCard(r, i, act = 'pick') {
  const sel = r === st.selR;
  const badge = i === 0 && st.mode === 'plan' && st.routes.length > 1 ? BADGE[S.priority] : '';
  r.via = r.via || viaName(r);
  return `<button class="rcard ${sel ? 'sel' : ''}" data-act="${act}" data-i="${i}">
    <div class="rcard__top"><span class="rcard__time">${fmtTime(r.a.time)}</span><span class="rcard__dist">${fmtDist(r.length)} · ${clock(Date.now() + r.a.time * 1000)}</span>${badge ? `<span class="rcard__badge">${badge}</span>` : ''}</div>
    <div class="rcard__name">${esc(r.label)}${r.via ? ` <span style="color:var(--muted)">${esc(r.via)}</span>` : ''}</div>
    <div class="rcard__facts">${routeFacts(r)}</div></button>`;
}
// vysvětlení, proč vyhrála právě tahle trasa
function why() {
  const R = st.routes; if (!R.length) return '';
  const best = R[0];
  const naive = R.reduce((m, r) => r.vTime < m.vTime ? r : m, R[0]);
  if (S.priority === 'fast' && naive !== best && naive.a.time - best.a.time > 60) {
    const reasons = [];
    if (naive.a.cams.length > best.a.cams.length) reasons.push(`${naive.a.cams.length} ${pl(naive.a.cams.length, 'radar', 'radary', 'radarů')}`);
    if (naive.a.sections.length > best.a.sections.length) reasons.push('úsekové měření');
    if (naive.a.delay > best.a.delay + 60) reasons.push('zácpy');
    if (naive.a.urbanShare > best.a.urbanShare + 0.05) reasons.push('víc obcí');
    return `<p class="why">Běžná navigace by vás poslala trasou <b>${esc(naive.label)}</b>${reasons.length ? ` (${reasons.join(', ')})` : ''}. Při reálné rychlosti je ale o <b>${shortTime(naive.a.time - best.a.time)}</b> pomalejší.</p>`;
  }
  if (best.a.delay > 120) return `<p class="why">Počítám s aktuálním zdržením <b>${shortTime(best.a.delay)}</b> podle živé dopravy NDIC.</p>`;
  return `<p class="why">Čas počítám z reálné rychlosti: limity, zatáčky, radary a úsekovky${traffic.events.length ? ' a živá doprava' : ''}.</p>`;
}
function renderPlan() {
  if (st.mode !== 'plan') return;
  const d = st.stops[st.stops.length - 1], via = st.stops.slice(1, -1);
  const fav = places.fav.some(p => Math.abs(p.lon - d.lon) < 1e-4 && Math.abs(p.lat - d.lat) < 1e-4);
  const cards = st.routes.length ? st.routes.map((r, i) => routeCard(r, i)).join('')
    : st.planError ? `<div class="empty"><b>Trasu se nepodařilo najít</b>${esc(st.planError)}</div>`
      : '<div class="skeleton"></div><div class="skeleton" style="opacity:.55"></div>';
  sheet(`
    <div class="plan-head peek">
      <button class="round flat" data-act="cancel" aria-label="Zpět">${icon('back')}</button>
      <div class="stops"><b>${esc(d.name)}</b><span>${via.length ? 'přes ' + via.map(v => esc(v.name)).join(', ') + ' · ' : ''}${esc(d.sub || '')}${st.stops[0].here ? '' : ' · start: ' + esc(st.stops[0].name)}</span></div>
      <button class="round flat ${fav ? 'on' : ''}" data-act="favtoggle" aria-label="Oblíbené">${icon('star')}</button>
    </div>
    <div class="chips">${PRIOS.map(([k, l]) => `<button class="chip ${S.priority === k ? 'on' : ''}" data-act="prio" data-v="${k}">${l}</button>`).join('')}
      <button class="chip ${S.avoidHighways ? 'on' : ''}" data-act="avoid">Bez dálnic</button>
      <button class="chip" data-act="addstop">${icon('plus')}Zastávka</button></div>
    ${st.planDone || st.routes.length > 1 ? why() : ''}
    <div class="routes">${cards}${!st.planDone && st.routes.length ? '<div class="progress" style="padding:6px 4px"><span class="spinner"></span>Hledám další varianty…</div>' : ''}</div>
    ${st.routes.length ? `<div class="go-row"><button class="btn" data-act="go">${icon('play')} Jet</button><button class="btn ghost" data-act="sim">${icon('sim')} Demo</button></div>` : ''}`, 'plan');
}
function cancelPlan() {
  st.planCtl && st.planCtl.abort();
  st.routes = []; st.selR = null; st.joyRoutes = null;
  destMarker.remove();
  setData('routes', fc([])); setData('routeJam', fc([])); setData('routeLabels', fc([])); setData('stops', fc([]));
  renderHome();
  if (st.pos) { setFollow(true); map.easeTo({ center: st.pos, zoom: 14.5, duration: 600, padding: homePad() }); }
}

// ---------- navigace ----------
function startNav(route, { sim = false, joy = false } = {}) {
  if (!route || !route.a) return;
  voice.unlock();
  st.planCtl && st.planCtl.abort();
  st.mode = 'nav'; st.joy = joy; st.rally = joy || S.rally; st.arrived = false;
  st.navRoute = route; st.navStops = st.stops.slice(1);
  setBody();
  setData('routes', fc([line(route.coords, { sel: 1, idx: 0 })]));
  setData('routeJam', jamFeatures(route)); setData('routeLabels', fc([]));
  st.nav = new Navigator({
    onUpdate: onNavUpdate, onArrive, onReroute, onAlert, onNote() { }, onOver,
    prefs, rally: () => st.rally,
  });
  st.nav.start(route, st.stops, reports);
  st.drive = null; showHazard(null);
  wake(true);
  if (S.record && !rec.active && !sim) startRec(true);
  setFollow(true);
  if (sim) { st.simMult = 1; st.sim = new Simulator(route, fix => handleFix(fix), st.simMult); }
  renderNav();
  const a = route.a;
  voice.say(`${joy ? 'Jedeme. Projížďka' : 'Vyrážíme. Do cíle'} ${speakTime(a.time)}${a.cams.length ? `, na trase ${a.cams.length} ${pl(a.cams.length, 'radar', 'radary', 'radarů')}` : ''}.`, { priority: 3 });
  startAutoRefresh(() => st.navRoute ? sampleRoute(st.navRoute, 20000) : [st.pos || map.getCenter().toArray()]);
  if (sim) { st.sim.start(); toast({ icon: 'sim', title: 'Demo jízda', sub: 'Poloha je simulovaná, nic se nenahrává.' }); }
  else if (st.lastFix) handleFix({ ...st.lastFix, t: Date.now() });
}

let lastTrim = 0;
function onNavUpdate(s) {
  st.navState = s;
  setPuck(s.pos, s.bearing);
  if (st.follow) {
    const v = s.speed, z = (v < 30 ? 17 : v < 60 ? 16.4 : v < 95 ? 15.8 : 15.1) + (st.rally ? 0.3 : 0);
    map.easeTo({ center: s.pos, bearing: s.bearing, pitch: 58, zoom: z, duration: 950, easing: t => t, padding: { top: Math.round(innerHeight * 0.44), bottom: innerWidth >= 720 ? 0 : sheetEl.offsetHeight, left: 0, right: innerWidth >= 720 ? sheetEl.offsetWidth : 0 } });
  }
  const m = s.next;
  $('manArrow').innerHTML = maneuverSVG(m ? m.type : 4, m && m.exit);
  $('manDist').textContent = fmtDist(s.dMan);
  $('manText').textContent = !s.onRoute ? 'Mimo trasu' : m ? (m.stop ? `Zastávka: ${m.stop.name || ''}` : (m.street || m.text)) : 'Cíl';
  const nx = $('manNext');
  if (m && s.after && s.after.s - m.s < 450 && s.after.type !== 1) { nx.hidden = false; nx.innerHTML = `Pak ${maneuverSVG(s.after.type, s.after.exit)} ${esc(s.after.street || '')}`; }
  else nx.hidden = true;
  updateSpeedo(s.speed, s.limit, true);
  renderPace(s.notes);
  const t = $('navRemT');
  if (t) { t.textContent = fmtTime(s.remT); $('navRem').textContent = `příjezd ${clock(s.eta)} · ${fmtDist(s.remaining)}`; }
  if (!st.arrived) showHazard(navHazard(s));
  if (Date.now() - lastTrim > 2000) {
    lastTrim = Date.now();
    const r = st.navRoute, i = st.nav.idx;
    setData('routes', fc([line([s.pos, ...r.coords.slice(i + 1)], { sel: 1, idx: 0 })]));
    setData('routeJam', jamFeatures(r, i));
  }
  // učení tempa jen na volné silnici mimo obce, radary a zácpy
  if (!st.sim && s.onRoute && s.speed > 25) {
    const { i } = st.nav.limitAt(s.s), a = st.navRoute.a;
    if (!a.urban[i] && !a.enforced[i] && !a.fcdV[i] && a.curveV[i] > s.limit) learnSample(s.speed, s.limit);
  }
  if (!$('hud').hidden) updateHud();
}
// nejbližší věc na trase před námi: radar, úsekovka, hlášení řidičů, nehoda/kolona/uzavírka
function navHazard(s) {
  const inSec = s.upcoming.find(u => u.inside);
  if (inSec) return { key: 'in' + inSec.ms + '@' + Math.round(inSec.left + s.s), kind: 'secIn', d: inSec.left, ms: inSec.ms };
  const v = s.speed / 3.6, out = [];
  for (const u of s.upcoming) if (u.d < Math.max(450, v * 18)) out.push({ key: u.kind + Math.round(s.s + u.d), kind: u.kind === 'cam' ? 'cam' : 'secStart', d: u.d, ms: u.ms });
  for (const { s: rs, rep } of st.nav.reports || []) { const d = rs - s.s; if (d > 0 && d < Math.max(900, v * 40)) out.push({ key: rep.id, kind: rep.type === 'police' ? 'police' : 'report', d, rep }); }
  for (const e of st.navRoute.a.events) {
    const d = e.s - s.s;
    if (d > 0 && d < Math.max(1500, v * 60) && (['accident', 'jam'].includes(e.ev.kind) || (e.ev.kind === 'closure' && e.ev.full))) out.push({ key: e.ev.id, kind: e.ev.kind, d, ev: e.ev });
  }
  return out.sort((a, b) => a.d - b.d)[0] || null;
}
const curveSVG = dir => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="${dir === 'P' ? 'M6 21v-8a7 7 0 017-7h5M15 3l3 3-3 3' : 'M18 21v-8a7 7 0 00-7-7H6M9 3L6 6l3 3'}"/></svg>`;
function renderPace(notes) {
  const el = $('pace');
  if (!st.rally || !notes || !notes.length) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = notes.slice(0, 3).map((n, i) => `<div class="note ${i === 0 ? 'first' : ''}">${curveSVG(n.dir)}${esc(n.short.slice(1))}${i === 0 ? `<small>${Math.max(0, Math.round(n.d / 10) * 10)} m</small>` : n.gap === 'do' ? '<small>do</small>' : ''}</div>`).join('');
}
function renderNav() {
  const s = st.navState, a = st.navRoute.a;
  const act = (k, ic, t, on = false, extra = '') => `<button class="${on ? 'on' : ''}" data-act="${k}" ${extra}>${icon(ic)}${t}</button>`;
  sheet(`
    <div class="navbar peek">
      <button class="round end" data-act="end" aria-label="Ukončit navigaci">${icon('close')}</button>
      <button class="navbar__eta" data-act="expand"><b id="navRemT">${fmtTime(s ? s.remT : a.time)}</b><span id="navRem">příjezd ${clock(s ? s.eta : Date.now() + a.time * 1000)} · ${fmtDist(s ? s.remaining : st.navRoute.length)}</span></button>
      <button class="round flat" data-act="report" aria-label="Nahlásit">${icon('flagplus')}</button>
      <button class="round flat navbar__more" data-act="expand" aria-label="Další volby">${icon('chevron')}</button>
    </div>
    <div class="nav-actions">
      ${act('rally', 'track', 'Rally', st.rally)}
      ${act('fuelahead', 'fuel', 'Pumpa po cestě')}
      ${act('overview', 'route', 'Celá trasa')}
      ${act('mute', S.muted ? 'mute' : 'volume', S.muted ? 'Ztlumeno' : 'Hlas', false)}
      ${act('share', 'share', 'Sdílet příjezd')}
      ${act('rec', 'trips', rec.active ? 'Nahrávám' : 'Nahrávat', rec.active)}
      ${act('hud', 'hud', 'HUD')}
      ${st.sim ? act('simspeed', 'sim', `Demo ×${st.simMult}`) : ''}
    </div>`, 'nav', true);
  if (s) onNavUpdate(s);
}
function onAlert(a) {
  // radary, hlášení a události ukazuje karta nad rychloměrem, sem jen to, co tam není
  if (a.kind === 'secEnd') toast({ icon: 'check', title: 'Konec úsekového měření', ms: 3000 });
  else if (['hazard', 'works'].includes(a.kind) && a.ev) toast({ icon: KIND_ICON[a.kind] || 'hazard', title: evName(a.ev), sub: 'za ' + fmtDist(a.d) + (a.ev.loc ? ' · ' + a.ev.loc : ''), ms: 5000 });
}
function onOver() {
  voice.say(voice.phraseAlert('over', 0), { priority: 2 });
  navigator.vibrate && navigator.vibrate([60, 60, 60]);
}
async function onReroute(p, heading) {
  if (st.sim || st.rerouting || st.arrived) return;
  st.rerouting = true;
  toast({ icon: 'route', title: 'Přepočítávám trasu…', ms: 2500 });
  try {
    const r = st.joy ? await rejoin(p, heading) : await reroute(p, heading, restStops(), prefs());
    if (!st.nav) return;
    st.navRoute = r; st.nav.setRoute(r, reports);
    setData('routes', fc([line(r.coords, { sel: 1, idx: 0 })])); setData('routeJam', jamFeatures(r));
    voice.say('Trasa přepočítána.', { priority: 1 });
  } catch (e) { console.warn(e); }
  finally { st.rerouting = false; }
}
function restStops() {
  const r = st.navRoute, s = st.nav ? st.nav.s : 0;
  const rest = st.navStops.filter((p, i) => i === st.navStops.length - 1 || project(r.coords, r.cum, [p.lon, p.lat]).s > s + 30);
  return rest.map(p => [p.lon, p.lat]);
}
// joy ride: po sjetí se vrátit na okruh ~1,5 km před sebou a zbytek ponechat
async function rejoin(p, heading) {
  const old = st.navRoute, s0 = st.nav.s;
  const sJoin = Math.min(old.length - 20, s0 + 1500);
  const target = pointAt(old.coords, old.cum, sJoin);
  const head = await valhallaRoute([Object.assign([p[0], p[1]], heading != null ? { heading } : {}), target], { prefs: prefs(), auto: { use_highways: 0, use_tolls: 0 } });
  let j = 0; while (j < old.cum.length - 1 && old.cum[j] < sJoin) j++;
  const hc = head.coords.slice(0, -1), coords = [...hc, ...old.coords.slice(j)], off = hc.length - j;
  const maneuvers = [...head.maneuvers.filter(m => ![4, 5, 6].includes(m.type)).map(m => ({ ...m })), ...old.maneuvers.filter(m => m.idx >= j).map(m => ({ ...m, idx: m.idx + off }))];
  const cum = cumDist(coords);
  for (const m of maneuvers) m.s = cum[Math.min(m.idx, cum.length - 1)];
  const r = { ...old, coords, cum, maneuvers, length: cum[cum.length - 1], vTime: head.vTime + old.vTime * (1 - sJoin / old.length) };
  await enrich(r, prefs());
  return r;
}
function onArrive() {
  st.arrived = true;
  setTimeout(renderArrive, 1200);
}
function renderArrive() {
  if (st.mode !== 'nav') return;
  const r = st.navRoute, mins = Math.round((Date.now() - st.nav.startedAt) / 60000);
  sheet(`
    <div class="hello peek"><h1>${st.joy ? 'Projížďka <em>hotová</em>' : 'Jste v <em>cíli</em>'}</h1><span class="meta">${clock(Date.now())}</span></div>
    <div class="stat-grid">
      <div class="stat"><b>${fmtDist(r.length)}</b><span>ujeto</span></div>
      <div class="stat"><b>${mins} min</b><span>na cestě</span></div>
      <div class="stat"><b>${Math.round(st.nav.maxSpeed * 3.6)}</b><span>max km/h</span></div>
      <div class="stat"><b>${r.a.notes.length}</b><span>zatáček v rozpisu</span></div>
    </div>
    <div class="go-row"><button class="btn" data-act="end">${icon('check')} Hotovo</button><button class="btn ghost" data-act="parksave">${icon('parking')} Tady parkuju</button></div>`, 'nav');
  toggleSheet(true); showHazard(null); clearAsk();
}
async function endNav() {
  st.sim && st.sim.stop(); st.sim = null;
  st.nav = null; st.navState = null; st.navRoute = null; st.rerouting = false;
  voice.stop(); wake(false);
  if (rec.active && rec.auto) await stopRec();
  $('hud').hidden = true;
  st.mode = 'home'; showHazard(null); clearAsk();
  cancelPlan();
  map.easeTo({ pitch: 0, bearing: 0, padding: homePad(), duration: 700, ...(st.pos ? { center: st.pos, zoom: 15 } : {}) });
  startAutoRefresh(() => [st.pos || map.getCenter().toArray()]);
}
async function wake(on) {
  try {
    if (on && 'wakeLock' in navigator) st.wake = await navigator.wakeLock.request('screen');
    else if (!on && st.wake) { await st.wake.release(); st.wake = null; }
  } catch { }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && st.nav) wake(true); });

async function shareEta() {
  const s = st.navState; if (!s) return;
  const d = st.stops[st.stops.length - 1];
  const text = st.joy ? `Jsem na projížďce, zpátky kolem ${clock(s.eta)}.` : `Jsem na cestě${d ? ' do ' + d.name : ''}. Dorazím kolem ${clock(s.eta)} (ještě ${fmtTime(s.remT)}).`;
  if (navigator.share) { try { await navigator.share({ text }); } catch { } }
  else { try { await navigator.clipboard.writeText(text); toast({ icon: 'share', title: 'Zkopírováno', sub: text }); } catch { } }
}

// ---------- HUD ----------
function openHud() { $('hud').hidden = false; updateHud(); document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => { }); }
function updateHud() {
  const s = st.navState;
  $('hudSpeed').textContent = Math.round(s ? s.speed : st.speed);
  $('hudMan').innerHTML = s && s.next ? maneuverSVG(s.next.type, s.next.exit) : '';
  $('hudDist').textContent = s ? fmtDist(s.dMan) : '';
}
$('hudClose').onclick = () => { $('hud').hidden = true; document.fullscreenElement && document.exitFullscreen().catch(() => { }); };

// ---------- joy ride ----------
const WANTS = [
  ['curvy', 'track', 'Okresky a zatáčky', 'Co nejvíc zatáček mimo obce'],
  ['topspeed', 'speed', 'Vytočit to', 'Dálnice 130 a tipy na okruh'],
  ['food', 'food', 'Najíst se', 'Restaurace v půlce cesty'],
  ['coffee', 'coffee', 'Kafe', 'Kavárna po cestě'],
  ['view', 'view', 'Vyhlídka', 'Zastávka na fotku'],
  ['fuel', 'fuel', 'Natankovat', 'Pumpa po cestě'],
];
function openJoy() {
  const draw = () => {
    const tracks = st.joyWants.topspeed ? `<div class="tracks"><span class="label">Opravdová maximálka patří na okruh</span><br>${TRACKS.map(t => `<a href="${t.url}" target="_blank" rel="noopener">${esc(t.name)}</a>${st.pos ? ' · ' + fmtDist(dist(st.pos, t.p)) : ''}`).join('<br>')}</div>` : '';
    page('Joy ride', `
      <div class="joy-time"><b id="joyT">${shortTime(st.joyMin * 60)}</b><span>okruh ze startu a zpátky</span></div>
      <input class="dial" id="joyDial" type="range" min="30" max="240" step="15" value="${st.joyMin}" aria-label="Délka projížďky">
      <div class="group"><span class="label">Co chci zažít</span><div class="wants">${WANTS.map(([k, ic, t, d]) => `<button class="want ${st.joyWants[k] ? 'on' : ''}" data-act="want" data-k="${k}">${icon(ic)}<div><b>${t}</b><span>${d}</span></div></button>`).join('')}</div></div>
      ${tracks}
      <button class="btn wide" data-act="joyplan" style="margin-top:20px">${icon('joy')} Navrhnout projížďku</button>
      <p class="note-text">Během joy ride hlásí spolujezdec zatáčky jako v rally. Na silnici ale platí limity, radary hlídáme za vás.</p>`);
    $('joyDial').addEventListener('input', e => { st.joyMin = +e.target.value; $('joyT').textContent = shortTime(st.joyMin * 60); });
  };
  pageRender = draw; draw();
}
async function planJoy() {
  closePage();
  st.planCtl && st.planCtl.abort();
  const ctl = st.planCtl = new AbortController();
  st.mode = 'joy'; setBody(); st.joyRoutes = null; st.selR = null; st.joyErr = null;
  destMarker.remove(); setData('routes', fc([])); setData('routeLabels', fc([])); setData('stops', fc([]));
  const o = origin();
  st.stops = [o, o];
  st.joyMsg = 'Hledám zatáčky ve čtyřech směrech…'; renderJoy();
  map.easeTo({ center: [o.lon, o.lat], zoom: 9.5, pitch: 0, bearing: 0, duration: 700 });
  ensureTraffic([[o.lon, o.lat]]).catch(() => { });
  try {
    const routes = await planJoyride({ start: [o.lon, o.lat], minutes: st.joyMin, wants: st.joyWants, prefs: prefs() }, msg => { st.joyMsg = msg; renderJoy(); }, ctl.signal);
    if (ctl.signal.aborted) return;
    st.joyRoutes = routes; st.selR = routes[0];
    drawRoutes(); renderJoy(); fitRoutes(routes);
  } catch (e) {
    if (e.name === 'AbortError') return;
    st.joyErr = e.message || 'Projížďku se nepodařilo naplánovat'; renderJoy();
  }
}
const STOP_NAME = { food: 'Jídlo', coffee: 'Kafe', view: 'Vyhlídka', fuel: 'Tankování' };
function renderJoy() {
  if (st.mode !== 'joy') return;
  const R = st.joyRoutes;
  const head = `<div class="plan-head peek"><button class="round flat" data-act="cancel" aria-label="Zpět">${icon('back')}</button>
    <div class="stops"><b>Joy ride · ${shortTime(st.joyMin * 60)}</b><span>${WANTS.filter(w => st.joyWants[w[0]]).map(w => w[2].toLowerCase()).join(', ') || 'jen tak'}</span></div>
    <button class="round flat" data-act="joyedit" aria-label="Upravit">${icon('sliders')}</button></div>`;
  if (!R) {
    sheet(head + (st.joyErr ? `<div class="empty"><b>Nevyšlo to</b>${esc(st.joyErr)}</div><button class="btn wide" data-act="joyplan">Zkusit znovu</button>` : `<div class="progress"><span class="spinner"></span>${esc(st.joyMsg)}</div><div class="skeleton"></div>`), 'joy');
    return;
  }
  const cards = R.map((r, i) => {
    const sel = r === st.selR, a = r.a;
    const stops = (r.stops || []).map(s => `<div>${icon(s.kind)}${STOP_NAME[s.kind]}: ${esc(s.name || '')}<span style="color:var(--muted)"> · km ${Math.round(s.s / 1000)}</span></div>`).join('');
    const mw = r.mw ? `<div>${icon('speed')}Dálniční úsek ${fmtDist(dist([r.mw.from.lon, r.mw.from.lat], [r.mw.to.lon, r.mw.to.lat]))} · exit ${esc(r.mw.from.ref || '')} → ${esc(r.mw.to.ref || '')}</div>` : '';
    return `<button class="rcard ${sel ? 'sel' : ''}" data-act="joypick" data-i="${i}">
      <div class="rcard__top"><span class="rcard__time">${fmtTime(a.time)}</span><span class="rcard__dist">${fmtDist(r.length)} · ${esc(r.dirName || '')}</span><span class="rcard__badge">${esc(r.label)}</span></div>
      <div class="rcard__facts"><span>zatáčky ${funBars(a.funScore)}</span><span>${icon('track')}${a.notes.length} v rozpisu</span><span>${icon('cam')}${a.cams.length}</span>${a.sections.length ? `<span class="warn">${icon('speed')}${a.sections.length}× úsekové</span>` : ''}</div>
      ${stops || mw ? `<div class="stops-list">${mw}${stops}</div>` : ''}</button>`;
  }).join('');
  sheet(`${head}<div class="routes">${cards}</div>
    <div class="go-row"><button class="btn" data-act="joygo">${icon('play')} Vyrazit</button><button class="btn ghost" data-act="joysim">${icon('sim')} Demo</button><button class="round flat" data-act="joyplan" aria-label="Jiné varianty" style="width:52px;height:52px">${icon('route')}</button></div>`, 'joy');
}

// ---------- hlášení ----------
// částečná uzavírka (pruh, kyvadlo) je jen omezení, ne zavřená silnice
const evName = ev => ev.kind === 'closure' && !ev.full ? 'Omezení provozu' : kindName(ev.kind);
const KIND_ICON = { accident: 'accident', jam: 'jam', closure: 'closure', works: 'works', hazard: 'hazard', info: 'info', police: 'police', cam: 'cam', bump: 'bump', report: 'flag' };
function openReport() {
  modal(`<div class="modal__head"><b>Co je na silnici?</b><span>${st.pos ? 'Nahlásí se tam, kde právě jste.' : 'Nejdřív potřebuju znát vaši polohu.'}</span></div>
    <div class="report-grid">${REPORT_TYPES.map(r => `<button data-act="rep" data-v="${r.type}" class="rep rep-${r.type}" ${st.pos ? '' : 'disabled'}><span class="rep__ic">${icon(r.icon)}</span><b>${r.label}</b></button>`).join('')}</div>
    <p class="note-text">Hlášení uvidí i ostatní řidiči s touto navigací. Samo zmizí, když ho nikdo nepotvrdí.</p>`);
}
async function addReportUI(type) {
  closeModal();
  const R = reportType(type);
  if (!st.pos) { toast({ icon: 'locate', title: 'Poloha zatím není známá' }); return; }
  navigator.vibrate && navigator.vibrate(20);
  toast({ icon: R.icon, title: 'Díky, nahlášeno', sub: R.label, ms: 2500 });
  const res = await postReport(type, st.pos, st.heading);
  toast(res.shared
    ? { icon: 'check', title: res.merged ? 'Potvrdili jste hlášení' : 'Sdíleno s řidiči', sub: `${R.label} · platí ${R.min} min` }
    : { icon: 'info', title: 'Uloženo jen v telefonu', sub: /15|limit|rate/i.test(res.error || '') ? 'Moc hlášení za hodinu, zkuste to později.' : 'Server teď nejde.' });
}
function openRepInfo(r) {
  const R = reportType(r.type) || REPORT_TYPES[0];
  modal(`<div class="modal__head row-head"><span class="rep__ic big rep-${r.type}">${icon(R.icon)}</span><div><b>${R.label}</b><span>nahlášeno ${ago(r.t)}${r.up > 1 ? ` · potvrdilo ${r.up} řidičů` : ''}${st.pos ? ' · ' + fmtDist(dist(st.pos, [r.lon, r.lat])) + ' odsud' : ''}</span></div></div>
    ${canVote(r.id) ? `<div class="btn-pair"><button class="btn" data-act="vote" data-id="${esc(r.id)}" data-v="1">${icon('check')} Pořád tam je</button><button class="btn ghost" data-act="vote" data-id="${esc(r.id)}" data-v="-1">${icon('close')} Už tam není</button></div>`
    : `<p class="note-text">${r.mine ? 'Tohle hlášení je vaše.' : 'Díky, už jste hlasovali.'}</p>`}`);
}
function drawReports() {
  reports = reports.filter(r => r.exp > Date.now());
  setData('reports', fc(reports.map(r => point([r.lon, r.lat], { type: r.type, t: r.t, id: String(r.id) }))));
}
// pumpa podél trasy před námi (max ~600 m od trasy), pak přepočet přes ni
let fuelList = [];
async function fuelAhead() {
  const r = st.navRoute, s0 = st.nav ? st.nav.s : 0;
  if (!r) return;
  page('Pumpa po cestě', `<div class="progress"><span class="spinner"></span>Hledám pumpy podél trasy…</div>`);
  pageRender = null;
  const found = new Map();
  try {
    for (const [a, b] of [[1500, 20000], [20000, 45000], [45000, 80000]]) {
      if (a >= r.length - s0) break;
      const pts = [];
      for (let s = s0 + a; s <= Math.min(r.length, s0 + b); s += 1000) pts.push(pointAt(r.coords, r.cum, s));
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const list = await nomBox('[fuel]', [Math.min(...xs) - 0.01, Math.max(...ys) + 0.01, Math.max(...xs) + 0.01, Math.min(...ys) - 0.01], 50);
      for (const p of list) {
        const pr = project(r.coords, r.cum, [p.lon, p.lat]);
        if (pr.d < 600 && pr.s > s0 + 800) found.set(p.lon + ',' + p.lat, { ...p, name: p.name || 'Čerpací stanice', s: pr.s, off: pr.d });
      }
      if (found.size >= 4) break;
      await sleep(1000);
    }
    if ($('page').hidden || $('pageTitle').textContent !== 'Pumpa po cestě') return;
    fuelList = [...found.values()].sort((x, y) => x.s - y.s).slice(0, 8);
    $('pageBody').innerHTML = fuelList.length
      ? `<div class="list">${fuelList.map((p, i) => `<button class="row" data-act="fuelvia" data-i="${i}">${icon('fuel')}<div class="row__t"><b>${esc(p.name)}</b><span>${p.off < 120 ? 'přímo u trasy' : 'odbočka ' + fmtDist(p.off)}${p.sub ? ' · ' + esc(p.sub) : ''}</span></div><span class="row__end">za ${fmtDist(p.s - s0)}</span></button>`).join('')}</div><p class="note-text">Po výběru přepočítám trasu přes pumpu a pak dál do cíle.</p>`
      : `<div class="empty"><b>Na trase nic</b>V příštích kilometrech u trasy žádnou pumpu nevidím.</div>`;
    hydrateIcons($('pageBody'));
  } catch {
    $('pageBody').innerHTML = `<div class="empty"><b>Hledání nejde</b>Zkontrolujte připojení k internetu.</div>`;
  }
}
async function fuelVia(p) {
  closePage();
  if (!st.nav || !st.pos) return;
  toast({ icon: 'fuel', title: 'Jedeme přes pumpu', sub: p.name, ms: 2500 });
  try {
    st.navStops.unshift({ name: p.name, lon: p.lon, lat: p.lat });
    const r = await reroute(st.pos, st.heading, restStops(), prefs());
    if (!st.nav) return;
    st.navRoute = r; st.nav.setRoute(r, reports);
    setData('routes', fc([line(r.coords, { sel: 1, idx: 0 })])); setData('routeJam', jamFeatures(r));
    voice.say(`Trasa vede přes pumpu ${p.name}.`, { priority: 2 });
  } catch { st.navStops.shift(); toast({ icon: 'info', title: 'Přepočet nevyšel', danger: true }); }
}

// ---------- vrstvy ----------
function themePreview(id) {
  const t = THEMES[id], m = t.map, rr = id === 'rally' ? 1 : 7;
  return `<svg viewBox="0 0 90 120" preserveAspectRatio="xMidYMid slice"><rect width="90" height="120" fill="${m.bg}"/><rect x="-5" y="62" width="100" height="14" fill="${m.water}" transform="rotate(-8 45 69)"/><rect x="52" y="8" width="30" height="22" fill="${m.wood}"/>
    <path d="M-5 30 Q40 42 95 18" stroke="${m.road.primary}" stroke-width="5" fill="none"/><path d="M22 -5 Q32 60 8 125" stroke="${m.road.secondary}" stroke-width="3.5" fill="none"/><path d="M64 -5 L72 125" stroke="${m.road.motorway}" stroke-width="5" fill="none"/>
    <path d="M14 104 C 26 76, 54 74, 61 44 S 70 12, 80 6" stroke="${m.routeCasing}" stroke-width="7" fill="none" stroke-linecap="round"/><path d="M14 104 C 26 76, 54 74, 61 44 S 70 12, 80 6" stroke="${m.route}" stroke-width="4" fill="none" stroke-linecap="round"/>
    <rect x="6" y="92" width="78" height="23" rx="${rr}" fill="${t.dark ? '#000' : '#fffaf2'}" opacity=".88"/><rect x="12" y="100" width="34" height="7" rx="${Math.min(rr, 3.5)}" fill="${t.ui.accent}"/></svg>`;
}
const THEME_FONT = { pulnoc: "font-family:'Instrument Serif',serif;font-style:italic;font-size:19px", atlas: "font-family:'Fraunces',serif;font-size:17px", rally: "font-family:'Barlow Condensed',sans-serif;font-style:italic;font-weight:700;text-transform:uppercase;font-size:18px" };
function themeCards() {
  return `<div class="themes">${THEME_ORDER.map(id => `<button class="theme-card ${S.theme === id ? 'on' : ''}" data-act="theme" data-v="${id}"><div class="theme-card__prev">${themePreview(id)}</div><div class="theme-card__name"><b style="${THEME_FONT[id]}">${THEMES[id].name}</b><span>${THEMES[id].tagline}</span></div></button>`).join('')}</div>`;
}
function openLayers() {
  const draw = () => {
    const lb = (k, ic, t) => `<button class="layer ${S[k] ? 'on' : ''}" data-act="layer" data-k="${k}">${icon(ic)}${t}</button>`;
    const pk = parking.get();
    page('Mapa', `
      <div class="group"><span class="label">Vzhled</span>${themeCards()}</div>
      <div class="group"><span class="label">Na mapě</span><div class="layer-grid">${lb('showTraffic', 'jam', 'Doprava')}${lb('showCams', 'cam', 'Radary a úsekovky')}${lb('showBumps', 'bump', 'Zpomalovací prahy')}${lb('relief', 'view', 'Reliéf terénu')}</div></div>
      <div class="group"><span class="label">Parkování</span><div class="card">
        <button class="row" data-act="parksave">${icon('parking')}<div class="row__t"><b>Zapamatovat, kde stojím</b><span>${pk ? 'naposledy ' + ago(pk.t) : 'auto pak snadno najdete'}</span></div></button>
        ${pk ? `<button class="row" data-act="parkshow">${icon('pin')}<div class="row__t"><b>Ukázat auto na mapě</b><span>${st.pos ? fmtDist(dist(st.pos, [pk.lon, pk.lat])) + ' odsud' : ''}</span></div></button>` : ''}
      </div></div>
      <p class="note-text">Doprava: Národní dopravní informační centrum (NDIC), obnova každou minutu. Radary, úsekovky a prahy: OpenStreetMap. Hlášení: řidiči s touto navigací. Mapa: OpenFreeMap, reliéf: Mapzen.</p>`);
  };
  pageRender = draw; draw();
}

// ---------- jízdy ----------
const speedColor = v => v < 50 ? '#5d9cec' : v < 90 ? getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() : v < 131 ? '#f07a3a' : '#e5484d';
async function openTrips() {
  page('Moje jízdy', '<div class="progress"><span class="spinner"></span>Načítám…</div>');
  pageRender = null;
  let list = [];
  try { list = await trips.all(); } catch { }
  if (!list.length) {
    $('pageBody').innerHTML = `<div class="empty"><b>Zatím žádné jízdy</b>Nahrávání spustíte na úvodní obrazovce tlačítkem Nahrát, nebo ho v Nastavení zapněte pro každou jízdu.</div>`;
    return;
  }
  const km = list.reduce((a, t) => a + t.dist, 0) / 1000;
  $('pageBody').innerHTML = `<div class="stat-grid"><div class="stat"><b>${list.length}</b><span>${pl(list.length, 'jízda', 'jízdy', 'jízd')}</span></div><div class="stat"><b>${Math.round(km)} km</b><span>celkem</span></div></div>` +
    list.map(t => { const s = stats(t); return `<button class="trip" data-act="trip" data-id="${t.id}"><canvas data-id="${t.id}"></canvas><div><b>${esc(t.name)}</b><span>${fmtDist(s.dist)} · ${fmtTime(s.dur)} · max ${Math.round(s.max)} km/h</span></div>${icon('chevron')}</button>`; }).join('');
  hydrateIcons($('pageBody'));
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  $('pageBody').querySelectorAll('canvas').forEach(cv => { const t = list.find(x => x.id === cv.dataset.id); t && drawThumb(cv, t, accent); });
  st.tripList = list;
}
async function openTrip(id) {
  const t = (st.tripList || []).find(x => x.id === id) || await trips.get(id);
  if (!t) return;
  st.trip = t;
  const s = stats(t);
  page(t.name, `
    <div class="trip-detail"><canvas id="tripCv"></canvas></div>
    <div class="stat-grid">
      <div class="stat"><b>${fmtDist(s.dist)}</b><span>vzdálenost</span></div>
      <div class="stat"><b>${fmtTime(s.dur)}</b><span>čas</span></div>
      <div class="stat"><b>${Math.round(s.avg)}</b><span>průměr km/h</span></div>
      <div class="stat"><b>${Math.round(s.max)}</b><span>max km/h</span></div>
    </div>
    <p class="note-text">Barva čáry: modrá do 50, ${'barva vzhledu'} do 90, oranžová do 130 a červená nad 130 km/h.</p>
    <div class="btn-row">
      <button class="btn" data-act="tripmap">${icon('pin')} Na mapě</button>
      <button class="btn ghost" data-act="tripagain">${icon('route')} Jet znovu</button>
      <button class="btn ghost" data-act="tripgpx">${icon('download')} GPX</button>
      <button class="btn ghost" data-act="tripdel">${icon('trash')} Smazat</button>
    </div>`, () => openTrips());
  requestAnimationFrame(() => drawThumb($('tripCv'), t, speedColor(60), speedColor));
}
function tripOnMap() {
  const t = st.trip; if (!t) return;
  closePage();
  setData('trip', fc([line(t.pts.map(p => [p[0], p[1]]))]));
  setFollow(false);
  fitPoints(t.pts.map(p => [p[0], p[1]]));
  toast({ icon: 'trips', title: t.name, sub: 'Klepněte na mapu pro skrytí', ms: 5000 });
  map.once('click', () => setData('trip', fc([])));
}
async function tripAgain() {
  const t = st.trip; if (!t || t.pts.length < 2) return;
  closePage();
  const n = t.pts.length, via = [];
  for (let k = 1; k < 9; k++) { const p = t.pts[Math.floor(n * k / 9)]; via.push(Object.assign([p[0], p[1]], { type: 'through' })); }
  const a = t.pts[0], b = t.pts[n - 1];
  st.stops = [{ name: 'Start jízdy', lon: a[0], lat: a[1] }, { name: t.name, sub: 'podle nahrané jízdy', lon: b[0], lat: b[1] }];
  st.mode = 'plan'; setBody(); st.routes = []; st.planError = null; st.planDone = false; renderPlan();
  try {
    const r = await valhallaRoute([[a[0], a[1]], ...via, [b[0], b[1]]], { prefs: prefs(), label: 'Podle jízdy' });
    await enrich(r, prefs());
    st.routes = [r]; st.selR = r;
  } catch (e) { st.planError = e.message; }
  st.planDone = true; drawRoutes(); renderPlan(); fitRoutes(st.routes);
}
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function startRec(auto = false) {
  rec.start(); rec.auto = auto;
  clearInterval(recTimer); recTimer = setInterval(renderStatus, 1000);
  renderStatus(); refreshModeSheet();
  toast({ icon: 'trips', title: 'Nahrávám jízdu', sub: auto ? 'automaticky' : 'zastavíte klepnutím na čas nahoře' });
}
function refreshModeSheet() {
  if (st.mode === 'home') renderHome(); else if (st.mode === 'drive') renderDrive(); else if (st.mode === 'nav' && !st.arrived) renderNav();
}
async function stopRec() {
  const t = await rec.stop();
  clearInterval(recTimer); renderStatus(); refreshModeSheet();
  if (t) toast({ icon: 'check', title: 'Jízda uložena', sub: `${fmtDist(t.dist)} · max ${Math.round(t.max)} km/h` });
  else toast({ icon: 'info', title: 'Jízda byla moc krátká, neukládám' });
}

// ---------- nastavení ----------
const TEST = {
  navigatorka: 'Za 300 metrů odbočte vpravo na Vinohradskou.',
  parak: 'Za dvě stovky doprava, pak už jen rovně. Pohoda.',
  spolujezdec: 'Pravá čtyři utahuje, sto, levá dva do pravá vracák.',
  zen: 'Za půl kilometru mírně vlevo. Nikam nespěchejte.',
  robot: 'Cíl za dvanáct kilometrů. Systém připraven.',
};
function sw(k, title, sub = '') {
  return `<div class="switch-row"><div><b>${title}</b>${sub ? `<span>${sub}</span>` : ''}</div><button class="sw ${S[k] ? 'on' : ''}" data-act="tog" data-k="${k}" aria-label="${title}" aria-pressed="${!!S[k]}"></button></div>`;
}
function seg(k, opts) { return `<div class="seg">${opts.map(([v, l]) => `<button class="${S[k] === v ? 'on' : ''}" data-act="set" data-k="${k}" data-v="${v}">${l}</button>`).join('')}</div>`; }
function openSettings() {
  const draw = () => {
    const vs = voice.czechVoices();
    const voices = vs.length ? `<select class="select" id="voiceSel"><option value="">Automaticky (nejlepší český)</option>${vs.map(v => `<option value="${esc(v.voiceURI)}" ${S.voiceURI === v.voiceURI ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select>`
      : `<p class="note-text">Telefon zatím nenabídl český hlas. Mluvit to bude výchozím hlasem.</p>`;
    page('Nastavení', `
      <div class="group"><span class="label">Vzhled</span>${themeCards()}<div class="card" style="margin-top:10px">${sw('autoNight', 'Noční režim', 'Atlas se po setmění přepne na Půlnoc')}</div></div>
      <div class="group"><span class="label">Hlas</span>
        <div class="voice-list">${Object.entries(voice.PERSONAS).map(([id, p]) => `<div class="voice ${S.persona === id ? 'on' : ''}" data-act="persona" data-v="${id}" role="button" tabindex="0"><div><b>${p.name}</b><span>${p.desc}</span></div><button class="play" data-act="test" data-v="${id}" aria-label="Přehrát ukázku">${icon('play')}</button></div>`).join('')}</div>
        <div style="margin-top:12px">${voices}</div>
        <div class="card" style="margin-top:10px">
          <div class="switch-row"><div><b>Hlasitost</b></div><input class="range" id="volRange" type="range" min="0.2" max="1" step="0.1" value="${S.volume}" style="max-width:160px"></div>
          ${sw('muted', 'Ztlumit hlas', 'Jen obrazovka, bez mluvení')}
          ${sw('rallyPersona', 'Zatáčky hlásí rally spolujezdec', 'Rychlejší, úsečný hlas jen pro rozpis')}
        </div>
        ${isIOS ? '<p class="note-text">Kvalitnější české hlasy (Zuzana, Iveta – Vylepšený) stáhnete v iPhonu: Nastavení → Zpřístupnění → Předčítání → Hlasy → Čeština.</p>' : ''}
      </div>
      <div class="group"><span class="label">Upozornění</span><div class="card">
        ${sw('warnCams', 'Radary a úsekové měření')}
        ${sw('warnBumps', 'Zpomalovací prahy')}
        ${sw('warnTraffic', 'Kolony, nehody, uzavírky')}
        ${sw('warnOver', 'Překročení rychlosti')}
        ${sw('voiceAlerts', 'Upozornění i hlasem')}
        ${sw('driveAlerts', 'Hlídat i při jízdě bez cíle', 'Rozjedete se bez trasy a navigace sama hlásí, co je před vámi')}
      </div><div style="margin-top:10px"><span class="label">Tolerance překročení</span><div style="margin-top:8px">${seg('overTol', [[0, '0'], [5, '+5'], [10, '+10'], [15, '+15']])}</div></div></div>
      <div class="group"><span class="label">Jak jezdím</span>
        ${seg('tempo', [[0.95, 'V limitu'], [1, 'S provozem'], [1.08, 'Svižně']])}
        <div class="card" style="margin-top:10px">
          ${sw('learnTempo', 'Naučit se můj styl', learned.samples > 300 ? `Jezdíte průměrně na ${Math.round(learned.ratio * 100)} % limitu (mimo radary a obce)` : 'Po pár jízdách bude odhad času přesně na vás')}
          ${sw('sport', 'Sportovní průjezd zatáček', 'Rychlejší odhad v zatáčkách (vyšší boční přetížení)')}
          ${sw('rally', 'Rally hlášení v každé navigaci', 'Jinak jen v joy ride a po zapnutí v navigaci')}
          ${sw('record', 'Nahrávat každou navigaci')}
        </div>
        <p class="note-text">Tempo se používá jen tam, kde neměří radar ani úsekovka a nejste v obci. Tam počítáme vždy s limitem — proto vás navigace může poslat okreskami bez kamer.</p>
      </div>
      <div class="group"><span class="label">O aplikaci</span><p class="note-text">Mapa © OpenStreetMap, OpenFreeMap. Trasy: Valhalla (FOSSGIS), OSRM. Doprava: NDIC / dopravniinfo.cz. Hledání: Photon (Komoot). Vše jen pro Česko.</p></div>`);
    const vsel = $('voiceSel');
    if (vsel) vsel.onchange = () => { S.voiceURI = vsel.value || null; afterSetting('voiceURI'); voice.say(TEST[S.persona], { priority: 3 }); };
    $('volRange').onchange = e => { S.volume = +e.target.value; afterSetting('volume'); voice.say('Takhle nahlas.', { priority: 3 }); };
  };
  pageRender = draw; draw();
}
function afterSetting(k) {
  saveSettings();
  voice.configure({ persona: S.persona, voiceURI: S.voiceURI, volume: S.volume, muted: S.muted });
  if (k === 'muted' && S.muted) voice.stop();
  if (['showTraffic', 'showCams', 'showBumps'].includes(k)) applyVisibility();
  if (k === 'theme' || k === 'autoNight') applyTheme();
  if (k === 'relief') map.setStyle(buildStyle(st.theme, S.relief), { diff: false });
  if (k === 'avoidHighways' && st.mode === 'plan') plan();
  if (['tempo', 'learnTempo', 'sport'].includes(k) && (st.mode === 'plan' || st.mode === 'joy')) reanalyze();
  if (k === 'rally' && st.mode !== 'nav') st.rally = S.rally;
}

// ---------- akce (delegované kliknutí) ----------
const ACT = {
  joy: () => { closePage(); openJoy(); },
  place: d => { const p = places[d.k]; p ? (closePage(), goTo(p)) : openSearch(d.k); },
  recent: d => { closePage(); goTo(recents[+d.i]); },
  fav: d => { closePage(); goTo(places.fav[+d.i]); },
  result: d => pickResult(searchResults[+d.i]),
  trips: openTrips,
  install: async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice.catch(() => { }); installEvt = null; renderHome(); },
  cancel: cancelPlan,
  favtoggle: () => {
    const d = st.stops[st.stops.length - 1], i = places.fav.findIndex(p => Math.abs(p.lon - d.lon) < 1e-4 && Math.abs(p.lat - d.lat) < 1e-4);
    if (i >= 0) places.fav.splice(i, 1); else places.fav.unshift({ name: d.name, sub: d.sub || '', lon: d.lon, lat: d.lat });
    savePlaces(); renderPlan();
    toast({ icon: 'star', title: i >= 0 ? 'Odebráno z oblíbených' : 'Uloženo do oblíbených' });
  },
  prio: d => { S.priority = d.v; saveSettings(); st.routes.length ? resort() : renderPlan(); },
  avoid: () => { S.avoidHighways = !S.avoidHighways; afterSetting('avoidHighways'); },
  addstop: () => openSearch('stop'),
  pick: d => selectRoute(st.routes[+d.i]),
  go: () => startNav(st.selR),
  sim: () => startNav(st.selR, { sim: true }),
  end: endNav,
  mute: () => { S.muted = !S.muted; afterSetting('muted'); refreshModeSheet(); toast({ icon: S.muted ? 'mute' : 'volume', title: S.muted ? 'Hlas ztlumen' : 'Hlas zapnut', ms: 1800 }); },
  rally: () => { st.rally = !st.rally; renderNav(); if (!st.rally) $('pace').hidden = true; voice.say(st.rally ? 'Rally rozpis zapnut.' : 'Rally rozpis vypnut.', { priority: 2 }); },
  report: openReport,
  rep: d => addReportUI(d.v),
  vote: d => {
    const r = reports.find(x => String(x.id) === d.id) || (st.ask && String(st.ask.id) === d.id ? st.ask : null);
    voteReport(r ? r.id : d.id, +d.v); clearAsk(); closeModal();
    toast({ icon: 'check', title: 'Díky!', sub: +d.v > 0 ? 'Hlášení zůstane déle' : 'Hlášení zmizí', ms: 2500 });
  },
  search: () => openSearch('dest'),
  settings: openSettings,
  layers: openLayers,
  geo: () => { geo.low = false; geo.boot = 0; startGPS(); renderGeo(); },
  near: d => openNearby(d.k),
  nearpick: d => { const p = nearList[+d.i]; if (!p) return; closePage(); if (st.mode === 'drive') exitDrive(true); goTo({ name: p.name, sub: p.sub, lon: p.lon, lat: p.lat }); },
  rec: () => rec.active ? stopRec() : startRec(false),
  recstop: () => rec.active && stopRec(),
  driveend: () => exitDrive(true),
  expand: () => toggleSheet(),
  overview: () => { if (!st.navRoute) return; setFollow(false); map.easeTo({ pitch: 0, bearing: 0, duration: 400 }); setTimeout(() => fitRoutes([st.navRoute]), 420); toast({ icon: 'locate', title: 'Přehled trasy', sub: 'Zpátky na jízdu tlačítkem se šipkou vpravo', ms: 3500 }); },
  fuelahead: fuelAhead,
  fuelvia: d => fuelList[+d.i] && fuelVia(fuelList[+d.i]),
  share: shareEta,
  hud: openHud,
  simspeed: () => { st.simMult = st.simMult === 1 ? 2 : st.simMult === 2 ? 4 : 1; if (st.sim) st.sim.mult = st.simMult; renderNav(); },
  want: d => { st.joyWants[d.k] = !st.joyWants[d.k]; rerenderPage(); },
  joyplan: planJoy,
  joyedit: openJoy,
  joypick: d => selectRoute(st.joyRoutes[+d.i]),
  joygo: () => startNav(st.selR, { joy: true }),
  joysim: () => startNav(st.selR, { joy: true, sim: true }),
  trip: d => openTrip(d.id),
  tripmap: tripOnMap,
  tripagain: tripAgain,
  tripgpx: () => st.trip && download(st.trip.name.replace(/[^\p{L}\d]+/gu, '-') + '.gpx', toGPX(st.trip), 'application/gpx+xml'),
  tripdel: async () => { if (!st.trip || !confirm('Smazat tuhle jízdu?')) return; await trips.del(st.trip.id); st.trip = null; openTrips(); },
  theme: d => { S.theme = d.v; afterSetting('theme'); rerenderPage(); },
  layer: d => { S[d.k] = !S[d.k]; afterSetting(d.k); rerenderPage(); },
  tog: d => { S[d.k] = !S[d.k]; afterSetting(d.k); rerenderPage(); },
  set: d => { S[d.k] = isNaN(+d.v) ? d.v : +d.v; afterSetting(d.k); rerenderPage(); },
  persona: d => { S.persona = d.v; afterSetting('persona'); voice.say(TEST[d.v], { priority: 3 }); rerenderPage(); },
  test: d => { voice.unlock(); voice.say(TEST[d.v], { priority: 3, persona: d.v }); },
  parksave: () => {
    if (!st.pos) { toast({ icon: 'locate', title: 'Poloha zatím není známá' }); return; }
    parking.set({ lon: st.pos[0], lat: st.pos[1], t: Date.now() });
    toast({ icon: 'parking', title: 'Parkování uloženo' });
    if (pageRender) rerenderPage();
  },
  parkshow: () => {
    const pk = parking.get(); if (!pk) return;
    closePage(); setFollow(false);
    destMarker.setLngLat([pk.lon, pk.lat]).addTo(map);
    map.flyTo({ center: [pk.lon, pk.lat], zoom: 16.5, duration: 900 });
    toast({ icon: 'parking', title: 'Tady stojí auto', sub: ago(pk.t) + (st.pos ? ' · ' + fmtDist(dist(st.pos, [pk.lon, pk.lat])) + ' odsud' : ''), ms: 6000 });
  },
};
function onAct(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'test') e.stopPropagation();
  voice.unlock();
  const f = ACT[b.dataset.act];
  f && f(b.dataset, b);
}
sheetBody.addEventListener('click', onAct);
$('modalCard').addEventListener('click', onAct);
$('dash').addEventListener('click', onAct);
$('status').addEventListener('click', onAct);
$('pageBody').addEventListener('click', e => { const t = e.target.closest('[data-act="test"]'); if (t) { e.stopPropagation(); ACT.test(t.dataset); return; } onAct(e); });

$('layersBtn').onclick = openLayers;
$('reportBtn').onclick = openReport;
$('locBtn').onclick = () => {
  if (!st.pos) { toast({ icon: 'locate', title: 'Čekám na polohu…', sub: 'Venku pod širým nebem to jde rychleji.' }); return; }
  setFollow(true);
  if (st.mode === 'nav' && st.navState) onNavUpdate(st.navState);
  else if (st.mode === 'drive') map.easeTo({ center: st.pos, zoom: 16, pitch: 50, bearing: st.heading || 0, padding: drivePad(), duration: 700 });
  else map.easeTo({ center: st.pos, zoom: Math.max(map.getZoom(), 15), bearing: 0, pitch: 0, duration: 700, padding: homePad() });
};
document.addEventListener('pointerdown', () => voice.unlock(), { once: true });

// ---------- start ----------
hydrateIcons(document);
renderHome();
startGPS();
loadData().then(() => {
  setData('cams', camsGeoJSON()); setData('sections', sectionsGeoJSON());
  const waitBumps = () => db.bumps.length ? setData('bumps', bumpsGeoJSON()) : setTimeout(waitBumps, 800);
  waitBumps();
}).catch(e => console.warn('data', e));
drawReports();
shared.onChange = list => {
  reports = list; drawReports();
  st.nav && st.nav.setReports && st.nav.setReports(reports);
  const m = $('homeMeta'); if (m) m.textContent = trafficMeta();
};
startReportSync();
traffic.onChange = () => {
  const g = trafficGeoJSON();
  setData('flow', g.flow); setData('tlines', g.lines); setData('tevents', g.events);
  { const m = $('homeMeta'); if (m) m.textContent = trafficMeta(); }
  if (st.mode === 'nav' && st.navRoute && st.navRoute.edges !== undefined) {
    const notes = st.navRoute.a.notes;
    st.navRoute.a = analyze(st.navRoute, st.navRoute.edges, prefs());
    st.navRoute.a.notes = notes;
  }
};
startAutoRefresh(() => [st.pos || map.getCenter().toArray()]);
setInterval(() => { applyTheme(); drawReports(); }, 60000);
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
window.__nav = { st, map, plan, goTo, startNav, handleFix, enterDrive, askVote, setGeo };
