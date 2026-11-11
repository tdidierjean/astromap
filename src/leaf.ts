// Leaf season of deciduous trees: pure helpers (no DOM, no storage).
//
// Default rule by latitude (only used when the user has not set their own dates):
//   lat >= 15      northern:  25 Apr - 10 Nov
//   lat <= -15     southern:  25 Oct - 10 May (the northern dates shifted by six months; wraps over New Year)
//   |lat| < 15     tropics:   no real leaf-fall season, so trees count as always in leaf
// A user override is two "MM-DD" dates (either may be left unset; an unset one takes the default of the
// latitude's side of the equator: north for lat >= 0, south for lat < 0, even in the tropics).

export const NORTH_LEAF = { start: '04-25', end: '11-10' } as const;
export const SOUTH_LEAF = { start: '10-25', end: '05-10' } as const;
/** Below this absolute latitude (degrees) the automatic default is "always in leaf". */
export const TROPICS_LAT = 15;

/** "MM-DD" -> month * 100 + day, or null when it is not a real calendar day (29 Feb is accepted). */
export function parseMonthDay(s: unknown): number | null {
  if (typeof s !== 'string') return null;
  const m = /^(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const mo = Number(m[1]), d = Number(m[2]);
  const days = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= days[mo - 1] ? mo * 100 + d : null;
}

export interface LeafSeason { start: string; end: string; }

/** The automatic season for a latitude; null in the tropics (always in leaf). */
export function defaultLeafSeason(lat: number): LeafSeason | null {
  if (Math.abs(lat) < TROPICS_LAT) return null;
  return lat < 0 ? { ...SOUTH_LEAF } : { ...NORTH_LEAF };
}

/** Is the tree in leaf on this month/day? start <= end: one span in the year; start > end: wraps over New Year. */
export function inLeaf(month: number, day: number, lat: number, start?: string, end?: string): boolean {
  const s = parseMonthDay(start), e = parseMonthDay(end);
  let from: number, to: number;
  if (s === null && e === null) {
    const d = defaultLeafSeason(lat);
    if (!d) return true;
    from = parseMonthDay(d.start)!; to = parseMonthDay(d.end)!;
  } else {
    const d = lat < 0 ? SOUTH_LEAF : NORTH_LEAF;
    from = s ?? parseMonthDay(d.start)!; to = e ?? parseMonthDay(d.end)!;
  }
  const md = month * 100 + day;
  return from <= to ? md >= from && md <= to : md >= from || md <= to;
}

/** Short human text of the automatic rule for a latitude, e.g. "25 Apr - 10 Nov". */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtMonthDay(s: string): string {
  const v = parseMonthDay(s);
  return v === null ? s : `${v % 100} ${MONTHS[Math.floor(v / 100) - 1]}`;
}
export function defaultSeasonText(lat: number): string {
  const d = defaultLeafSeason(lat);
  return d ? `${fmtMonthDay(d.start)} – ${fmtMonthDay(d.end)}` : 'always in leaf (tropics)';
}
