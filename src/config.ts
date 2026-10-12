// Persistent user configuration (localStorage) and shared type definitions.

import { HORIZON_SOUTH } from './data/horizon-south';

/** building: always blocks; tree: deciduous (blocks in leaf, `bare` = roofline behind it);
 *  conifer: always blocks; estimated: unmeasured stretch, assumed. */
export type ProfileKind = 'building' | 'tree' | 'conifer' | 'estimated';
/** `kind` describes the segment starting at this point. */
export interface ProfilePoint { az: number; alt: number; kind: ProfileKind; bare?: number; }
export interface HorizonProfile {
  /** East / west limits (walls, full height). azMin < azMax, degrees 0-360. */
  azMin: number;
  azMax: number;
  points: ProfilePoint[];
  source: string;
}

export interface ViewWindow {
  label: string; azCenter: number; halfWidth: number;
  /** Measured obstruction profile; replaces halfWidth/minAlt when present. */
  profile?: HorizonProfile;
  /** User chose "Reset to simple window": do not re-add the built-in profile. */
  profileOptOut?: boolean;
}

export type LeafMode = 'auto' | 'leaf' | 'bare';

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
  /** Deciduous trees: Auto (in leaf ~25 Apr - 10 Nov), always in leaf, or bare. */
  leaf: LeafMode;
}

export const DEFAULT_CONFIG: Config = {
  lat: 50.74,
  lon: 7.12,
  elev: 60,
  windows: [
    { label: 'North', azCenter: 0,   halfWidth: 45 },
    { label: 'South', azCenter: 163.5, halfWidth: 72.5, profile: HORIZON_SOUTH },
  ],
  minAlt: 10,
  limitMag: 4.0,
  showGrid: false,
  leaf: 'auto',
};

const KEY = 'astromap-config';

function loadConfig(): Config {
  try {
    const s = localStorage.getItem(KEY);
    // Merge over defaults so configs saved by older versions gain the new fields.
    if (s) {
      const cfg: Config = { ...structuredClone(DEFAULT_CONFIG), ...(JSON.parse(s) as Partial<Config>) };
      // Existing users get the built-in measured profiles (unless they opted out).
      for (const d of DEFAULT_CONFIG.windows) {
        const w = cfg.windows.find(x => x.label === d.label);
        if (w && d.profile && !w.profile && !w.profileOptOut) {
          w.profile = structuredClone(d.profile); w.azCenter = d.azCenter; w.halfWidth = d.halfWidth;
        }
      }
      return cfg;
    }
  } catch { /* ignore (no localStorage, bad JSON) */ }
  return structuredClone(DEFAULT_CONFIG);
}

export const config: Config = loadConfig();

export function saveConfig(): void {
  try { localStorage.setItem(KEY, JSON.stringify(config)); } catch { /* ignore */ }
}
