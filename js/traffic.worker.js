// Web Worker: stáhne živou dopravu z NDIC (dopravniinfo.cz) pro vybrané kraje a převede ji do WGS84.
import { jtsk2wgs, decodePolyline } from './geo.js';

const API = 'https://api.dopravniinfo.cz/RegionData.ashx?region=';

function geo(s) {
  if (!s) return null;
  const sp = s.indexOf(' ');
  const pts = decodePolyline(sp >= 0 ? s.slice(sp + 1) : s, 0);
  // decodePolyline vrací [lng, lat] = [Y, X] v S-JTSK
  return pts.map(([y, x]) => jtsk2wgs(x, y)).map(([lo, la]) => [Math.round(lo * 1e5) / 1e5, Math.round(la * 1e5) / 1e5]);
}
const date = s => s && s !== 'None' ? Date.parse(s.replace(' ', 'T')) : NaN;

function classify(it) {
  const t = (it.Title || ''), d = (it.Description || '').toLowerCase(), all = t.toLowerCase() + ' ' + d;
  if (/parkování/i.test(t)) return null;
  if (/nehod/.test(all)) return 'accident';
  if (/kolon|zácp|popojížd|hustý provoz|zpomalen|zdržení|stojící provoz/.test(all)) return 'jam';
  if (/uzavř|uzavírk|neprůjezd/.test(all)) return 'closure';
  if (/práce|oprav|stavební|výstavb|rekonstrukc/.test(all)) return 'works';
  if (/nebezpeč|překážk|sjízdnost|náledí|sníh|mlh|zvěř|porouchan|předmět|chodci/.test(all)) return 'hazard';
  return 'info';
}
const isFull = d => /uzavřen|úplná uzavírka|neprůjezdn/.test(d) && !/pruh|část|jednosměr|střídav|protisměr|omezen|kyvadl|pouze|zúžen/.test(d);

async function region(code) {
  const r = await fetch(API + code);
  if (!r.ok) throw new Error('NDIC ' + r.status);
  const j = await r.json();
  const now = Date.now(), events = [], fcd = [];
  for (const it of j.Information || []) {
    const from = date(it.ValidFrom), to = date(it.ValidTo);
    if (from > now || to < now) continue;
    const kind = classify(it);
    if (!kind) continue;
    let p = null;
    try { p = jtsk2wgs(+it.X, +it.Y); } catch { continue; }
    let line = null;
    try { line = geo(it.Geo); } catch { }
    const desc = (it.Description || '').replace(/,?\s*(Zveřejněno|Vydal):.*$/i, '').trim();
    events.push({
      id: 'n' + it.Id, kind, title: it.Title, loc: it.Locality, desc, road: it.RoadNumber && it.RoadNumber !== 'None' ? it.RoadNumber : '',
      lon: p[0], lat: p[1], line: line && line.length > 1 ? line : null, full: kind === 'closure' && isFull((it.Description || '').toLowerCase()),
      to: isNaN(to) ? null : to,
    });
  }
  for (const s of j.Fcd || []) {
    const lvl = +s.VD10;
    if (!(lvl >= 3)) continue;
    let coords = null;
    try { coords = geo(s.Geo); } catch { }
    if (!coords || coords.length < 2) continue;
    fcd.push({ lvl, v: +s.VD2 || 0, free: +s.VD5 || 0, road: s.RoadNumber, coords });
  }
  return { code, events, fcd, t: now };
}

self.onmessage = async e => {
  const { id, codes } = e.data;
  const out = [];
  await Promise.all(codes.map(c => region(c).then(r => out.push(r)).catch(err => out.push({ code: c, error: String(err) }))));
  self.postMessage({ id, regions: out });
};
