// Persistent user configuration (localStorage) and shared type definitions.

export interface ViewWindow { label: string; azCenter: number; halfWidth: number; }

export interface Config {
  lat: number;
  lon: number;
  elev: number;
  windows: ViewWindow[];
  minAlt: number;
  /** Naked-eye limiting magnitude for the sky view (stars fainter than this are hidden). */
  limitMag: number;
  /** Show the alt/az grid in the sky view. */
  showGrid: boolean;
}

export const DEFAULT_CONFIG: Config = {
  lat: 50.74,
  lon: 7.12,
  elev: 60,
  windows: [
    { label: 'North', azCenter: 0,   halfWidth: 45 },
    { label: 'South', azCenter: 180, halfWidth: 45 },
  ],
  minAlt: 10,
  limitMag: 4.0,
  showGrid: false,
};

const KEY = 'astromap-config';

function loadConfig(): Config {
  try {
    const s = localStorage.getItem(KEY);
    // Merge over defaults so configs saved by older versions gain the new fields.
    if (s) return { ...structuredClone(DEFAULT_CONFIG), ...(JSON.parse(s) as Partial<Config>) };
  } catch { /* ignore (no localStorage, bad JSON) */ }
  return structuredClone(DEFAULT_CONFIG);
}

export const config: Config = loadConfig();

export function saveConfig(): void {
  try { localStorage.setItem(KEY, JSON.stringify(config)); } catch { /* ignore */ }
}
