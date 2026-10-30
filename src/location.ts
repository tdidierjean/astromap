// Pure helpers for place names, coordinates and the Open-Meteo geocoding / elevation responses (no DOM, no storage).
import { isValidTz } from './config';

/** Round to the 0.01 degree grid (about 1 km): enough for a sky view, no need to store an exact address. */
export const round2 = (x: number): number => Math.round(x * 100) / 100;

/** "50.74°N 7.12°E" (S / W for negative values). */
export function formatCoords(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(2)}°${lat < 0 ? 'S' : 'N'} ${Math.abs(lon).toFixed(2)}°${lon < 0 ? 'W' : 'E'}`;
}

/** Header label: the place name, or the coordinates when there is none. */
export function locationLabel(c: { name?: string; lat: number; lon: number }): string {
  return c.name?.trim() || formatCoords(c.lat, c.lon);
}

/** Valid latitude / longitude text -> number, else null. */
export const parseLat = (s: string): number | null => parseRange(s, -90, 90);
export const parseLon = (s: string): number | null => parseRange(s, -180, 180);
function parseRange(s: string, lo: number, hi: number): number | null {
  if (s.trim() === '') return null;
  const n = Number(s.trim().replace(',', '.'));
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
}

/** What onboarding writes into the config for a chosen place. */
export interface Place { name: string; lat: number; lon: number; elev: number; tz: string; }

/** One entry of a geocoding result list: the place plus a longer description for the picker. */
export interface PlaceHit extends Place { detail: string; }

/** Open-Meteo geocoding response -> places. Entries without usable coordinates are dropped; a missing or invalid
 *  elevation becomes 0 and a missing or invalid time zone becomes `fallbackTz`. */
export function parseGeocoding(json: unknown, fallbackTz: string): PlaceHit[] {
  const results = (json as { results?: unknown })?.results;
  if (!Array.isArray(results)) return [];
  const out: PlaceHit[] = [];
  for (const r of results) {
    if (typeof r !== 'object' || r === null) continue;
    const o = r as Record<string, unknown>;
    if (typeof o.latitude !== 'number' || typeof o.longitude !== 'number') continue;
    if (parseLat(String(o.latitude)) === null || parseLon(String(o.longitude)) === null) continue;
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    if (!name) continue;
    const part = (k: string) => (typeof o[k] === 'string' && o[k] ? [o[k] as string] : []);
    out.push({
      name, lat: round2(o.latitude), lon: round2(o.longitude),
      elev: typeof o.elevation === 'number' && Number.isFinite(o.elevation) ? Math.round(o.elevation) : 0,
      tz: isValidTz(o.timezone) ? o.timezone : fallbackTz,
      detail: [name, ...part('admin1'), ...part('country')].join(', '),
    });
  }
  return out;
}

/** Open-Meteo elevation response ({ elevation: [m] }) -> whole metres, or null. */
export function parseElevation(json: unknown): number | null {
  const e = (json as { elevation?: unknown })?.elevation;
  const v = Array.isArray(e) ? e[0] : e;
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
}

const TIMEOUT_MS = 8000;

async function getJson(url: string, fetchFn: typeof fetch): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchFn(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(timer); }
}

/** Search a place name. Rejects when the network or the API fails (callers show a gentle message). */
export async function searchPlaces(query: string, lang: string, fallbackTz: string, fetchFn: typeof fetch = fetch): Promise<PlaceHit[]> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=${encodeURIComponent(lang)}`;
  return parseGeocoding(await getJson(url, fetchFn), fallbackTz);
}

/** Elevation of a point in metres; 0 when the lookup fails (offline, API trouble). */
export async function lookupElevation(lat: number, lon: number, fetchFn: typeof fetch = fetch): Promise<number> {
  try {
    const json = await getJson(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`, fetchFn);
    return parseElevation(json) ?? 0;
  } catch { return 0; }
}
