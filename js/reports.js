// Sdílená hlášení řidičů (policie, mobilní radar, kolona…) přes server navigace-api na Cloudflare.
// Když server nejde, hlášení zůstane aspoň v tomhle telefonu.
import { read, write } from './store.js?v=b41a3a0790';

const API = 'https://navigace-api.webhunter.workers.dev';

export const REPORT_TYPES = [
  { type: 'police', label: 'Policie', say: 'hlášená policie', icon: 'police', min: 60 },
  { type: 'mcam', label: 'Mobilní radar', say: 'hlášený mobilní radar', icon: 'cam', min: 90 },
  { type: 'jam', label: 'Kolona', say: 'hlášená kolona', icon: 'jam', min: 40 },
  { type: 'accident', label: 'Nehoda', say: 'hlášená nehoda', icon: 'accident', min: 60 },
  { type: 'hazard', label: 'Překážka', say: 'překážka na silnici', icon: 'hazard', min: 60 },
  { type: 'closure', label: 'Uzavírka', say: 'hlášená uzavírka', icon: 'closure', min: 240 },
];
export const reportType = t => REPORT_TYPES.find(r => r.type === t);

const withLabel = r => ({ ...r, label: (reportType(r.type) || {}).say || 'hlášení' });
let server = [];
let local = read('reports', []).filter(r => r.local && r.exp > Date.now());
const mine = new Set(read('reports-mine', []));
const voted = new Set(read('reports-voted', []));

export const shared = { online: null, onChange: null, t: 0 };

export function allReports() {
  const now = Date.now(), seen = new Set(), out = [];
  for (const r of [...server, ...local]) if (r.exp > now && !seen.has(r.id)) { seen.add(r.id); out.push(withLabel({ ...r, mine: mine.has(r.id) })); }
  return out;
}
const changed = () => shared.onChange && shared.onChange(allReports());
const keepLocal = () => write('reports', local.filter(r => r.exp > Date.now()));

export async function syncReports() {
  try {
    const r = await fetch(API + '/reports', { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    // posun hodin telefonu proti serveru, ať expirace sedí
    const skew = Date.now() - j.now;
    server = j.reports.map(x => ({ ...x, t: x.t + skew, exp: x.exp + skew }));
    shared.online = true; shared.t = Date.now();
  } catch { shared.online = false; }
  changed();
}

let timer = null;
export function startReportSync() {
  syncReports();
  clearInterval(timer);
  timer = setInterval(() => document.visibilityState === 'visible' && syncReports(), 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - shared.t > 30000) syncReports(); });
}

export async function addReport(type, p, heading) {
  const R = reportType(type);
  const tmp = { id: 'l' + Date.now(), type, lon: p[0], lat: p[1], heading, t: Date.now(), exp: Date.now() + R.min * 60000, up: 1, down: 0, local: true };
  local.push(tmp); changed();
  try {
    const r = await fetch(API + '/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, lon: p[0], lat: p[1], heading }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || r.status);
    local = local.filter(x => x !== tmp);
    mine.add(j.report.id); write('reports-mine', [...mine].slice(-200));
    server = [...server.filter(x => x.id !== j.report.id), { ...j.report, t: Date.now(), exp: Date.now() + (j.report.exp - j.report.t) }];
    shared.online = true;
    changed();
    return { shared: true, merged: !!j.merged };
  } catch (e) {
    keepLocal();
    return { shared: false, error: e.message };
  }
}

export const canVote = id => !voted.has(id) && !mine.has(id) && !String(id).startsWith('l');
export async function voteReport(id, v) {
  voted.add(id); write('reports-voted', [...voted].slice(-300));
  if (v < 0) { server = server.filter(r => r.id !== id); changed(); }
  try { await fetch(API + '/vote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, v }) }); } catch { }
}
