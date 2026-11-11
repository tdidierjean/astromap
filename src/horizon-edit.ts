// Pure helpers behind the horizon editor (no DOM, no storage). Every function returns a new profile and never
// mutates its input or the point objects it shares, so the editor's undo stack can simply keep old profiles.
//
// Data model recap: the range runs clockwise from azMin to azMax (it may cross north). Points are ordered by their
// offset from azMin ("rel", degrees clockwise from the west wall). A point's `kind` describes the segment that starts
// at it; before the first point and after the last one the profile continues flat at that point's altitude and kind.
// `bare` only matters for kind 'tree' (roofline behind a deciduous tree when it is bare).
import type { HorizonProfile, ProfileKind, ProfilePoint, ViewWindow } from './config';
import { profileAlt, profileKind, profileSpan } from './horizon';

/** Narrowest window the editor allows (degrees). */
export const MIN_SPAN = 2;
/** Highest altitude a point can be given. */
export const MAX_ALT = 89;
export const KINDS: readonly ProfileKind[] = ['building', 'tree', 'conifer', 'estimated'];
export const KIND_LABEL: Record<ProfileKind, string> = { building: 'Building', tree: 'Tree', conifer: 'Conifer', estimated: 'Estimated' };

export const norm = (az: number): number => ((az % 360) + 360) % 360;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round2 = (x: number) => Math.round(x * 100) / 100;
/** Snap to a whole degree. */
export const snap = (x: number): number => Math.round(x);

/** Offset of az clockwise from the west wall, in [0, 360). */
export const relOf = (p: HorizonProfile, az: number): number => norm(az - p.azMin);
/** Azimuth (0-360) of an offset from the west wall. */
export const azOf = (p: HorizonProfile, rel: number): number => round2(norm(p.azMin + rel));
export const spanOf = (p: HorizonProfile): number => profileSpan(p);

/** Seed for "Draw horizon" on a simple window: flat at minAlt across the window's range, whole-degree walls.
 *  Kind 'estimated': nothing was measured, and it renders dashed so it reads as an assumption to refine. */
export function seedProfile(w: Pick<ViewWindow, 'azCenter' | 'halfWidth'>, minAlt: number): HorizonProfile {
  const azMin = norm(Math.round(w.azCenter - w.halfWidth));
  let azMax = norm(Math.round(w.azCenter + w.halfWidth));
  if (norm(azMax - azMin) < MIN_SPAN) azMax = norm(azMin + MIN_SPAN);
  const alt = clamp(snap(minAlt), 0, MAX_ALT);
  return {
    azMin, azMax, source: 'drawn',
    points: [{ az: azMin, alt, kind: 'estimated' }, { az: azMax, alt, kind: 'estimated' }],
  };
}

/** `source` label after saving: drawn profiles stay 'drawn'; an edited measured / imported one says so (max 120 characters). */
export function sourceAfterEdit(source: string | undefined): string {
  if (!source || source === 'drawn' || /(^|, )edited$/.test(source)) return source || 'drawn';
  return `${source}, edited`.slice(0, 120);
}

/** Centre and half-width a window carries next to its profile (the sky view centres on azCenter). */
export function facingOf(p: HorizonProfile): { azCenter: number; halfWidth: number } {
  const span = spanOf(p);
  return { azCenter: round2(norm(p.azMin + span / 2)), halfWidth: clamp(round2(span / 2), 1, 90) };
}

/** Offsets of the points from the west wall (clamped into the range; the points are kept ordered). */
export const relsOf = (p: HorizonProfile): number[] => p.points.map(pt => relOf(p, pt.az));

/** Insert a point at offset `rel` (clamped to the walls) and altitude `alt`; it continues the segment it splits
 *  (same kind, and for trees the roofline interpolated). A point at an existing azimuth goes after it (vertical steps are fine). */
export function insertPoint(p: HorizonProfile, rel: number, alt: number): { profile: HorizonProfile; index: number } {
  const span = spanOf(p);
  const r = clamp(snap(p.azMin + rel) - p.azMin, 0, span);
  const az = azOf(p, r);
  const kind = profileKind(p, az);
  const pt: ProfilePoint = { az, alt: clamp(snap(alt), 0, MAX_ALT), kind };
  if (kind === 'tree') pt.bare = Math.min(pt.alt, Math.max(0, snap(profileAlt(p, az, false))));
  const rels = relsOf(p);
  let i = rels.length;
  while (i > 0 && rels[i - 1] > r) i--;
  const points = p.points.slice(); points.splice(i, 0, pt);
  return { profile: { ...p, points }, index: i };
}

/** Move point i to offset `rel` / altitude `alt`: whole degrees, az kept between its neighbours and inside the walls. */
export function movePoint(p: HorizonProfile, i: number, rel: number, alt: number): HorizonProfile {
  const old = p.points[i];
  if (!old) return p;
  const rels = relsOf(p);
  const lo = i > 0 ? rels[i - 1] : 0, hi = i < rels.length - 1 ? rels[i + 1] : spanOf(p);
  const r = clamp(snap(p.azMin + rel) - p.azMin, lo, Math.max(lo, hi));
  const a = clamp(snap(alt), 0, MAX_ALT);
  const pt: ProfilePoint = { ...old, az: azOf(p, r), alt: a };
  if (pt.bare !== undefined && pt.bare > a) pt.bare = a;
  const points = p.points.slice(); points[i] = pt;
  return { ...p, points };
}

/** Delete point i (the last remaining point stays: a profile needs at least one). */
export function deletePoint(p: HorizonProfile, i: number): HorizonProfile {
  if (p.points.length <= 1 || !p.points[i]) return p;
  return { ...p, points: p.points.filter((_, k) => k !== i) };
}

/** Set the kind of the segment starting at point i. Tree gets a default roofline (half the height); other kinds drop it. */
export function setKind(p: HorizonProfile, i: number, kind: ProfileKind): HorizonProfile {
  const old = p.points[i];
  if (!old || old.kind === kind) return p;
  const pt: ProfilePoint = { az: old.az, alt: old.alt, kind };
  if (kind === 'tree') pt.bare = old.bare ?? Math.max(0, Math.round(old.alt / 2));
  const points = p.points.slice(); points[i] = pt;
  return { ...p, points };
}

/** Set the bare-tree roofline of point i (tree points only), whole degrees between 0 and the point's own height. */
export function setBare(p: HorizonProfile, i: number, bare: number): HorizonProfile {
  const old = p.points[i];
  if (!old || old.kind !== 'tree') return p;
  const points = p.points.slice(); points[i] = { ...old, bare: clamp(snap(bare), 0, old.alt) };
  return { ...p, points };
}

/** Move a wall by `delta` degrees clockwise (whole-degree result; the window keeps 2 to 359 degrees). Dragging a wall
 *  inwards drops the points it passes and leaves a point on the wall that keeps the shape; outwards, a point on the new
 *  wall continues the edge flat. Works across north: it only ever deals in offsets from the west wall. */
export function shiftWall(p: HorizonProfile, which: 'min' | 'max', delta: number): HorizonProfile {
  const span = spanOf(p);
  const wall = p.azMin + (which === 'min' ? 0 : span);
  // delta rounded so the wall lands on a whole azimuth, then limited so the span stays in [MIN_SPAN, 359]
  const want = Math.round(wall + delta) - wall;
  const newSpan = clamp(which === 'min' ? span - want : span + want, MIN_SPAN, 359);
  const d = which === 'min' ? span - newSpan : newSpan - span;
  if (d === 0) return p;

  const azMin = which === 'min' ? round2(norm(p.azMin + d)) : p.azMin;
  const azMax = round2(norm(azMin + newSpan));
  const rels = relsOf(p);
  // survivors, in old offsets; the new wall sits at `wallRel` (old offsets, may lie outside the old range)
  const lo = which === 'min' ? d : -Infinity, hi = which === 'min' ? Infinity : newSpan;
  const points = p.points.filter((_, k) => rels[k] >= lo && rels[k] <= hi);
  const wallRel = which === 'min' ? d : newSpan;
  const wallAz = which === 'min' ? azMin : azMax;
  const inward = which === 'min' ? d > 0 : d < 0;
  let src: ProfilePoint;       // what the wall point looks like
  if (inward) {
    const kind = profileKind(p, azOf(p, wallRel));
    src = { az: wallAz, alt: round2(profileAlt(p, azOf(p, wallRel), true)), kind };
    if (kind === 'tree') src.bare = round2(profileAlt(p, azOf(p, wallRel), false));
  } else {
    const flat = p.points[which === 'min' ? 0 : p.points.length - 1];   // flat continuation of the end point
    src = { ...flat, az: wallAz };
  }
  const edgeless = which === 'min'
    ? !points.length || rels[p.points.indexOf(points[0])] > wallRel
    : !points.length || rels[p.points.indexOf(points[points.length - 1])] < wallRel;
  if (edgeless) { if (which === 'min') points.unshift(src); else points.push(src); }
  return { ...p, azMin, azMax, points };
}

/** Vertex of the drawn outline: the profile at offset `rel`, with the kind of the segment that starts there. */
export interface OutlineVertex { rel: number; alt: number; bare: number; kind: ProfileKind; point: number; }

/** Outline for drawing: the points in order plus flat extensions to both walls (point = -1 for those). */
export function outline(p: HorizonProfile): OutlineVertex[] {
  const span = spanOf(p), rels = relsOf(p), pts = p.points;
  const out: OutlineVertex[] = [];
  const v = (pt: ProfilePoint, rel: number, point: number): OutlineVertex => ({ rel, alt: pt.alt, bare: pt.kind === 'tree' ? (pt.bare ?? pt.alt) : pt.alt, kind: pt.kind, point });
  if (!pts.length) return out;
  if (rels[0] > 0) out.push(v(pts[0], 0, -1));
  pts.forEach((pt, i) => out.push(v(pt, Math.min(rels[i], span), i)));
  if (rels[rels.length - 1] < span) out.push(v(pts[pts.length - 1], span, -1));
  return out;
}

/** Top of the altitude axis for a profile: its highest point plus headroom, in steps of 10, 40 to 90. */
export function autoAltMax(p: HorizonProfile): number {
  const top = p.points.reduce((m, pt) => Math.max(m, pt.alt), 0);
  return clamp(Math.ceil((top + 15) / 10) * 10, 40, 90);
}
