// Import / export of settings as JSON files (pure: no DOM, no storage).
//
// File format (plain JSON, one object):
//   { "astromap": 1, "kind": "config", "config": <Config> }   whole setup: place, clock, options, all windows
//   { "astromap": 1, "kind": "window", "window": <ViewWindow> } one window with its horizon profile, if any
// "astromap" is the format version (not the Config version, which lives inside `config`). Readers reject files
// with a newer format version; writers of new features (photo measurement, shared horizons) reuse `kind: "window"`.
// Everything read from a file is validated and clamped here before it reaches the app.

import {
  CONFIG_VERSION, migrateConfig, newWindowId,
  type Config, type ViewWindow, type HorizonProfile, type ProfilePoint, type ProfileKind,
} from './config';

export const TRANSFER_VERSION = 1;
/** Largest file accepted (a config with a few dense profiles is well under 100 KB). */
export const MAX_IMPORT_BYTES = 1_000_000;
const MAX_WINDOWS = 50;
const MAX_POINTS = 2000;
const KINDS: readonly ProfileKind[] = ['building', 'tree', 'conifer', 'estimated'];

export type Imported =
  | { kind: 'config'; config: Config }
  | { kind: 'window'; window: ViewWindow };
export type ParseResult = ({ ok: true } & Imported) | { ok: false; error: string };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round = (x: number) => Math.round(x * 100) / 100;
/** Azimuth already checked to be in [0, 360]: 360 becomes 0, everything else is kept bit-for-bit. */
const wrapAz = (az: number) => (az === 360 ? 0 : az);
/** Offset of az clockwise from `from`, in [0, 360). */
const offset = (az: number, from: number) => (((az - from) % 360) + 360) % 360;

export function serializeConfig(cfg: Config): string {
  return JSON.stringify({ astromap: TRANSFER_VERSION, kind: 'config', config: cfg }, null, 1);
}
export function serializeWindow(w: ViewWindow): string {
  return JSON.stringify({ astromap: TRANSFER_VERSION, kind: 'window', window: w }, null, 1);
}

function sanitizeProfile(raw: unknown): HorizonProfile | null {
  if (!isObj(raw) || !Array.isArray(raw.points) || raw.points.length === 0 || raw.points.length > MAX_POINTS) return null;
  if (!fin(raw.azMin) || !fin(raw.azMax) || raw.azMin < 0 || raw.azMin > 360 || raw.azMax < 0 || raw.azMax > 360) return null;
  const azMin = wrapAz(raw.azMin), azMax = wrapAz(raw.azMax);
  const pts: ProfilePoint[] = [];
  for (const r of raw.points) {
    if (!isObj(r) || !fin(r.az) || !fin(r.alt) || r.az < 0 || r.az > 360 || r.alt < -90 || r.alt > 90) return null;
    if (!KINDS.includes(r.kind as ProfileKind)) return null;
    const p: ProfilePoint = { az: wrapAz(r.az), alt: r.alt, kind: r.kind as ProfileKind };
    if (r.bare !== undefined) {
      if (!fin(r.bare) || r.bare < -90 || r.bare > 90) return null;
      p.bare = r.bare;
    }
    pts.push(p);
  }
  // Points run clockwise from the west limit (the range may cross north), so sort by offset from azMin.
  const rel = (p: ProfilePoint) => offset(p.az, azMin);
  pts.sort((a, b) => rel(a) - rel(b));
  const source = typeof raw.source === 'string' ? raw.source.trim().slice(0, 120) : '';
  return { azMin, azMax, points: pts, source: source || 'imported' };
}

/** Validate one window from untrusted JSON. Returns a clean copy, or an error message. Keeps the given id as-is. */
export function sanitizeWindow(raw: unknown): { ok: true; window: ViewWindow } | { ok: false; error: string } {
  if (!isObj(raw)) return { ok: false, error: 'The window entry is not an object.' };
  const label = typeof raw.label === 'string' ? raw.label.trim().slice(0, 40) : '';
  if (!label) return { ok: false, error: 'The window has no name.' };
  if (!fin(raw.azCenter) || raw.azCenter < 0 || raw.azCenter > 360) return { ok: false, error: `"${label}": facing must be between 0 and 360 degrees.` };
  if (!fin(raw.halfWidth)) return { ok: false, error: `"${label}": the window width is missing.` };
  const w: ViewWindow = {
    id: typeof raw.id === 'string' ? raw.id.trim().slice(0, 40) : '',
    label, azCenter: round(wrapAz(raw.azCenter)), halfWidth: clamp(round(raw.halfWidth), 1, 90),
  };
  if (raw.profile !== undefined) {
    const p = sanitizeProfile(raw.profile);
    if (!p) return { ok: false, error: `"${label}": the horizon profile is invalid.` };
    w.profile = p;
  }
  if (raw.profileOptOut === true) w.profileOptOut = true;
  return { ok: true, window: w };
}

/** Whole config: migrateConfig fills and types everything, then ranges and windows are checked. */
function sanitizeConfig(raw: unknown): { ok: true; config: Config } | { ok: false; error: string } {
  if (!isObj(raw)) return { ok: false, error: 'The file has no settings in it.' };
  if (fin(raw.version) && raw.version > CONFIG_VERSION) {
    return { ok: false, error: 'These settings come from a newer version of AstroMap. Update the app and try again.' };
  }
  if (!fin(raw.lat) || !fin(raw.lon) || raw.lat < -90 || raw.lat > 90 || raw.lon < -180 || raw.lon > 180) {
    return { ok: false, error: 'The location is missing or out of range (latitude -90 to 90, longitude -180 to 180).' };
  }
  if (Array.isArray(raw.windows) && raw.windows.length > MAX_WINDOWS) return { ok: false, error: `Too many windows (at most ${MAX_WINDOWS}).` };
  const cfg = migrateConfig(raw);
  cfg.elev = clamp(cfg.elev, -500, 9000);
  cfg.minAlt = clamp(cfg.minAlt, 0, 45);
  cfg.limitMag = clamp(cfg.limitMag, 2, 6);
  const used = new Set<string>();
  const windows: ViewWindow[] = [];
  for (const w of cfg.windows) {
    const r = sanitizeWindow(w);
    if (!r.ok) return r;
    let id = r.window.id;
    while (!id || used.has(id)) id = newWindowId();
    used.add(id);
    windows.push({ ...r.window, id });
  }
  cfg.windows = windows;
  return { ok: true, config: cfg };
}

/** Parse and validate the text of an import file. Never throws. */
export function parseTransfer(text: string): ParseResult {
  if (text.length > MAX_IMPORT_BYTES) return { ok: false, error: 'The file is too large to be an AstroMap export.' };
  let data: unknown;
  try { data = JSON.parse(text); } catch { return { ok: false, error: 'This is not a JSON file.' }; }
  if (!isObj(data) || !fin(data.astromap)) return { ok: false, error: 'This is not an AstroMap export file.' };
  if (data.astromap > TRANSFER_VERSION) {
    return { ok: false, error: 'This file was made by a newer version of AstroMap. Update the app and try again.' };
  }
  if (data.kind === 'config') {
    const r = sanitizeConfig(data.config);
    return r.ok ? { ok: true, kind: 'config', config: r.config } : r;
  }
  if (data.kind === 'window') {
    const r = sanitizeWindow(data.window);
    return r.ok ? { ok: true, kind: 'window', window: r.window } : r;
  }
  return { ok: false, error: 'The file does not say whether it holds settings or a window.' };
}

/** A copy of an imported window that is safe to append: its id is kept unless an existing window already uses it. */
export function withFreshId(w: ViewWindow, existing: readonly ViewWindow[]): ViewWindow {
  const used = new Set(existing.map(x => x.id));
  let id = w.id;
  while (!id || used.has(id)) id = newWindowId();
  return { ...structuredClone(w), id };
}

/** Lower-case ASCII slug for file names ("Café Bonn!" -> "cafe-bonn"), at most 40 characters. */
export function slug(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
}
export function configFilename(c: Pick<Config, 'name' | 'lat' | 'lon'>): string {
  return `astromap-${slug(c.name) || `${round(c.lat)}_${round(c.lon)}`}.json`;
}
export function windowFilename(w: Pick<ViewWindow, 'label'>): string {
  return `astromap-window-${slug(w.label) || 'window'}.json`;
}
