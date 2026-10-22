// Hlasy: systémové české hlasy (iOS/Android/desktop) × osobnost (tempo, výška, styl hlášek).
export const PERSONAS = {
  navigatorka: { name: 'Navigátorka', desc: 'Klidná a věcná, klasické pokyny', rate: 1.0, pitch: 1.0, style: 'formal' },
  parak: { name: 'Parťák', desc: 'Mluví jako kamarád na sedadle spolujezdce', rate: 1.06, pitch: 1.0, style: 'casual' },
  spolujezdec: { name: 'Rally spolujezdec', desc: 'Rychle, stručně, jako v rozpisu', rate: 1.28, pitch: 0.95, style: 'rally' },
  zen: { name: 'Zen', desc: 'Pomalu a tlumeně, na noční jízdu', rate: 0.88, pitch: 0.9, style: 'formal' },
  robot: { name: 'Robot K-9', desc: 'Strojový, nízký hlas', rate: 1.0, pitch: 0.55, style: 'formal' },
};

const synth = window.speechSynthesis;
let voices = [];
let cfg = { voiceURI: null, persona: 'navigatorka', volume: 1, muted: false };
let unlocked = false;

function load() { voices = synth ? synth.getVoices() : []; }
if (synth) { load(); synth.onvoiceschanged = load; }

export function czechVoices() {
  load();
  const cs = voices.filter(v => /^cs/i.test(v.lang));
  const sk = voices.filter(v => /^sk/i.test(v.lang));
  const list = cs.length ? cs : sk;
  // nejdřív kvalitnější (Enhanced/Premium/Google/Natural)
  const q = v => /premium|enhanced|natural|neural|google|siri/i.test(v.name) ? 0 : 1;
  return list.sort((a, b) => q(a) - q(b) || a.name.localeCompare(b.name));
}

export function configure(c) { cfg = { ...cfg, ...c }; }
export const getConfig = () => cfg;

// iOS pustí řeč až po gestu uživatele
export function unlock() {
  if (unlocked || !synth) return;
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0; synth.speak(u); unlocked = true;
}

let queue = [], speaking = false;
export function say(text, { priority = 1, persona } = {}) {
  if (!synth || cfg.muted || !text) return;
  const p = PERSONAS[persona || cfg.persona] || PERSONAS.navigatorka;
  if (priority >= 3) { synth.cancel(); queue = []; speaking = false; }
  queue.push({ text, p });
  pump();
}
function pump() {
  if (speaking || !queue.length) return;
  const { text, p } = queue.shift();
  const u = new SpeechSynthesisUtterance(text);
  const list = czechVoices();
  const v = list.find(x => x.voiceURI === cfg.voiceURI) || list[0];
  if (v) u.voice = v;
  u.lang = v ? v.lang : 'cs-CZ';
  u.rate = p.rate; u.pitch = p.pitch; u.volume = cfg.volume;
  speaking = true;
  const done = () => { speaking = false; pump(); };
  u.onend = done; u.onerror = done;
  synth.speak(u);
  // pojistka: některé prohlížeče onend nepošlou
  setTimeout(() => { if (speaking) { speaking = false; pump(); } }, 1500 + text.length * 120);
}
export const stop = () => { queue = []; speaking = false; synth && synth.cancel(); };

// --- formulace podle stylu osobnosti ---
const nice = m => m >= 1000 ? (Math.round(m / 100) / 10).toString().replace('.', ',') + (m >= 5000 ? ' kilometrů' : m === 1000 ? ' kilometr' : ' kilometru') : `${Math.round(m / 50) * 50} metrů`;
const casualDist = m => m >= 1000 ? nice(m) : m >= 450 ? 'půl kilometru' : m >= 250 ? 'tři stovky' : m >= 150 ? 'dvě stovky' : 'sto metrů';

export function phraseManeuver(m, d, stage) {
  const style = (PERSONAS[cfg.persona] || PERSONAS.navigatorka).style;
  const what = lower(stage === 'now' ? m.pre : m.alert);
  if (style === 'rally') {
    const short = rallyTurn(m);
    return stage === 'now' ? short : `${Math.round(d / 50) * 50}, ${short}`;
  }
  if (stage === 'now') return m.pre;
  if (style === 'casual') return `Za ${casualDist(d)} ${what}`;
  return `Za ${nice(d)} ${what}`;
}
function lower(s) { return s ? s.charAt(0).toLowerCase() + s.slice(1) : ''; }
function rallyTurn(m) {
  const t = m.type;
  if (t === 26) return `kruhák, ${m.exit || ''}. výjezd`;
  if ([10, 9, 11, 18, 20, 23, 37].includes(t)) return t === 11 ? 'ostře doprava' : t === 9 || t === 23 ? 'mírně doprava' : 'doprava';
  if ([15, 16, 14, 19, 21, 24, 38].includes(t)) return t === 14 ? 'ostře doleva' : t === 16 || t === 24 ? 'mírně doleva' : 'doleva';
  if ([12, 13].includes(t)) return 'otočka';
  if ([4, 5, 6].includes(t)) return 'cíl';
  return 'rovně';
}

export function phraseAlert(kind, d, extra = {}) {
  const style = (PERSONAS[cfg.persona] || PERSONAS.navigatorka).style;
  const dd = d >= 1000 ? nice(d) : `${Math.round(d / 50) * 50} metrů`;
  const map = {
    cam: style === 'rally' ? `radar ${extra.ms || ''}` : `Radar za ${dd}${extra.ms ? `, limit ${extra.ms}` : ''}.`,
    secStart: `Začíná úsekové měření${extra.ms ? `, limit ${extra.ms}` : ''}.`,
    secEnd: 'Konec úsekového měření.',
    bump: style === 'rally' ? 'práh' : 'Zpomalovací práh.',
    police: style === 'casual' ? `Pozor, za ${dd} hlásí policajty.` : `Hlášená policie za ${dd}.`,
    jam: `Kolona za ${dd}.`,
    accident: `Nehoda na trase za ${dd}.`,
    closure: `Uzavírka za ${dd}.`,
    hazard: `Nebezpečí na silnici za ${dd}.`,
    works: `Práce na silnici za ${dd}.`,
    over: style === 'casual' ? 'Hele, jedeš moc rychle.' : 'Překračujete povolenou rychlost.',
    report: `Za ${dd} ${extra.text || 'hlášení'}.`,
  };
  return map[kind] || '';
}
