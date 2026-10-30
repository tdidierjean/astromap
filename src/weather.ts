// Cloud-cover forecast from Open-Meteo (no key). DWD ICON-D2 (~48 h, high-res) wins where present, the default best_match model fills the rest.
// Cached in localStorage; every failure is swallowed so the app keeps working offline.
import { config, demoMode } from './config';

export interface Cloud { low: number; mid: number; high: number; total: number; }
interface Forecast { lat: number; lon: number; fetchedAt: number; t0: number; low: number[]; mid: number[]; high: number[]; tot: number[]; }

const KEY = 'astromap-clouds';
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
    if (f && Array.isArray(f.low) && f.low.length && Number.isFinite(f.t0) && Number.isFinite(f.fetchedAt)) fc = f;
  } catch { /* ignore */ }
}
load();

/** Forecast data usable for the configured location? */
const valid = (): boolean => !!fc && Math.abs(fc.lat - config.lat) < 1e-6 && Math.abs(fc.lon - config.lon) < 1e-6;

/** Time of the forecast shown, or null when none. `stale`: the last refresh is overdue (offline / failing). */
export function forecastInfo(): { fetchedAt: number; stale: boolean } | null {
  return valid() ? { fetchedAt: fc!.fetchedAt, stale: Date.now() - fc!.fetchedAt > STALE_MS } : null;
}

/** Cloud cover (%) at an instant, linearly interpolated between hours; null outside the forecast. */
export function cloudAt(ms: number): Cloud | null {
  if (!valid()) return null;
  const x = (ms - fc!.t0) / HOUR, i = Math.floor(x), f = x - i;
  const at = (a: number[]) => {
    const p = a[i], q = a[i + 1];
    if (!Number.isFinite(p)) return NaN;
    return Number.isFinite(q) ? p + (q - p) * f : f < 1e-9 ? p : NaN;
  };
  const low = at(fc!.low), mid = at(fc!.mid), high = at(fc!.high), total = at(fc!.tot);
  return Number.isNaN(low + mid + high + total) ? null : { low, mid, high, total };
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
    '&hourly=cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high&models=icon_d2,best_match' +
    '&timezone=GMT&timeformat=unixtime&forecast_days=7';
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12_000);
  fetch(url, { signal: ctl.signal })
    .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
    .then(j => {
      const h = j.hourly, time: number[] = h.time, n = time.length;
      const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
      const out: Forecast = { lat, lon, fetchedAt: Date.now(), t0: time[0] * 1000, low: [], mid: [], high: [], tot: [] };
      for (let i = 0; i < n; i++) {
        const get = (k: string, m: string) => num(h[`${k}_${m}`]?.[i]);
        const d2 = ['cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high'].every(k => !Number.isNaN(get(k, 'icon_d2')));
        const m = d2 ? 'icon_d2' : 'best_match';
        out.low.push(get('cloud_cover_low', m)); out.mid.push(get('cloud_cover_mid', m));
        out.high.push(get('cloud_cover_high', m)); out.tot.push(get('cloud_cover', m));
      }
      if (n < 2 || time[1] - time[0] !== 3600 || out.low.every(Number.isNaN)) throw new Error('bad shape');
      // JSON turns NaN into null; the loaders treat null as NaN (Number.isFinite(null) is false)
      fc = out;
      if (!demoMode) try { localStorage.setItem(KEY, JSON.stringify(out)); } catch { /* ignore */ }
      notify();
    })
    .catch(() => { /* offline or API trouble: keep whatever we have */ })
    .finally(() => { clearTimeout(timer); inFlight = false; });
}
