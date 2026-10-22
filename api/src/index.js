// Sdílená hlášení řidičů pro Navigaci (webhunter-navrhy.github.io/navigace).
// GET /reports?w=&s=&e=&n=   aktivní hlášení ve výřezu
// POST /reports {type, lon, lat, heading}   nové hlášení (nebo potvrzení stejného poblíž)
// POST /vote {id, v: 1|-1}   „pořád tam“ / „už tam není“
const TYPES = { police: 60, mcam: 90, jam: 40, accident: 60, hazard: 60, closure: 240 }; // minuty platnosti
const CZ = { w: 12.0, s: 48.5, e: 18.9, n: 51.1 };
const MAX_PER_HOUR = 15;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors, ...extra } });

async function ipHash(req) {
  const ip = req.headers.get('CF-Connecting-IP') || 'x';
  const d = new Date().toISOString().slice(0, 10); // sůl se mění denně, IP se neukládá
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip + '|navigace|' + d));
  return [...new Uint8Array(buf)].slice(0, 10).map(b => b.toString(16).padStart(2, '0')).join('');
}
const inCZ = (lon, lat) => lon >= CZ.w && lon <= CZ.e && lat >= CZ.s && lat <= CZ.n;
const out = r => ({ id: r.id, type: r.type, lon: r.lon, lat: r.lat, heading: r.heading, t: r.t, exp: r.exp, up: r.up, down: r.down });

async function list(url, env) {
  const q = k => parseFloat(url.searchParams.get(k));
  let w = q('w'), s = q('s'), e = q('e'), n = q('n');
  if ([w, s, e, n].some(isNaN)) ({ w, s, e, n } = CZ);
  const { results } = await env.DB.prepare('SELECT * FROM reports WHERE exp > ?1 AND lon BETWEEN ?2 AND ?3 AND lat BETWEEN ?4 AND ?5 ORDER BY t DESC LIMIT 400')
    .bind(Date.now(), w, e, s, n).all();
  return json({ now: Date.now(), reports: results.map(out) }, 200, { 'Cache-Control': 'public, max-age=20' });
}

async function add(req, env) {
  const b = await req.json().catch(() => ({}));
  const type = String(b.type || ''), lon = +b.lon, lat = +b.lat;
  if (!TYPES[type] || !inCZ(lon, lat)) return json({ error: 'neplatné hlášení' }, 400);
  const ip = await ipHash(req), now = Date.now();
  const n = await env.DB.prepare('SELECT COUNT(*) AS c FROM reports WHERE ip = ?1 AND t > ?2').bind(ip, now - 3600e3).first('c');
  if (n >= MAX_PER_HOUR) return json({ error: 'moc hlášení za hodinu' }, 429);
  // stejný typ do 300 m = potvrzení existujícího hlášení
  const d = 300 / 111320, dl = d / Math.cos(lat * Math.PI / 180);
  const near = await env.DB.prepare('SELECT * FROM reports WHERE type = ?1 AND exp > ?2 AND lon BETWEEN ?3 AND ?4 AND lat BETWEEN ?5 AND ?6 LIMIT 1')
    .bind(type, now, lon - dl, lon + dl, lat - d, lat + d).first();
  const exp = now + TYPES[type] * 60e3;
  if (near) {
    await env.DB.prepare('UPDATE reports SET up = up + 1, exp = MAX(exp, ?2) WHERE id = ?1').bind(near.id, exp).run();
    return json({ report: out({ ...near, up: near.up + 1, exp: Math.max(near.exp, exp) }), merged: true });
  }
  const id = 'r' + now.toString(36) + Math.random().toString(36).slice(2, 7);
  const heading = Number.isFinite(+b.heading) ? Math.round(+b.heading) % 360 : null;
  await env.DB.prepare('INSERT INTO reports (id, type, lon, lat, heading, t, exp, ip) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)')
    .bind(id, type, Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5, heading, now, exp, ip).run();
  return json({ report: { id, type, lon, lat, heading, t: now, exp, up: 1, down: 0 } }, 201);
}

async function vote(req, env) {
  const b = await req.json().catch(() => ({}));
  const id = String(b.id || ''), v = +b.v === -1 ? -1 : 1;
  const r = await env.DB.prepare('SELECT * FROM reports WHERE id = ?1').bind(id).first();
  if (!r) return json({ error: 'hlášení neexistuje' }, 404);
  const ip = await ipHash(req), now = Date.now();
  const ins = await env.DB.prepare('INSERT OR IGNORE INTO votes (id, ip, v) VALUES (?1, ?2, ?3)').bind(id, ip, v).run();
  if (!ins.meta.changes) return json({ report: out(r), dup: true });
  let { up, down, exp } = r;
  if (v > 0) { up++; exp = Math.max(exp, now + TYPES[r.type] * 30e3); }
  else { down++; if (down >= up) exp = now; }
  await env.DB.prepare('UPDATE reports SET up = ?2, down = ?3, exp = ?4 WHERE id = ?1').bind(id, up, down, exp).run();
  return json({ report: out({ ...r, up, down, exp }) });
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const url = new URL(req.url);
    try {
      if (url.pathname === '/reports' && req.method === 'GET') return await list(url, env);
      if (url.pathname === '/reports' && req.method === 'POST') return await add(req, env);
      if (url.pathname === '/vote' && req.method === 'POST') return await vote(req, env);
      if (url.pathname === '/') return json({ ok: true, app: 'navigace-api' });
      return json({ error: 'nenalezeno' }, 404);
    } catch (e) {
      return json({ error: 'chyba serveru' }, 500);
    }
  },
  async scheduled(_ev, env) {
    const old = Date.now() - 6 * 3600e3;
    await env.DB.prepare('DELETE FROM reports WHERE exp < ?1').bind(old).run();
    await env.DB.prepare('DELETE FROM votes WHERE id NOT IN (SELECT id FROM reports)').run();
  },
};
