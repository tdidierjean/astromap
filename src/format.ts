// Time / label formatting helpers. Everything is evaluated in the configured location's zone
// (config.tz), never the device's, using the browser's locale. config.clock forces 12/24-hour.

import { config } from './config';

// ─── Zone-aware wall-clock arithmetic ───────────────────────────────────────

export interface LocalParts { y: number; m: number; d: number; h: number; mi: number; s: number; }

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

/** Wall-clock fields of an instant in a zone (default: the configured one). */
export function localParts(ms: number, tz: string = config.tz): LocalParts {
  const o: Record<string, number> = {};
  for (const p of partsFormatter(tz).formatToParts(ms)) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return { y: o.year, m: o.month, d: o.day, h: o.hour % 24, mi: o.minute, s: o.second };
}

const asUtc = (p: LocalParts): number => Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);

/** Zone offset (ms, local minus UTC) in force at an instant. */
export function tzOffsetMs(ms: number, tz: string = config.tz): number {
  return asUtc(localParts(ms, tz)) - Math.floor(ms / 1000) * 1000;
}

/** Instant for a wall-clock time in a zone. Day/hour overflow is normalised (d=32 rolls into the next month).
 *  Ambiguous times (clocks going back) resolve to the first occurrence; non-existent times (clocks going
 *  forward) resolve to the instant the same distance after the transition. */
export function localToMs(y: number, m: number, d: number, h = 0, mi = 0, tz: string = config.tz): number {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const o0 = tzOffsetMs(guess, tz);
  let t = guess - o0;
  // The offset may differ between the guess and the answer (across a transition): re-check once.
  const o1 = tzOffsetMs(t, tz);
  if (o1 !== o0) t = guess - o1;
  // Ambiguous wall time (clocks going back): prefer the earlier instant.
  if (asUtc(localParts(t - 3_600_000, tz)) === Date.UTC(y, m - 1, d, h, mi)) t -= 3_600_000;
  return t;
}

/** Same wall-clock time `days` calendar days away (not 24 h multiples: DST-safe). */
export function addLocalDays(ms: number, days: number, tz: string = config.tz): number {
  const p = localParts(ms, tz);
  return localToMs(p.y, p.m, p.d + days, p.h, p.mi, tz);
}

/** First full local hour strictly after `ms`. */
export function nextLocalHour(ms: number, tz: string = config.tz): number {
  const p = localParts(ms, tz);
  return localToMs(p.y, p.m, p.d, p.h + 1, 0, tz);
}

// ─── Formatting ─────────────────────────────────────────────────────────────

const clockOpts = (): Intl.DateTimeFormatOptions =>
  config.clock === '24' ? { hourCycle: 'h23' } : config.clock === '12' ? { hour12: true } : {};

/** Does the clock currently show AM/PM (forced, or the browser locale's default)? */
export function is12h(): boolean {
  if (config.clock !== 'auto') return config.clock === '12';
  localeIs12h ??= (() => {
    try { return /h1[12]/.test(new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle ?? ''); }
    catch { return false; }
  })();
  return localeIs12h;
}
let localeIs12h: boolean | undefined;

const dtfCache = new Map<string, Intl.DateTimeFormat>();
/** Cached by zone + clock + options, so config changes pick a new entry; constructing Intl formatters is slow. */
function dtf(o: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${config.tz}|${config.clock}|${JSON.stringify(o)}`;
  let f = dtfCache.get(key);
  if (!f) { f = new Intl.DateTimeFormat(undefined, { timeZone: config.tz, ...o }); dtfCache.set(key, f); }
  return f;
}

export function fmtTime(d: Date): string {
  return dtf({ hour: is12h() ? 'numeric' : '2-digit', minute: '2-digit', ...clockOpts() }).format(d);
}

/** Compact label for an hour tick: "20:00", or "8 PM" with AM/PM. */
export function fmtHourTick(d: Date): string {
  return is12h() ? dtf({ hour: 'numeric', ...clockOpts() }).format(d) : fmtTime(d);
}

export function fmtClock(d: Date): string {
  return dtf({ hour: is12h() ? 'numeric' : '2-digit', minute: '2-digit', second: '2-digit', ...clockOpts() }).format(d);
}

export function fmtDateTime(d: Date): string {
  const day = dtf({ weekday: 'short', day: 'numeric', month: 'short' }).format(d);
  return `${day}, ${fmtTime(d)}`;
}

/** "HH:MM" of an instant in the configured zone (value format of <input type=time>). */
export function timeInputValue(ms: number): string {
  const p = localParts(ms);
  return `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`;
}

export function nightLabel(offset: number): string {
  if (offset === 0)  return 'Tonight';
  if (offset === 1)  return 'Tomorrow';
  if (offset === -1) return 'Yesterday';
  return dtf({ month: 'short', day: 'numeric' }).format(addLocalDays(Date.now(), offset));
}

export function moonPhaseText(deg: number): string {
  const labels = [
    'New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous',
    'Full Moon', 'Waning Gibbous', 'Last Quarter',  'Waning Crescent',
  ];
  return labels[Math.round(deg / 45) % 8];
}
