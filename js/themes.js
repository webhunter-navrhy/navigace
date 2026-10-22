// Tři vzhledy aplikace. Každý má barvy mapy i rozhraní; rozhraní se řídí CSS proměnnými podle data-theme.
export const THEMES = {
  pulnoc: {
    name: 'Půlnoc',
    tagline: 'Tmavá, klidná, jantarová trasa',
    dark: true,
    ui: { bg: '#0c0e12', accent: '#f4b45e' },
    map: {
      bg: '#0d1015', land2: '#10141a', wood: '#0f1713', grass: '#111912', farm: '#0e1216', residential: '#12161c', industrial: '#14161b',
      water: '#0a1620', waterLine: '#11283a', building: '#161a21', building3d: '#1b2029',
      road: { motorway: '#4a3a22', trunk: '#3a3226', primary: '#2f333b', secondary: '#2a2e36', tertiary: '#252930', minor: '#1c2028', service: '#181b22', track: '#191b20', casing: '#08090c', rail: '#2a2d33' },
      roadLabel: '#7d8490', label: '#9aa1ad', labelStrong: '#e8e2d6', halo: '#0b0d11', boundary: '#5b4b36',
      route: '#f4b45e', routeCasing: '#3b2a10', routeAlt: '#5d6470', routeDone: '#3a3f48', glow: 'rgba(244,180,94,0.35)',
      traffic: ['#e8b84a', '#f07a3a', '#e5484d'],
      shade: { shadow: '#000000', light: 'rgba(255,240,220,0.05)', accent: '#05070a', k: 0.5 },
    },
  },
  atlas: {
    name: 'Atlas',
    tagline: 'Světlá, papírová, jako stará autoatlas',
    dark: false,
    ui: { bg: '#f3eee4', accent: '#bf5130' },
    map: {
      bg: '#f1ebdf', land2: '#ede6d8', wood: '#d7dec3', grass: '#e1e5cc', farm: '#efe8d6', residential: '#ebe2d1', industrial: '#e6ddd0',
      water: '#b7cdd5', waterLine: '#9fbcc7', building: '#e2d7c4', building3d: '#ddd0bb',
      road: { motorway: '#efbd7e', trunk: '#f3cd96', primary: '#f7ddb0', secondary: '#fbe9c8', tertiary: '#fffaf0', minor: '#fffdf8', service: '#fbf7ee', track: '#e7dcc6', casing: '#d3c5ac', rail: '#c9bba3' },
      roadLabel: '#6b5f50', label: '#5a5045', labelStrong: '#221d17', halo: '#f6f1e8', boundary: '#b98f6a',
      route: '#bf5130', routeCasing: '#7a2e17', routeAlt: '#a99c88', routeDone: '#c8bba6', glow: 'rgba(191,81,48,0.18)',
      traffic: ['#e2a32e', '#e0662b', '#c9302c'],
      shade: { shadow: 'rgba(96,74,44,0.55)', light: 'rgba(255,252,242,0.55)', accent: 'rgba(96,74,44,0.25)', k: 0.45 },
    },
  },
  rally: {
    name: 'Rally',
    tagline: 'Kontrastní, závodní, žlutá na grafitu',
    dark: true,
    ui: { bg: '#0a0a0a', accent: '#ffd400' },
    map: {
      bg: '#171717', land2: '#191919', wood: '#17201a', grass: '#1a211b', farm: '#181818', residential: '#1c1c1c', industrial: '#1d1c1a',
      water: '#14212a', waterLine: '#1f3442', building: '#222222', building3d: '#262626',
      road: { motorway: '#6b6b6b', trunk: '#5c5c5c', primary: '#4e4e4e', secondary: '#444444', tertiary: '#3b3b3b', minor: '#2d2d2d', service: '#272727', track: '#262626', casing: '#0b0b0b', rail: '#333333' },
      roadLabel: '#8c8c8c', label: '#b5b5b5', labelStrong: '#ffffff', halo: '#111111', boundary: '#ffd400',
      route: '#ffd400', routeCasing: '#000000', routeAlt: '#6e6e6e', routeDone: '#3d3d3d', glow: 'rgba(255,212,0,0.28)',
      traffic: ['#ffb000', '#ff6a00', '#ff2d2d'],
      shade: { shadow: '#000000', light: 'rgba(255,255,255,0.06)', accent: '#000000', k: 0.55 },
    },
  },
};

export const THEME_ORDER = ['pulnoc', 'atlas', 'rally'];
