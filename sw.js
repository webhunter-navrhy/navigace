// Service worker: aplikace funguje i při slabém signálu. Kód z precache, dlaždice a fonty z runtime cache, API vždy živě.
const V = '__V__';
const SHELL = `shell-${V}`, TILES = 'tiles-v1', LIBS = 'libs-v1';
const FILES = __FILES__;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('shell-') && k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

async function trim(name, max) {
  const c = await caches.open(name), keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}
async function cacheFirst(req, name, max) {
  const c = await caches.open(name), hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') { c.put(req, res.clone()); if (max && Math.random() < 0.05) trim(name, max); }
  return res;
}
async function staleWhileRevalidate(req, name, max) {
  const c = await caches.open(name), hit = await c.match(req);
  const net = fetch(req).then(res => { if (res.ok) { c.put(req, res.clone()); if (Math.random() < 0.05) trim(name, max); } return res; }).catch(() => hit);
  return hit || net;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin === location.origin) {
    if (req.mode === 'navigate') { e.respondWith(fetch(req).catch(() => caches.match('./'))); return; }
    e.respondWith(caches.match(req).then(hit => hit || fetch(req)));
    return;
  }
  if (u.hostname === 'tiles.openfreemap.org') {
    // dlaždice jsou neměnné v rámci verze, styl/TileJSON obnovovat
    if (/\/\d+\/\d+\/\d+\.pbf$/.test(u.pathname) || u.pathname.startsWith('/fonts/')) e.respondWith(cacheFirst(req, TILES, 4000));
    else e.respondWith(staleWhileRevalidate(req, TILES, 4000));
    return;
  }
  if (u.hostname === 'cdn.jsdelivr.net' || u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com') {
    e.respondWith(cacheFirst(req, LIBS, 200));
  }
  // ostatní (Valhalla, Photon, NDIC, OSRM) jdou vždy na síť
});
