// Pure helpers for the window list in Settings (no DOM).
import { newWindowId, type HorizonProfile, type ViewWindow } from './config';

export const COMPASS16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** Normalise an azimuth to [0, 360). */
export const normAz = (az: number): number => ((az % 360) + 360) % 360;

/** Integer degrees a compass point stands for (22.5 steps, rounded down: WSW = 247). */
export const pointAz = (i: number): number => Math.floor(i * 22.5);

/** Index of the compass point whose integer degrees equal az, or -1 for a custom direction. */
export function pointIndex(az: number): number {
  return COMPASS16.findIndex((_, i) => pointAz(i) === az);
}

/** Parse the degrees field: an integer 0-359 (anything else, including 360, is rejected with null). */
export function parseDegrees(s: string): number | null {
  const n = Number(s.trim());
  return s.trim() !== '' && Number.isInteger(n) && n >= 0 && n < 360 ? n : null;
}

/** "315° – 45°" for a simple window; wraps through north. */
export function rangeHint(azCenter: number, halfWidth: number): string {
  const lo = Math.round(normAz(azCenter - halfWidth)), hi = Math.round(normAz(azCenter + halfWidth));
  return `${lo % 360}° – ${hi % 360}°`;
}

/** First unused "Window N". */
export function defaultWindowName(windows: ViewWindow[]): string {
  const used = new Set(windows.map(w => w.label));
  let n = 1;
  while (used.has(`Window ${n}`)) n++;
  return `Window ${n}`;
}

/** A fresh simple window: facing the equator (South in the north, North in the south), +-45 degrees. */
export function newSimpleWindow(windows: ViewWindow[], lat: number): ViewWindow {
  return { id: newWindowId(), label: defaultWindowName(windows), azCenter: lat < 0 ? 0 : 180, halfWidth: 45 };
}

/** Centre/width for "Reset to simple window": keeps pointing where the measured profile did
 *  (centre rounded to a whole degree, half-width to the slider's 5-degree step within 5-90). */
export function seedFromProfile(p: HorizonProfile): { azCenter: number; halfWidth: number } {
  const span = normAz(p.azMax - p.azMin) || (p.azMax !== p.azMin ? 360 : 0);
  return {
    azCenter: Math.round(normAz(p.azMin + span / 2)) % 360,
    halfWidth: Math.min(90, Math.max(5, Math.round(span / 2 / 5) * 5)),
  };
}

/** Move the item with `id` one step (-1 up, +1 down); returns false when it cannot move. */
export function moveWindow(windows: ViewWindow[], id: string, dir: -1 | 1): boolean {
  const i = windows.findIndex(w => w.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= windows.length) return false;
  [windows[i], windows[j]] = [windows[j], windows[i]];
  return true;
}
