// Horizon profiles and the single visibility rule used throughout the app.
import { config, type ViewWindow, type HorizonProfile, type ProfileKind } from './config';

/** Minimum altitude when a profile is present (haze / refraction floor). */
export const PROFILE_FLOOR = 2;

const norm = (az: number) => ((az % 360) + 360) % 360;

let leafRef: Date | null = null;
/** Date of the browsed night; when set it decides the leaf state everywhere (so label and night agree). */
export function setLeafRefDate(d: Date | null): void { leafRef = d; }

/** Are deciduous trees in leaf? (Auto: ~25 April to ~10 November, by the browsed night's date.) */
export function leafOn(dateArg: Date): boolean {
  const date = leafRef ?? dateArg;
  if (config.leaf === 'leaf') return true;
  if (config.leaf === 'bare') return false;
  const md = (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
  return md >= 425 && md <= 1110;
}

export function inAzRange(p: HorizonProfile, az: number): boolean {
  const a = norm(az);
  return a >= p.azMin && a <= p.azMax;
}

function ptAlt(pt: { alt: number; kind: ProfileKind; bare?: number }, leaf: boolean): number {
  return pt.kind === 'tree' && !leaf ? (pt.bare ?? pt.alt) : pt.alt;
}

/** Index of the segment containing az (az already inside the profile range). */
function segIndex(p: HorizonProfile, az: number): number {
  const pts = p.points;
  let i = 0;
  while (i < pts.length - 2 && az > pts[i + 1].az) i++;
  return i;
}

/** Top altitude of the obstruction at az (linear interpolation), or NaN outside the az limits. */
export function profileAlt(p: HorizonProfile, azIn: number, leaf: boolean): number {
  const az = norm(azIn);
  if (az < p.azMin || az > p.azMax) return NaN;
  const pts = p.points;
  if (pts.length === 0) return 0;
  if (az <= pts[0].az) return ptAlt(pts[0], leaf);
  const last = pts[pts.length - 1];
  if (az >= last.az) return ptAlt(last, leaf);
  const i = segIndex(p, az), a = pts[i], b = pts[i + 1];
  const t = b.az === a.az ? 0 : (az - a.az) / (b.az - a.az);
  const ya = ptAlt(a, leaf), yb = ptAlt(b, leaf);
  return ya + (yb - ya) * t;
}

/** Kind of obstruction at az (kind of the segment's start point). */
export function profileKind(p: HorizonProfile, azIn: number): ProfileKind {
  const az = norm(azIn);
  const pts = p.points;
  if (az <= pts[0].az) return pts[0].kind;
  if (az >= pts[pts.length - 1].az) return pts[pts.length - 1].kind;
  return pts[segIndex(p, az)].kind;
}

export type Visibility = 'ok' | 'outside' | 'blocked';

export function visibility(w: ViewWindow, az: number, alt: number, date: Date): Visibility {
  const p = w.profile;
  if (p) {
    if (!inAzRange(p, az)) return 'outside';
    const floor = Math.max(PROFILE_FLOOR, profileAlt(p, az, leafOn(date)));
    return alt > floor ? 'ok' : 'blocked';
  }
  const d = ((az - w.azCenter + 540) % 360) - 180;
  if (Math.abs(d) > w.halfWidth) return 'outside';
  return alt >= config.minAlt ? 'ok' : 'blocked';
}

/** The one visibility rule: inside the window's az limits and above its horizon profile / min altitude. */
export function isVisible(w: ViewWindow, az: number, alt: number, date: Date): boolean {
  return visibility(w, az, alt, date) === 'ok';
}

export interface ProfileSample { az: number; kind: ProfileKind; top: number; leafTop: number; bareTop: number; }

/** Dense samples of the profile for drawing. */
export function sampleProfile(p: HorizonProfile, leaf: boolean, step = 0.5): ProfileSample[] {
  const out: ProfileSample[] = [];
  for (let az = p.azMin; az < p.azMax + step / 2; az += step) {
    const a = Math.min(az, p.azMax);
    out.push({
      az: a, kind: profileKind(p, a), top: profileAlt(p, a, leaf),
      leafTop: profileAlt(p, a, true), bareTop: profileAlt(p, a, false),
    });
  }
  return out;
}
