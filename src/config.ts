// Persistent user configuration (localStorage) and shared type definitions.

import { DEMO_CONFIG, DEMO_TZ } from './demo';

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
export type ClockMode = 'auto' | '24' | '12';

/** Is this a time zone name the runtime understands? */
export function isValidTz(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; }
}

/** The device's own IANA zone, or 'UTC' when it cannot be determined. */
export function deviceTz(): string {
  try {
    const z = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (isValidTz(z)) return z;
  } catch { /* ignore */ }
  return 'UTC';
}

/** Current config schema version (saved configs without `version` are v0). */
export const CONFIG_VERSION = 1;

export interface Config {
  version: number;
  /** Place name shown in the header; empty: the coordinates are shown instead. */
  name: string;
  lat: number;
  lon: number;
  elev: number;
  /** IANA time zone of the location: all displayed times, hour ticks and "tonight" follow it, not the device. */
  tz: string;
  /** Clock style: browser locale default, or forced 24-hour / 12-hour. */
  clock: ClockMode;
  windows: ViewWindow[];
  minAlt: number;
  /** Naked-eye limiting magnitude for the sky view (stars fainter than this are hidden). */
  limitMag: number;
  /** Show the alt/az grid in the sky view. */
  showGrid: boolean;
  /** Deciduous trees: Auto (in leaf ~25 Apr - 10 Nov), always in leaf, or bare. */
  leaf: LeafMode;
}

/** Neutral starting point (no place, no windows): what a visitor without a saved config begins with, before onboarding
 *  fills it in. Missing fields of v1 configs are filled from here. */
export const DEFAULT_CONFIG: Config = {
  version: CONFIG_VERSION,
  name: '',
  lat: 0,
  lon: 0,
  elev: 0,
  tz: deviceTz(),
  clock: 'auto',
  windows: [],
  minAlt: 10,
  limitMag: 4.0,
  showGrid: false,
  leaf: 'auto',
};

/** What legacy (v0) configs are completed from: the Bonn balcony the app was first built for (device zone, as before). */
const LEGACY_BASE: Config = { ...structuredClone(DEMO_CONFIG), version: CONFIG_VERSION, tz: deviceTz() };

/** The demo as a full config (fresh copy). */
export function demoConfig(): Config {
  return { ...structuredClone(DEMO_CONFIG), version: CONFIG_VERSION, tz: DEMO_TZ };
}

/** Short random id for a new window. */
export function newWindowId(): string {
  return Math.random().toString(36).slice(2, 8);
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d);

/** Migrate parsed JSON (any version, or garbage) to a valid current Config. Pure: no storage access.
 *  v0 (no `version`): missing fields come from the Bonn preset, and North/South windows without a profile
 *  (and no opt-out) get the built-in measured profile baked in once. v1+: profiles are ordinary user data; only missing fields are filled from the neutral DEFAULT_CONFIG. */
export function migrateConfig(raw: unknown): Config {
  if (!isObj(raw)) return structuredClone(DEFAULT_CONFIG);
  const v0 = raw.version === undefined;
  const def = structuredClone(v0 ? LEGACY_BASE : DEFAULT_CONFIG);
  const leaf: LeafMode = raw.leaf === 'auto' || raw.leaf === 'leaf' || raw.leaf === 'bare' ? raw.leaf : def.leaf;
  const cfg: Config = {
    version: CONFIG_VERSION,
    name: typeof raw.name === 'string' ? raw.name.trim().slice(0, 80) : def.name,
    lat: num(raw.lat, def.lat), lon: num(raw.lon, def.lon), elev: num(raw.elev, def.elev),
    tz: isValidTz(raw.tz) ? raw.tz : def.tz,
    clock: raw.clock === 'auto' || raw.clock === '24' || raw.clock === '12' ? raw.clock : def.clock,
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
    const builtin = v0 ? LEGACY_BASE.windows.find(d => d.label === r.label) : undefined;
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

/** Demo mode (URL hash `#demo`): the Bonn preset lives in memory only; nothing is read from or written to storage. */
export const demoMode: boolean = typeof location !== 'undefined' && location.hash === '#demo';

/** A usable config is stored on this device (false on first run, or when the stored data is unreadable). */
export const hasStoredConfig: boolean = (() => {
  try {
    const s = localStorage.getItem(KEY);
    return !!s && isObj(JSON.parse(s));
  } catch { return false; }
})();

/** First run: no stored config, so onboarding sets the place up. Never in demo mode. */
export const needsOnboarding: boolean = !demoMode && !hasStoredConfig;

function loadConfig(): Config {
  if (demoMode) return demoConfig();
  if (!hasStoredConfig) return structuredClone(DEFAULT_CONFIG); // saved by onboarding, not before
  let raw: unknown;
  try { raw = JSON.parse(localStorage.getItem(KEY)!); } catch { /* unreachable: hasStoredConfig parsed it */ }
  const cfg = migrateConfig(raw);
  // Materialise migrated configs as the device's own data.
  if (!isObj(raw) || raw.version !== CONFIG_VERSION || raw.tz !== cfg.tz || raw.clock !== cfg.clock) { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ } }
  return cfg;
}

export const config: Config = loadConfig();

export function saveConfig(): void {
  if (demoMode) return;
  try { localStorage.setItem(KEY, JSON.stringify(config)); } catch { /* ignore */ }
}

const WIN_KEY = 'astromap-window';
/** Index of the saved sky window: stored by id; the old numeric index is accepted as fallback. */
export function savedWindowIndex(): number {
  if (demoMode) return 0;
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
  if (demoMode) return;
  try { localStorage.setItem(WIN_KEY, id); } catch { /* ignore */ }
}
