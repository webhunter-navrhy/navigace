// Jízda bez cíle: co je před autem ve směru jízdy (radary, úsekovky, prahy, hlášení řidičů, nehody a kolony).
import { db } from './data.js?v=b41a3a0790';
import { traffic } from './traffic.js?v=b41a3a0790';
import { dist, bearing, angDiff } from './geo.js?v=b41a3a0790';

// předek auta jako výseč: blízko širší (zatáčka), daleko úzká (jen to, co je opravdu před námi)
function ahead(p, heading, q, lead) {
  const d = dist(p, q);
  if (d < 20 || d > lead) return -1;
  const da = Math.abs(angDiff(heading, bearing(p, q)));
  return da < (d < 150 ? 40 : d < 400 ? 24 : 14) ? d : -1;
}

// v = m/s; vrací seřazený seznam {key, kind, d, ms, ev, rep}
export function lookAhead(p, heading, v, reports, opts = {}) {
  if (heading == null) return [];
  const out = [], camLead = Math.min(1500, Math.max(450, v * 18));
  if (opts.cams !== false) {
    for (const c of db.camGrid.near(p[0], p[1], 1)) {
      const d = ahead(p, heading, [c.lon, c.lat], camLead);
      if (d >= 0) out.push({ key: c.id, kind: 'cam', d, ms: c.ms });
    }
    for (const z of db.sections) {
      if (Math.abs(z.a[0] - p[0]) > 0.03 || Math.abs(z.a[1] - p[1]) > 0.02) continue;
      const d = ahead(p, heading, z.a, camLead);
      if (d >= 0) out.push({ key: z.id, kind: 'secStart', d, ms: z.ms });
    }
  }
  if (opts.bumps !== false && v > 6) for (const b of db.bumpGrid.near(p[0], p[1], 1)) {
    const d = ahead(p, heading, [b.lon, b.lat], Math.max(90, v * 7));
    if (d >= 0) out.push({ key: 'b' + b.lon + ',' + b.lat, kind: 'bump', d });
  }
  for (const r of reports) {
    const d = ahead(p, heading, [r.lon, r.lat], Math.max(900, v * 40));
    if (d >= 0) out.push({ key: r.id, kind: r.type === 'police' ? 'police' : 'report', d, rep: r });
  }
  if (opts.traffic !== false) for (const e of traffic.eventGrid.near(p[0], p[1], 1)) {
    if (!['accident', 'jam'].includes(e.kind) && !(e.kind === 'closure' && e.full)) continue;
    const d = ahead(p, heading, [e.lon, e.lat], Math.max(1200, v * 50));
    if (d >= 0 && !out.some(x => x.key === e.id)) out.push({ key: e.id, kind: e.kind, d, ev: e });
  }
  return out.sort((a, b) => a.d - b.d);
}
