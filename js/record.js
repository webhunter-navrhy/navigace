// Nahrávání jízd: body po ~1 s / 5 m, průběžné ukládání, statistiky a export do GPX.
import { dist } from './geo.js';
import { trips } from './store.js';

export class Recorder {
  constructor() { this.trip = null; }
  get active() { return !!this.trip; }
  start(name) {
    this.trip = { id: 't' + Date.now(), start: Date.now(), end: Date.now(), name: name || '', pts: [], dist: 0, max: 0 };
    this.lastSave = 0;
  }
  add(fix) {
    const t = this.trip; if (!t || fix.sim && !this.allowSim) return;
    const p = [Math.round(fix.lon * 1e6) / 1e6, Math.round(fix.lat * 1e6) / 1e6, Date.now(), Math.round((fix.speed || 0) * 36) / 10];
    const last = t.pts[t.pts.length - 1];
    if (last) {
      const d = dist(last, p);
      if (d < 5 && p[2] - last[2] < 5000) return;
      if (d > 500 && (p[2] - last[2]) < 3000) return; // skok GPS
      t.dist += d;
    }
    t.max = Math.max(t.max, p[3]);
    t.pts.push(p); t.end = p[2];
    if (Date.now() - this.lastSave > 15000) { this.lastSave = Date.now(); trips.put(t).catch(() => {}); }
  }
  async stop() {
    const t = this.trip; this.trip = null;
    if (!t || t.pts.length < 5) { if (t) trips.del(t.id).catch(() => {}); return null; }
    if (!t.name) t.name = 'Jízda ' + new Date(t.start).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long' }) + ', ' + new Date(t.start).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
    await trips.put(t);
    return t;
  }
}

export function stats(t) {
  const dur = (t.end - t.start) / 1000;
  return { dist: t.dist, dur, avg: dur > 0 ? t.dist / dur * 3.6 : 0, max: t.max };
}

export function toGPX(t) {
  const pts = t.pts.map(([lon, lat, ts, v]) => `<trkpt lat="${lat}" lon="${lon}"><time>${new Date(ts).toISOString()}</time><extensions><speed>${(v / 3.6).toFixed(2)}</speed></extensions></trkpt>`).join('\n');
  const esc = s => s.replace(/[<&>]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Navigace" xmlns="http://www.topografix.com/GPX/1/1">\n<trk><name>${esc(t.name)}</name><trkseg>\n${pts}\n</trkseg></trk>\n</gpx>`;
}

// malý náhled trasy do canvasu (bez mapových dlaždic)
export function drawThumb(canvas, t, color, speedColors) {
  const ctx = canvas.getContext('2d'), dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 120, H = canvas.clientHeight || 80;
  canvas.width = W * dpr; canvas.height = H * dpr; ctx.scale(dpr, dpr);
  if (t.pts.length < 2) return;
  let w = 180, e = -180, s = 90, n = -90;
  for (const [x, y] of t.pts) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  const kx = Math.cos((s + n) / 2 * Math.PI / 180), pad = 8;
  const sc = Math.min((W - pad * 2) / Math.max((e - w) * kx, 1e-6), (H - pad * 2) / Math.max(n - s, 1e-6));
  const ox = (W - (e - w) * kx * sc) / 2, oy = (H - (n - s) * sc) / 2;
  const P = ([x, y]) => [ox + (x - w) * kx * sc, H - oy - (y - s) * sc];
  ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (let i = 1; i < t.pts.length; i++) {
    const a = P(t.pts[i - 1]), b = P(t.pts[i]);
    ctx.strokeStyle = speedColors ? speedColors(t.pts[i][3]) : color;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  const st = P(t.pts[0]);
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(st[0], st[1], 3, 0, 7); ctx.fill();
}
