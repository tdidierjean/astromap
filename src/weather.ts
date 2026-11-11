// Cloud-cover forecast from Open-Meteo (no key). DWD ICON-D2 (~48 h, high-res) wins where present, the default best_match model fills the rest.
// Cached in localStorage; every failure is swallowed so the app keeps working offline.
import { config, demoMode } from './config';

interface Forecast { lat: number; lon: number; fetchedAt: number; t0: number; cover: number[]; }

// v2: total cover only. The v1 key held low/mid/high rows and is simply never read again.
const KEY = 'astromap-clouds-v2';
const HOUR = 3_600_000;
const REFRESH_MS = HOUR;          // refetch at most this often
const RETRY_MS = 5 * 60_000;      // after a failed fetch
export const STALE_MS = 90 * 60_000;

let fc: Forecast | null = null;
let inFlight = false;
let lastTry = 0, lastKey = '';
const listeners: Array<() => void> = [];

export const onUpdate = (cb: () => void): void => { listeners.push(cb); };
const notify = () => listeners.forEach(cb => cb());

function load(): void {
  try {
    const f = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Forecast | null;
    if (f && Array.isArray(f.cover) && f.cover.length && Number.isFinite(f.t0) && Number.isFinite(f.fetchedAt)) fc = f;
  } catch { /* ignore */ }
  try { localStorage.removeItem('astromap-clouds'); } catch { /* ignore */ }   // v1 cache
}
load();

/** Forecast data usable for the configured location? */
const valid = (): boolean => !!fc && Math.abs(fc.lat - config.lat) < 1e-6 && Math.abs(fc.lon - config.lon) < 1e-6;

/** Time of the forecast shown, or null when none. `stale`: the last refresh is overdue (offline / failing). */
export function forecastInfo(): { fetchedAt: number; stale: boolean } | null {
  return valid() ? { fetchedAt: fc!.fetchedAt, stale: Date.now() - fc!.fetchedAt > STALE_MS } : null;
}

/** Total cloud cover (%) at an instant, linearly interpolated between hours; null outside the forecast. */
export function cloudAt(ms: number): number | null {
  if (!valid()) return null;
  const x = (ms - fc!.t0) / HOUR, i = Math.floor(x), f = x - i;
  const p = fc!.cover[i], q = fc!.cover[i + 1];
  if (!Number.isFinite(p)) return null;
  const v = Number.isFinite(q) ? p + (q - p) * f : f < 1e-9 ? p : NaN;
  return Number.isNaN(v) ? null : v;
}

/** Fetch if the data is missing, for another location, or older than an hour. Safe to call often. */
export function ensureFresh(): void {
  if (inFlight) return;
  const now = Date.now();
  const age = valid() ? now - fc!.fetchedAt : Infinity;
  const { lat, lon } = config, key = lat + ',' + lon;
  if (age < REFRESH_MS || (key === lastKey && now - lastTry < RETRY_MS)) return;
  inFlight = true; lastTry = now; lastKey = key;
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
    '&hourly=cloud_cover&models=icon_d2,best_match' +
    '&timezone=GMT&timeformat=unixtime&forecast_days=7';
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12_000);
  fetch(url, { signal: ctl.signal })
    .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
    .then(j => {
      const h = j.hourly, time: number[] = h.time, n = time.length;
      const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
      const out: Forecast = { lat, lon, fetchedAt: Date.now(), t0: time[0] * 1000, cover: [] };
      for (let i = 0; i < n; i++) {
        const d2 = num(h.cloud_cover_icon_d2?.[i]);
        out.cover.push(Number.isNaN(d2) ? num(h.cloud_cover_best_match?.[i]) : d2);
      }
      if (n < 2 || time[1] - time[0] !== 3600 || out.cover.every(Number.isNaN)) throw new Error('bad shape');
      // JSON turns NaN into null; the loaders treat null as NaN (Number.isFinite(null) is false)
      fc = out;
      if (!demoMode) try { localStorage.setItem(KEY, JSON.stringify(out)); } catch { /* ignore */ }
      notify();
    })
    .catch(() => { /* offline or API trouble: keep whatever we have */ })
    .finally(() => { clearTimeout(timer); inFlight = false; });
}
