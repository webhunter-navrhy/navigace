// Nastavení, místa, historie (localStorage) a nahrané jízdy (IndexedDB).
const LS = 'navigace:';
const read = (k, d) => { try { const v = localStorage.getItem(LS + k); return v ? JSON.parse(v) : d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch { } };

export const DEFAULTS = {
  theme: 'pulnoc', persona: 'navigatorka', voiceURI: null, volume: 1, muted: false,
  priority: 'fast', avoidHighways: false, tempo: 1, learnTempo: true,
  warnCams: true, warnBumps: true, warnTraffic: true, warnOver: true, overTol: 5, voiceAlerts: true,
  rally: false, rallyPersona: true, showTraffic: true, showCams: true, showBumps: false, autoNight: false,
  hud: false, record: false, sport: false,
};
export const settings = { ...DEFAULTS, ...read('settings', {}) };
export const saveSettings = () => write('settings', settings);

export const places = read('places', { home: null, work: null, fav: [] });
export const savePlaces = () => write('places', places);

export const recents = read('recents', []);
export function addRecent(p) {
  const i = recents.findIndex(r => r.name === p.name && Math.abs(r.lon - p.lon) < 1e-4);
  if (i >= 0) recents.splice(i, 1);
  recents.unshift({ name: p.name, sub: p.sub || '', lon: p.lon, lat: p.lat });
  recents.length = Math.min(recents.length, 12);
  write('recents', recents);
}

// naučené tempo: poměr skutečné rychlosti k limitu na volné silnici
export const learned = read('learned', { ratio: 1, samples: 0 });
export function learnSample(kmh, limit) {
  if (!limit || kmh < limit * 0.6 || kmh > limit * 1.5) return;
  const r = kmh / limit;
  learned.ratio = learned.ratio + (r - learned.ratio) / Math.min(2000, ++learned.samples);
  if (learned.samples % 30 === 0) write('learned', learned);
}

// hlášení (policie, kolona…) — místní, s expirací
export function loadReports() {
  const now = Date.now();
  return read('reports', []).filter(r => r.exp > now);
}
export function saveReports(list) { write('reports', list); }
export const parking = { get: () => read('parking', null), set: p => write('parking', p) };
export const onboard = { get: () => read('onboarded', false), set: () => write('onboarded', true) };

// --- IndexedDB pro jízdy ---
let dbp = null;
function idb() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const rq = indexedDB.open('navigace', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('trips', { keyPath: 'id' });
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
  return dbp;
}
async function tx(mode, fn) {
  const d = await idb();
  return new Promise((res, rej) => {
    const t = d.transaction('trips', mode), st = t.objectStore('trips');
    const r = fn(st);
    t.oncomplete = () => res(r && r.result);
    t.onerror = () => rej(t.error);
  });
}
export const trips = {
  put: t => tx('readwrite', s => s.put(t)),
  del: id => tx('readwrite', s => s.delete(id)),
  all: async () => { const list = await tx('readonly', s => s.getAll()); return (list || []).sort((a, b) => b.start - a.start); },
  get: id => tx('readonly', s => s.get(id)),
};
