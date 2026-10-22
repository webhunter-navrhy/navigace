// Ikony rozhraní (vlastní, tenká linka) + šipky manévrů + obrázky pro mapu.
const P = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  layers: '<path d="M12 4l8.5 4.5L12 13 3.5 8.5z"/><path d="M3.5 12.5L12 17l8.5-4.5"/><path d="M3.5 16.5L12 21l8.5-4.5" opacity=".5"/>',
  flagplus: '<path d="M6 21V4M6 4h10l-2 3.5 2 3.5H6"/><path d="M18 15v6M15 18h6"/>',
  locate: '<path d="M12 3l7 17-7-4-7 4z"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  home: '<path d="M4 11l8-6.5 8 6.5"/><path d="M6.5 9.5V20h11V9.5"/>',
  work: '<rect x="3.5" y="7.5" width="17" height="12" rx="1.5"/><path d="M9 7.5V5h6v2.5M3.5 12.5h17"/>',
  star: '<path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
  pin: '<path d="M12 21s6.5-6 6.5-11a6.5 6.5 0 10-13 0c0 5 6.5 11 6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  route: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h7a3 3 0 000-6H9a3 3 0 010-6h7"/>',
  joy: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/><path d="M12 4v6M5.5 16.5L10.3 13M18.5 16.5L13.7 13"/>',
  trips: '<path d="M4 18c3-8 6 0 9-6s5-4 7-6"/><circle cx="4" cy="18" r="1.6"/><circle cx="20" cy="6" r="1.6"/>',
  police: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M12 8.5l1.1 2.2 2.4.3-1.8 1.6.5 2.4-2.2-1.2-2.2 1.2.5-2.4-1.8-1.6 2.4-.3z"/>',
  jam: '<rect x="3" y="10" width="8" height="5" rx="1.5"/><rect x="13" y="10" width="8" height="5" rx="1.5"/><path d="M5 15v2M9 15v2M15 15v2M19 15v2M4.5 10l1.2-3h4.6l1.2 3M14.5 10l1.2-3h4.6l1.2 3"/>',
  accident: '<path d="M4 17l3.5-6.5h5L16 17"/><path d="M3 17h14"/><path d="M17.5 4.5l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1z"/>',
  hazard: '<path d="M12 4l9 16H3z"/><path d="M12 10v4.5M12 17v.5"/>',
  cam: '<rect x="3.5" y="7" width="13" height="10" rx="2"/><circle cx="10" cy="12" r="2.6"/><path d="M16.5 10.5l4-2v7l-4-2"/>',
  bump: '<path d="M2.5 17h4c2-5.5 9-5.5 11 0h4"/><path d="M8 12.5l1-1.5M12 10.5V9M16 12.5l-1-1.5"/>',
  closure: '<rect x="3" y="9" width="18" height="5" rx="1"/><path d="M7 9l-3 5M12 9l-3 5M17 9l-3 5M21 9l-3 5M6 14v5M18 14v5"/>',
  works: '<path d="M9 4h6l4 16H5z"/><path d="M7.5 10h9M6.5 14.5h11"/>',
  fuel: '<rect x="4" y="4" width="10" height="16" rx="1.5"/><path d="M4 10h10M14 9l3.5 2.5V17a1.5 1.5 0 003 0V8.5L18 6"/>',
  food: '<path d="M7 3v8M5 3v5a2 2 0 004 0V3M7 11v10M16 21V3c-2.2 1-3.5 3.5-3.5 7h3.5"/>',
  coffee: '<path d="M5 9h11v5a5 5 0 01-5 5h-1a5 5 0 01-5-5z"/><path d="M16 10.5h1.5a2.5 2.5 0 010 5H16M8 3.5c-.8 1 .8 2 0 3M12 3.5c-.8 1 .8 2 0 3"/>',
  view: '<path d="M3 19l6-9 4 5.5 2.5-3.5L21 19z"/><circle cx="17" cy="6" r="2"/>',
  speed: '<path d="M4.5 17a8 8 0 1115 0"/><path d="M12 13l4-4"/>',
  hud: '<rect x="3" y="5" width="18" height="11" rx="2"/><path d="M8 20h8M12 16v4"/>',
  share: '<path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 12v7h14v-7"/>',
  volume: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11"/>',
  mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  play: '<path d="M7 5l12 7-12 7z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
  download: '<path d="M12 4v11M8 11l4 4 4-4M5 19.5h14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  swap: '<path d="M7 4v15M4 16l3 3 3-3M17 20V5M14 8l3-3 3 3"/>',
  flag: '<path d="M6 21V4h11l-2 4 2 4H6"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  sim: '<circle cx="12" cy="12" r="8"/><path d="M10 9l5 3-5 3z"/>',
  parking: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M10 17V8h3a2.5 2.5 0 010 5h-3"/>',
  moon: '<path d="M19 14.5A7.5 7.5 0 019.5 5a7.5 7.5 0 109.5 9.5z"/>',
  track: '<path d="M5 18c-2-4 1-9 6-9h4a3 3 0 010 6H9"/><path d="M9 15l2-2-2-2"/><circle cx="19" cy="6" r="1.5"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.2"/>',
};
export function icon(name, cls = '') {
  return `<svg class="i ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}
export function hydrateIcons(root = document) {
  root.querySelectorAll('.ico[data-i]').forEach(el => { if (!el.firstChild) el.innerHTML = icon(el.dataset.i); });
}

// --- šipky manévrů (Valhalla typy) ---
const A = {
  straight: '<path d="M24 42V8M12 20L24 8l12 12"/>',
  right: '<path d="M14 42V24c0-4 3-7 7-7h17M30 9l8 8-8 8"/>',
  left: '<path d="M34 42V24c0-4-3-7-7-7H10M18 9l-8 8 8 8"/>',
  slightRight: '<path d="M16 42V28c0-4 2-7 5-10l12-12M22 6h11v11"/>',
  slightLeft: '<path d="M32 42V28c0-4-2-7-5-10L15 6M26 6H15v11"/>',
  sharpRight: '<path d="M14 6v20c0 5 4 8 9 8 3 0 6-2 8-4l6-6M37 34V24H27"/>',
  sharpLeft: '<path d="M34 6v20c0 5-4 8-9 8-3 0-6-2-8-4l-6-6M11 34V24h10"/>',
  uturn: '<path d="M30 42V18a8 8 0 00-16 0v16M7 27l7 7 7-7"/>',
  roundabout: '<circle cx="24" cy="20" r="8.5" stroke-width="2.4" opacity=".45"/><path d="M24 42V28.5a8.5 8.5 0 0 0 8.5-8.5H42M37 15l5 5-5 5"/>',
  merge: '<path d="M24 42V24L12 8M24 24l12-16M24 24"/>',
  flag: '<path d="M14 42V7h20l-4 7 4 7H14"/>',
};
export function maneuverSVG(type, exit) {
  const map = {
    1: 'straight', 2: 'right', 3: 'left', 4: 'flag', 5: 'flag', 6: 'flag', 7: 'straight', 8: 'straight', 9: 'slightRight', 10: 'right', 11: 'sharpRight',
    12: 'uturn', 13: 'uturn', 14: 'sharpLeft', 15: 'left', 16: 'slightLeft', 17: 'straight', 18: 'slightRight', 19: 'slightLeft', 20: 'slightRight',
    21: 'slightLeft', 22: 'straight', 23: 'slightRight', 24: 'slightLeft', 25: 'merge', 26: 'roundabout', 27: 'roundabout', 37: 'slightRight', 38: 'slightLeft',
  };
  const k = map[type] || 'straight';
  const badge = (type === 26 && exit) ? `<text x="24" y="23.5" text-anchor="middle" font-size="9" font-weight="700" fill="currentColor" stroke="none">${exit}</text>` : '';
  return `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round">${A[k]}${badge}</svg>`;
}

// --- obrázky do mapy (radar, práh, události, hlášení) ---
export function mapIcon(name, bg, fg, ring) {
  const s = 64;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 64 64">
    <circle cx="32" cy="32" r="27" fill="${bg}" stroke="${ring}" stroke-width="3"/>
    <g transform="translate(14 14) scale(1.5)" fill="none" stroke="${fg}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${P[name]}</g></svg>`;
  return new Promise((res, rej) => {
    const img = new Image(s, s);
    img.onload = () => res(img); img.onerror = rej;
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}
