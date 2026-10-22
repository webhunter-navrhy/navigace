// Rally rozpis: z geometrie trasy spočítá zatáčky (stupeň 1–6, vracák), jejich délku, utahování a mezery mezi nimi.
import { dist, bearing, angDiff, pointAt } from './geo.js';

const STEP = 10;

// převzorkování trasy po 10 m + poloměr zatáčky v každém bodě (kružnice přes body ±30 m)
export function profile(coords, cum) {
  const total = cum[cum.length - 1], n = Math.max(2, Math.floor(total / STEP) + 1);
  const pts = new Array(n), s = new Float64Array(n);
  for (let i = 0; i < n; i++) { s[i] = Math.min(total, i * STEP); pts[i] = pointAt(coords, cum, s[i]); }
  const R = new Float64Array(n).fill(Infinity), sign = new Int8Array(n), head = new Float64Array(n);
  const k = 3;
  const lat0 = pts[0][1], kx = Math.cos(lat0 * Math.PI / 180) * 111320, ky = 110540;
  for (let i = 0; i < n; i++) head[i] = bearing(pts[Math.max(0, i - 1)], pts[Math.min(n - 1, i + 1)]);
  for (let i = k; i < n - k; i++) {
    const a = pts[i - k], b = pts[i], c = pts[i + k];
    const ax = a[0] * kx, ay = a[1] * ky, bx = b[0] * kx, by = b[1] * ky, cx = c[0] * kx, cy = c[1] * ky;
    const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const ab = Math.hypot(bx - ax, by - ay), bc = Math.hypot(cx - bx, cy - by), ca = Math.hypot(ax - cx, ay - cy);
    if (Math.abs(cross) < 1e-6) continue;
    R[i] = ab * bc * ca / (2 * Math.abs(cross));
    sign[i] = cross > 0 ? -1 : 1; // +1 = doprava
  }
  // lehké vyhlazení: poloměr = medián tří sousedů
  const Rs = new Float64Array(n);
  for (let i = 0; i < n; i++) { const a = [R[Math.max(0, i - 1)], R[i], R[Math.min(n - 1, i + 1)]].sort((x, y) => x - y); Rs[i] = a[1]; }
  return { n, s, pts, R: Rs, sign, head, total };
}

function grade(minR, angle) {
  if (minR < 22) return angle > 135 ? 'V' : 'O';
  if (minR < 40) return 1;
  if (minR < 70) return 2;
  if (minR < 110) return 3;
  if (minR < 180) return 4;
  if (minR < 300) return 5;
  return 6;
}
const NUM = { 1: 'jedna', 2: 'dva', 3: 'tři', 4: 'čtyři', 5: 'pět', 6: 'šest' };
const GAPS = [50, 70, 100, 150, 200, 250, 300];
const GAP_SAY = { 50: 'padesát', 70: 'sedmdesát', 100: 'sto', 150: 'sto padesát', 200: 'dvě stě', 250: 'dvě stě padesát', 300: 'tři sta' };

// skipAt(s) → true, kde zatáčku nehlásit (křižovatka s odbočením, obec)
export function buildNotes(pr, skipAt = () => false) {
  const TH = 1 / 420;
  const runs = [];
  let cur = null;
  for (let i = 0; i < pr.n; i++) {
    const c = pr.R[i] < Infinity ? 1 / pr.R[i] : 0;
    if (c > TH) {
      if (cur && cur.dir === pr.sign[i] && i - cur.end <= 2) { cur.end = i; }
      else { if (cur) runs.push(cur); cur = { dir: pr.sign[i], start: i, end: i }; }
    }
  }
  if (cur) runs.push(cur);
  // sloučit běhy stejného směru s mezerou < 20 m
  const merged = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && last.dir === r.dir && (r.start - last.end) * STEP < 20) last.end = r.end; else merged.push({ ...r });
  }
  const notes = [];
  for (const r of merged) {
    const a = Math.max(0, r.start - 1), b = Math.min(pr.n - 1, r.end + 1);
    let angle = Math.abs(angDiff(pr.head[a], pr.head[b]));
    if (angle < 20) continue;
    let minR = Infinity, rFirst = Infinity, rLast = Infinity;
    const third = Math.max(1, Math.floor((r.end - r.start + 1) / 3));
    for (let i = r.start; i <= r.end; i++) {
      minR = Math.min(minR, pr.R[i]);
      if (i < r.start + third) rFirst = Math.min(rFirst, pr.R[i]);
      if (i > r.end - third) rLast = Math.min(rLast, pr.R[i]);
    }
    const g = grade(minR, angle);
    if (g === 6 && angle < 30) continue;
    const s0 = pr.s[r.start], s1 = pr.s[r.end];
    if (skipAt(s0, s1)) continue;
    const mods = [];
    const len = s1 - s0;
    if ((len > 160 && g !== 6) || (angle > 120 && typeof g === 'number' && g >= 3)) mods.push('dlouhá');
    if (r.end - r.start >= 5) {
      if (rLast < rFirst * 0.62) mods.push('utahuje');
      else if (rFirst < rLast * 0.62) mods.push('otevírá');
    }
    notes.push({ s: s0, end: s1, dir: r.dir > 0 ? 'P' : 'L', g, mods, minR: Math.round(minR), angle: Math.round(angle) });
  }
  for (let i = 0; i < notes.length; i++) {
    const nx = notes[i + 1];
    if (!nx) continue;
    const gap = nx.s - notes[i].end;
    notes[i].gap = gap < 25 ? 'do' : gap < 45 ? 'a' : gap > 330 ? null : GAPS.reduce((p, c) => Math.abs(c - gap) < Math.abs(p - gap) ? c : p);
  }
  for (const n of notes) {
    const word = n.dir === 'P' ? 'pravá' : 'levá';
    const gWord = n.g === 'V' ? 'vracák' : n.g === 'O' ? 'ostrá' : NUM[n.g];
    const gShort = n.g === 'V' ? 'V' : n.g === 'O' ? '!' : n.g;
    n.label = n.dir + gShort;
    n.say = `${word} ${gWord}${n.mods.length ? ' ' + n.mods.join(' ') : ''}`;
    n.sayGap = n.gap == null ? '' : n.gap === 'do' ? 'do' : n.gap === 'a' ? 'a' : GAP_SAY[n.gap];
    n.short = `${n.label}${n.mods.includes('utahuje') ? '›' : ''}${n.mods.includes('otevírá') ? '‹' : ''}${n.mods.includes('dlouhá') ? '+' : ''}`;
  }
  return notes;
}

// míra „zábavnosti“: km v zatáčkách poloměru 35–260 m mimo obce a dálnice
export function funMeters(pr, isBoring) {
  let m = 0;
  for (let i = 0; i < pr.n - 1; i++) {
    if (pr.R[i] >= 35 && pr.R[i] <= 260 && !isBoring(pr.s[i])) m += STEP;
  }
  return m;
}
export { STEP as PROFILE_STEP };
