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

/** Angular width of the window (azMin -> azMax going clockwise); handles ranges that cross 360 -> 0 (azMin > azMax). */
export function profileSpan(p: HorizonProfile): number {
  const s = norm(p.azMax - p.azMin);
  return s === 0 && p.azMax !== p.azMin ? 360 : s;
}
/** Azimuth measured from azMin, in [0, 360). */
const relAz = (p: HorizonProfile, az: number) => norm(az - p.azMin);

export function inAzRange(p: HorizonProfile, az: number): boolean {
  return relAz(p, az) <= profileSpan(p);
}

function ptAlt(pt: { alt: number; kind: ProfileKind; bare?: number }, leaf: boolean): number {
  return pt.kind === 'tree' && !leaf ? (pt.bare ?? pt.alt) : pt.alt;
}

/** Index of the segment containing rel (azimuth from azMin, already inside the range). */
function segIndex(p: HorizonProfile, rel: number): number {
  const pts = p.points;
  let i = 0;
  while (i < pts.length - 2 && rel > relAz(p, pts[i + 1].az)) i++;
  return i;
}

/** Top altitude of the obstruction at az (linear interpolation), or NaN outside the az limits. */
export function profileAlt(p: HorizonProfile, azIn: number, leaf: boolean): number {
  if (!inAzRange(p, azIn)) return NaN;
  const rel = relAz(p, azIn);
  const pts = p.points;
  if (pts.length === 0) return 0;
  if (rel <= relAz(p, pts[0].az)) return ptAlt(pts[0], leaf);
  const last = pts[pts.length - 1];
  if (rel >= relAz(p, last.az)) return ptAlt(last, leaf);
  const i = segIndex(p, rel), a = pts[i], b = pts[i + 1];
  const ra = relAz(p, a.az), rb = relAz(p, b.az);
  const t = rb === ra ? 0 : (rel - ra) / (rb - ra);
  const ya = ptAlt(a, leaf), yb = ptAlt(b, leaf);
  return ya + (yb - ya) * t;
}

/** Kind of obstruction at az (kind of the segment's start point). */
export function profileKind(p: HorizonProfile, azIn: number): ProfileKind {
  const rel = relAz(p, azIn);
  const pts = p.points;
  if (rel <= relAz(p, pts[0].az)) return pts[0].kind;
  if (rel >= relAz(p, pts[pts.length - 1].az)) return pts[pts.length - 1].kind;
  return pts[segIndex(p, rel)].kind;
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

/** Dense samples of the profile for drawing. `az` is unwrapped (azMin ... azMin + span, may exceed 360). */
export function sampleProfile(p: HorizonProfile, leaf: boolean, step = 0.5): ProfileSample[] {
  const out: ProfileSample[] = [];
  const span = profileSpan(p);
  for (let r = 0; r < span + step / 2; r += step) {
    const a = p.azMin + Math.min(r, span);
    out.push({
      az: a, kind: profileKind(p, a), top: profileAlt(p, a, leaf),
      leafTop: profileAlt(p, a, true), bareTop: profileAlt(p, a, false),
    });
  }
  return out;
}
