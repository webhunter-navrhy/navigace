// Navigační jádro: přichycení polohy k trase, hlášení manévrů, radarů, prahů, událostí a rally rozpisu.
import { project, bearing, dist, pointAt, flat } from './geo.js?v=b41a3a0790';
import { say, phraseManeuver, phraseAlert } from './voice.js?v=b41a3a0790';

export class Navigator {
  constructor(h) { this.h = h; this.route = null; }

  start(route, stops, reports = []) {
    this.stops = stops;
    this.setRoute(route, reports);
    this.startedAt = Date.now();
    this.maxSpeed = 0;
  }

  setRoute(route, reports = []) {
    this.route = route;
    this.idx = 0; this.s = 0; this.off = 0; this.lastReroute = this.lastReroute || 0;
    this.spoken = new Set();
    this.alerted = new Set();
    this.noteIdx = 0;
    this.overSince = 0; this.lastOverSay = 0;
    this.setReports(reports);
  }

  setReports(reports) {
    const r = this.route; if (!r) return;
    this.reports = [];
    for (const rep of reports) {
      const p = project(r.coords, r.cum, [rep.lon, rep.lat]);
      if (p.d < 40) this.reports.push({ s: p.s, rep });
    }
  }

  limitAt(s) {
    const r = this.route, a = r.a;
    let lo = 0, hi = r.coords.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (r.cum[m] <= s) lo = m; else hi = m; }
    return { limit: a.lim[Math.min(lo, a.lim.length - 1)], i: lo };
  }

  feed(fix) {
    const r = this.route; if (!r) return;
    const p = [fix.lon, fix.lat];
    const v = fix.speed != null && fix.speed >= 0 ? fix.speed : 0; // m/s
    this.maxSpeed = Math.max(this.maxSpeed, v);
    // hledat v okně kolem poslední pozice, při ztrátě po celé trase
    let m = project(r.coords, r.cum, p, this.idx - 10, this.idx + 400);
    if (m.d > 60) { const g = project(r.coords, r.cum, p); if (g.d < m.d) m = g; }
    const onRoute = m.d < Math.max(45, (fix.acc || 10) * 1.2);
    if (onRoute) { this.off = 0; if (m.s >= this.s - 30) { this.idx = m.i; this.s = m.s; } }
    else this.off++;
    if (this.off >= 3 && Date.now() - this.lastReroute > 8000 && (fix.acc || 10) < 60) {
      this.lastReroute = Date.now();
      this.h.onReroute && this.h.onReroute(p, fix.heading);
    }
    const s = this.s, total = r.length, remaining = Math.max(0, total - s);
    const snapped = onRoute ? pointAt(r.coords, r.cum, s) : p;
    const ahead = pointAt(r.coords, r.cum, Math.min(total, s + Math.max(25, v * 3)));
    const brg = onRoute ? bearing(snapped, ahead) : (fix.heading != null ? fix.heading : 0);

    // čas do cíle z modelu trasy
    const { limit, i } = this.limitAt(s);
    const tCum = r.a.tCum, remT = Math.max(0, tCum[tCum.length - 1] - tCum[i] - (s - r.cum[i]) / Math.max(5, limit / 3.6));

    // další manévr
    const mans = r.maneuvers;
    let k = mans.findIndex(x => x.s > s + 3 && x.type !== 1);
    const next = k >= 0 ? mans[k] : null, after = k >= 0 ? mans[k + 1] : null;
    const dMan = next ? next.s - s : remaining;

    if (next && onRoute) this.announce(next, k, dMan, v);
    if (onRoute) this.alerts(s, v);
    if (onRoute && this.h.rally()) this.pace(s, v);
    this.speedCheck(v * 3.6, limit);

    const st = {
      pos: snapped, raw: p, bearing: brg, onRoute, s, remaining, remT, eta: Date.now() + remT * 1000,
      next, after, dMan, limit, speed: v * 3.6, notes: r.a.notes.filter(n => n.end > s && n.s < s + 900).slice(0, 4).map(n => ({ ...n, d: n.s - s })),
      upcoming: this.upcoming(s),
    };
    this.h.onUpdate && this.h.onUpdate(st);
    if (remaining < 30 && next == null || (next && [4, 5, 6].includes(next.type) && dMan < 25 && k === mans.length - 1)) {
      if (!this.arrived) { this.arrived = true; say('Jste v cíli.', { priority: 2 }); this.h.onArrive && this.h.onArrive(); }
    }
    return st;
  }

  announce(m, k, d, v) {
    const fast = v > 22; // > 80 km/h
    const far = fast ? 2000 : v > 14 ? 800 : 400;
    const near = Math.max(fast ? 500 : 120, v * 9);
    const now = Math.max(28, v * 2.6);
    const key = st => k + ':' + st;
    if (d <= now && !this.spoken.has(key('now'))) { this.spoken.add(key('now')); this.spoken.add(key('near')); this.spoken.add(key('far')); say(phraseManeuver(m, d, 'now'), { priority: 2 }); }
    else if (d <= near && d > now * 1.5 && !this.spoken.has(key('near'))) { this.spoken.add(key('near')); this.spoken.add(key('far')); say(phraseManeuver(m, d, 'near'), { priority: 2 }); }
    else if (d <= far && d > near * 1.6 && m.len !== undefined && !this.spoken.has(key('far'))) { this.spoken.add(key('far')); say(phraseManeuver(m, d, 'far')); }
  }

  alerts(s, v) {
    const a = this.route.a, prefs = this.h.prefs();
    const camLead = Math.max(350, v * 16);
    if (prefs.warnCams) for (const c of a.cams) {
      const d = c.s - s;
      if (d > 0 && d < camLead && !this.alerted.has('c' + c.s)) { this.alerted.add('c' + c.s); this.emit('cam', d, { ms: c.ms }); }
    }
    if (prefs.warnCams) for (const z of a.sections) {
      const d = z.s0 - s;
      if (d > 0 && d < Math.max(400, v * 15) && !this.alerted.has('z' + z.s0)) { this.alerted.add('z' + z.s0); this.emit('secStart', d, { ms: z.ms }); }
      if (z.s1 - s < 30 && z.s1 - s > -30 && !this.alerted.has('ze' + z.s1)) { this.alerted.add('ze' + z.s1); this.emit('secEnd', 0, {}); }
    }
    if (prefs.warnBumps && v > 7) for (const b of a.bumps) {
      const d = b.s - s;
      if (d > 0 && d < Math.max(90, v * 7) && !this.alerted.has('b' + b.s)) { this.alerted.add('b' + b.s); this.emit('bump', d, {}); }
    }
    if (prefs.warnTraffic) for (const { s: es, ev } of a.events) {
      const d = es - s;
      if (d > 0 && d < Math.max(1500, v * 60) && !this.alerted.has(ev.id)) { this.alerted.add(ev.id); this.emit(ev.kind, d, { ev }); }
    }
    for (const { s: rs, rep } of this.reports || []) {
      const d = rs - s;
      if (d > 0 && d < Math.max(1000, v * 40) && !this.alerted.has(rep.id)) { this.alerted.add(rep.id); this.emit(rep.type === 'police' ? 'police' : 'report', d, { rep, text: rep.label }); }
    }
  }

  emit(kind, d, extra) {
    const text = phraseAlert(kind, d, extra);
    if (this.h.prefs().voiceAlerts) say(text, { priority: 1 });
    this.h.onAlert && this.h.onAlert({ kind, d, text, ...extra });
  }

  pace(s, v) {
    const notes = this.route.a.notes;
    if (v < 9) return; // pod ~30 km/h nehlásit
    const lead = Math.max(70, v * 5.2);
    while (this.noteIdx < notes.length && notes[this.noteIdx].s < s) this.noteIdx++;
    const n = notes[this.noteIdx];
    if (!n || n.s - s > lead || n.spokenAt === this.route) return;
    let text = n.say, j = this.noteIdx;
    n.spokenAt = this.route;
    // řetězit těsně navazující zatáčky do jedné věty
    while (notes[j] && (notes[j].gap === 'do' || notes[j].gap === 'a') && notes[j + 1] && j - this.noteIdx < 2) {
      text += `, ${notes[j].sayGap} ${notes[j + 1].say}`;
      notes[j + 1].spokenAt = this.route; j++;
    }
    if (notes[j] && notes[j].sayGap && notes[j].gap !== 'do' && notes[j].gap !== 'a') text += `, ${notes[j].sayGap}`;
    say(text, { priority: 2, persona: this.h.prefs().rallyPersona ? 'spolujezdec' : undefined });
    this.h.onNote && this.h.onNote(n);
  }

  upcoming(s) {
    const a = this.route.a, out = [];
    for (const c of a.cams) if (c.s > s && c.s - s < 3000) out.push({ kind: 'cam', d: c.s - s, ms: c.ms });
    for (const z of a.sections) if (z.s1 > s && z.s0 - s < 3000) out.push({ kind: 'sec', d: Math.max(0, z.s0 - s), ms: z.ms, inside: z.s0 <= s, left: z.s1 - s });
    return out.sort((x, y) => x.d - y.d).slice(0, 3);
  }

  speedCheck(kmh, limit) {
    const prefs = this.h.prefs();
    const over = limit && kmh > limit + (prefs.overTol || 5);
    if (over) {
      if (!this.overSince) this.overSince = Date.now();
      if (Date.now() - this.overSince > 3000 && Date.now() - this.lastOverSay > 45000 && prefs.warnOver) {
        this.lastOverSay = Date.now();
        this.h.onOver && this.h.onOver();
      }
    } else this.overSince = 0;
  }
}

// Simulace jízdy po trase (na zkoušku doma): rychlost podle limitu a zatáček, posílá polohy jako GPS.
export class Simulator {
  constructor(route, onFix, mult = 1) { this.r = route; this.onFix = onFix; this.mult = mult; this.s = 0; this.v = 0; }
  start() {
    this.last = performance.now();
    this.timer = setInterval(() => this.tick(), 250);
  }
  tick() {
    const now = performance.now(), dt = (now - this.last) / 1000 * this.mult; this.last = now;
    const r = this.r, a = r.a;
    let lo = 0, hi = r.coords.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (r.cum[m] <= this.s) lo = m; else hi = m; }
    // cílová rychlost: min(limit, rychlost dovolená zatáčkami v příštích 150 m)
    let target = a.lim[Math.min(lo, a.lim.length - 1)] / 3.6;
    for (let k = lo; k < r.coords.length - 1 && r.cum[k] < this.s + 150; k++) {
      const lim = Math.min(a.lim[k], a.curveV ? a.curveV[k] : 999) / 3.6;
      if (lim < target) target = lim;
    }
    if (a.fcdV[lo]) target = Math.min(target, a.fcdV[lo] / 3.6);
    const acc = target > this.v ? 2.2 : -3.5;
    this.v = Math.max(3, target > this.v ? Math.min(target, this.v + acc * dt) : Math.max(target, this.v + acc * dt));
    this.s += this.v * dt;
    if (this.s >= r.length) { this.s = r.length; this.stop(); }
    const p = pointAt(r.coords, r.cum, this.s), q = pointAt(r.coords, r.cum, Math.min(r.length, this.s + 15));
    this.onFix({ lon: p[0], lat: p[1], speed: this.v, heading: bearing(p, q), acc: 5, t: Date.now(), sim: true });
  }
  stop() { clearInterval(this.timer); this.timer = null; }
}
