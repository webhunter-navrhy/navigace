// Geometrie: vzdálenosti, projekce na trasu, mřížkový index, polyline, S-JTSK → WGS84.
export const R = 6371008.8;
const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;

export function dist(a, b) { // [lon,lat]
  const dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
export function bearing(a, b) {
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
  const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}
export function dest(p, brg, m) {
  const d = m / R, b = rad(brg), la = rad(p[1]), lo = rad(p[0]);
  const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
  const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
  return [deg(lo2), deg(la2)];
}
export const angDiff = (a, b) => { let d = (b - a + 540) % 360 - 180; return d; };

// lokální rovinná aproximace pro rychlé výpočty kolem jednoho místa
export function flat(lat0) {
  const kx = Math.cos(rad(lat0)) * 111320, ky = 110540;
  return { kx, ky, xy: p => [p[0] * kx, p[1] * ky] };
}

// nejbližší bod na úsečce; vrací {d, t}
export function segProj(p, a, b, kx, ky) {
  const ax = a[0] * kx, ay = a[1] * ky, bx = b[0] * kx, by = b[1] * ky, px = p[0] * kx, py = p[1] * ky;
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx - px, qy = ay + t * dy - py;
  return { d: Math.sqrt(qx * qx + qy * qy), t };
}

// kumulativní vzdálenosti podél linie
export function cumDist(coords) {
  const c = new Float64Array(coords.length);
  for (let i = 1; i < coords.length; i++) c[i] = c[i - 1] + dist(coords[i - 1], coords[i]);
  return c;
}
export function pointAt(coords, cum, s) {
  let lo = 0, hi = cum.length - 1;
  if (s <= 0) return coords[0];
  if (s >= cum[hi]) return coords[hi];
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] < s) lo = m; else hi = m; }
  const t = (s - cum[lo]) / ((cum[hi] - cum[lo]) || 1);
  return [coords[lo][0] + t * (coords[hi][0] - coords[lo][0]), coords[lo][1] + t * (coords[hi][1] - coords[lo][1])];
}

// projekce bodu na linii (volitelně jen v okně indexů) → {i, t, d, s}
export function project(coords, cum, p, from = 0, to = coords.length - 1) {
  const { kx, ky } = flat(p[1]);
  let best = { d: Infinity, i: 0, t: 0, s: 0 };
  from = Math.max(0, from); to = Math.min(coords.length - 1, to);
  for (let i = from; i < to; i++) {
    const r = segProj(p, coords[i], coords[i + 1], kx, ky);
    if (r.d < best.d) best = { d: r.d, i, t: r.t, s: cum[i] + r.t * (cum[i + 1] - cum[i]) };
  }
  return best;
}

// mřížkový index bodů/úseček pro rychlé hledání v okolí
export class Grid {
  constructor(cell = 0.02) { this.cell = cell; this.m = new Map(); }
  key(lon, lat) { return Math.floor(lon / this.cell) + ':' + Math.floor(lat / this.cell); }
  add(lon, lat, item) { const k = this.key(lon, lat); let a = this.m.get(k); if (!a) this.m.set(k, a = []); a.push(item); }
  near(lon, lat, r = 1) {
    const cx = Math.floor(lon / this.cell), cy = Math.floor(lat / this.cell), out = [];
    for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) { const a = this.m.get(x + ':' + y); if (a) out.push(...a); }
    return out;
  }
}

export function decodePolyline(s, precision = 6) {
  const f = 10 ** precision, out = [];
  let i = 0, lat = 0, lng = 0;
  while (i < s.length) {
    for (let w = 0; w < 2; w++) {
      let shift = 0, res = 0, b;
      do { b = s.charCodeAt(i++) - 63; res |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const v = res & 1 ? ~(res >> 1) : res >> 1;
      if (w === 0) lat += v; else lng += v;
    }
    out.push([lng / f, lat / f]);
  }
  return out;
}
export function encodePolyline(coords, precision = 6) {
  const f = 10 ** precision; let pl = 0, pg = 0, s = '';
  const enc = v => { v = v < 0 ? ~(v << 1) : v << 1; let o = ''; while (v >= 0x20) { o += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return o + String.fromCharCode(v + 63); };
  for (const [lng, lat] of coords) { const a = Math.round(lat * f), b = Math.round(lng * f); s += enc(a - pl) + enc(b - pg); pl = a; pg = b; }
  return s;
}

// S-JTSK (EPSG:5514, záporné souřadnice v metrech) → [lon, lat] WGS84
export function jtsk2wgs(x5514, y5514, H = 300) {
  const Y = Math.abs(x5514), X = Math.abs(y5514);
  const e = 0.081696831215303, n = 0.97992470462083, rho0 = 12310230.12797036;
  const sinUQ = 0.863499969506341, cosUQ = 0.504348889819882, sinVQ = 0.420215144586493, cosVQ = 0.907424504992097;
  const alfa = 1.000597498371542, k = 1.003419163966575;
  const ro = Math.hypot(X, Y), eps = 2 * Math.atan(Y / (ro + X)), D = eps / n;
  const S = 2 * Math.atan(Math.exp(1 / n * Math.log(rho0 / ro))) - Math.PI / 2;
  const sinS = Math.sin(S), cosS = Math.cos(S), sinD = Math.sin(D), cosD = Math.cos(D);
  const sinU = sinUQ * sinS - cosUQ * cosS * cosD, cosU = Math.sqrt(1 - sinU * sinU);
  const sinDV = sinD * cosS / cosU, cosDV = Math.sqrt(1 - sinDV * sinDV);
  const sinV = sinVQ * cosDV - cosVQ * sinDV, cosV = cosVQ * cosDV + sinVQ * sinDV;
  const L = 2 * Math.atan(sinV / (1 + cosV)) / alfa;
  const t = Math.exp(2 / alfa * Math.log((1 + sinU) / cosU / k));
  let pom = (t - 1) / (t + 1), sinB;
  do { sinB = pom; pom = t * Math.exp(e * Math.log((1 + e * sinB) / (1 - e * sinB))); pom = (pom - 1) / (pom + 1); } while (Math.abs(pom - sinB) > 1e-15);
  const B = Math.atan(pom / Math.sqrt(1 - pom * pom));
  // Bessel → kartézské
  let a = 6377397.15508, f1 = 299.152812853, e2 = 1 - (1 - 1 / f1) ** 2;
  let N = a / Math.sqrt(1 - e2 * Math.sin(B) ** 2);
  const x = (N + H) * Math.cos(B) * Math.cos(L), y = (N + H) * Math.cos(B) * Math.sin(L), z = ((1 - e2) * N + H) * Math.sin(B);
  // Helmertova transformace S-JTSK → WGS84
  const dx = 570.69, dy = 85.69, dz = 462.84, s = 1 / 3600 * Math.PI / 180;
  const wx = -4.99821 * s, wy = -1.58676 * s, wz = -5.2611 * s, m = 3.543e-6;
  const xn = dx + (1 + m) * (x + wz * y - wy * z), yn = dy + (1 + m) * (-wz * x + y + wx * z), zn = dz + (1 + m) * (wy * x - wx * y + z);
  a = 6378137; f1 = 298.257223563; e2 = 1 - (1 - 1 / f1) ** 2;
  const ab = f1 / (f1 - 1), p = Math.hypot(xn, yn), th = Math.atan(zn * ab / p);
  const st = Math.sin(th), ct = Math.cos(th);
  const lat = Math.atan((zn + e2 * ab * a * st ** 3) / (p - e2 * a * ct ** 3));
  const lon = 2 * Math.atan(yn / (p + xn));
  return [deg(lon), deg(lat)];
}
