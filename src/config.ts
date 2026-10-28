// Persistent user configuration (localStorage) and shared type definitions.

import { HORIZON_SOUTH } from './data/horizon-south';
import { HORIZON_NORTH } from './data/horizon-north';

/** building: always blocks; tree: deciduous (blocks in leaf, `bare` = roofline behind it);
 *  conifer: always blocks; estimated: unmeasured stretch, assumed. */
export type ProfileKind = 'building' | 'tree' | 'conifer' | 'estimated';
/** `kind` describes the segment starting at this point. */
export interface ProfilePoint { az: number; alt: number; kind: ProfileKind; bare?: number; }
export interface HorizonProfile {
  /** West / east limits (walls, full height), degrees 0-360. The range runs clockwise from azMin to azMax
   *  and may cross north (azMin > azMax, e.g. 300 -> 84). */
  azMin: number;
  azMax: number;
  points: ProfilePoint[];
  source: string;
}

export interface ViewWindow {
  /** Stable identity (labels are user-editable). */
  id: string;
  label: string; azCenter: number; halfWidth: number;
  /** Measured obstruction profile; replaces halfWidth/minAlt when present. */
  profile?: HorizonProfile;
  /** User chose "Reset to simple window": do not re-add the built-in profile. */
  profileOptOut?: boolean;
}

export type LeafMode = 'auto' | 'leaf' | 'bare';

/** Current config schema version (saved configs without `version` are v0). */
export const CONFIG_VERSION = 1;

export interface Config {
  version: number;
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
  version: CONFIG_VERSION,
  lat: 50.74,
  lon: 7.12,
  elev: 60,
  windows: [
    { id: 'north', label: 'North', azCenter: 12, halfWidth: 72, profile: HORIZON_NORTH },
    { id: 'south', label: 'South', azCenter: 163.5, halfWidth: 72.5, profile: HORIZON_SOUTH },
  ],
  minAlt: 10,
  limitMag: 4.0,
  showGrid: false,
  leaf: 'auto',
};

/** Short random id for a new window. */
export function newWindowId(): string {
  return Math.random().toString(36).slice(2, 8);
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d);

/** Migrate parsed JSON (any version, or garbage) to a valid current Config. Pure: no storage access.
 *  v0 (no `version`): North/South windows without a profile (and no opt-out) get the built-in measured
 *  profile baked in once. v1+: profiles are ordinary user data; only missing fields are filled. */
export function migrateConfig(raw: unknown): Config {
  const def = structuredClone(DEFAULT_CONFIG);
  if (!isObj(raw)) return def;
  const v0 = raw.version === undefined;
  const leaf: LeafMode = raw.leaf === 'auto' || raw.leaf === 'leaf' || raw.leaf === 'bare' ? raw.leaf : def.leaf;
  const cfg: Config = {
    version: CONFIG_VERSION,
    lat: num(raw.lat, def.lat), lon: num(raw.lon, def.lon), elev: num(raw.elev, def.elev),
    windows: def.windows,
    minAlt: num(raw.minAlt, def.minAlt),
    limitMag: num(raw.limitMag, def.limitMag),
    showGrid: typeof raw.showGrid === 'boolean' ? raw.showGrid : def.showGrid,
    leaf,
  };
  if (!Array.isArray(raw.windows)) return cfg;
  const used = new Set<string>();
  cfg.windows = [];
  for (const r of raw.windows) {
    if (!isObj(r) || typeof r.label !== 'string') continue;
    const builtin = v0 ? DEFAULT_CONFIG.windows.find(d => d.label === r.label) : undefined;
    const w: ViewWindow = {
      id: '', label: r.label,
      azCenter: num(r.azCenter, builtin?.azCenter ?? 0), halfWidth: num(r.halfWidth, builtin?.halfWidth ?? 45),
    };
    if (isObj(r.profile) && Array.isArray(r.profile.points)) w.profile = r.profile as unknown as HorizonProfile;
    if (r.profileOptOut === true) w.profileOptOut = true;
    let id = typeof r.id === 'string' && r.id ? r.id : (builtin?.id ?? '');
    while (!id || used.has(id)) id = newWindowId();
    used.add(id); w.id = id;
    if (builtin?.profile && !w.profile && !w.profileOptOut) {
      w.profile = structuredClone(builtin.profile); w.azCenter = builtin.azCenter; w.halfWidth = builtin.halfWidth;
    }
    cfg.windows.push(w);
  }
  return cfg;
}

const KEY = 'astromap-config';

function loadConfig(): Config {
  let stored: string | null = null, raw: unknown;
  try { stored = localStorage.getItem(KEY); } catch { /* no localStorage */ }
  if (stored) { try { raw = JSON.parse(stored); } catch { /* bad JSON */ } }
  const cfg = migrateConfig(raw);
  // Materialise defaults / migrated configs as the device's own data.
  if (!isObj(raw) || raw.version !== CONFIG_VERSION) { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ } }
  return cfg;
}

export const config: Config = loadConfig();

export function saveConfig(): void {
  try { localStorage.setItem(KEY, JSON.stringify(config)); } catch { /* ignore */ }
}

const WIN_KEY = 'astromap-window';
/** Index of the saved sky window: stored by id; the old numeric index is accepted as fallback. */
export function savedWindowIndex(): number {
  try {
    const s = localStorage.getItem(WIN_KEY);
    if (s == null) return 0;
    const i = config.windows.findIndex(w => w.id === s);
    if (i >= 0) return i;
    const n = Number(s);
    return Number.isInteger(n) && n >= 0 && n < config.windows.length ? n : 0;
  } catch { return 0; }
}
export function saveWindowId(id: string): void {
  try { localStorage.setItem(WIN_KEY, id); } catch { /* ignore */ }
}
