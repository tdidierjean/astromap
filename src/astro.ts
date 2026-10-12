// Astronomy computations: solar-system bodies, visibility windows, night search,
// and the fast J2000 -> horizon rotation used for the star catalogue.
import * as Astronomy from 'astronomy-engine';
import { config, type ViewWindow } from './config';
import { isVisible } from './horizon';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Sample {
  time: Astronomy.AstroTime;
  azimuth: number;
  altitude: number;
  visible: boolean;
  window?: string;
}

export interface BodyDef {
  name: string; color: string; dotClass: string; body: Astronomy.Body;
  /** Too faint to see against a bright sky: visibility is only counted between sunset and sunrise. */
  needsDarkness: boolean;
}

export interface ObjectData extends BodyDef {
  samples: Sample[];
  /** Visibility windows for the card: = spans of `samples` for objects needing darkness; for the Moon,
   *  the true windows (not clipped to sunset/sunrise) that overlap the night. */
  visSpans: VisSpan[];
  curAz: number;
  curAlt: number;
  curVisible: boolean;
  curWindow?: string;
}

export interface Night { start: Astronomy.AstroTime; end: Astronomy.AstroTime; }
export interface VisSpan { start: Date; end: Date; direction: string; }

// ─── Objects ─────────────────────────────────────────────────────────────────

// The Moon is bright enough to see in daylight, so its window must not be clipped to the night boundary.
// Venus and Mercury stay needsDarkness: true (twilight-only visibility is not treated as a daylight object).

export const OBJECTS: BodyDef[] = [
  { name: 'Moon',    color: '#e0dfca', dotClass: 'dot-moon',    body: Astronomy.Body.Moon, needsDarkness: false },
  { name: 'Venus',   color: '#fff3c4', dotClass: 'dot-venus',   body: Astronomy.Body.Venus, needsDarkness: true },
  { name: 'Mercury', color: '#b9b0a6', dotClass: 'dot-mercury', body: Astronomy.Body.Mercury, needsDarkness: true },
  { name: 'Mars',    color: '#e06040', dotClass: 'dot-mars',    body: Astronomy.Body.Mars, needsDarkness: true },
  { name: 'Jupiter', color: '#c8a46e', dotClass: 'dot-jupiter', body: Astronomy.Body.Jupiter, needsDarkness: true },
  { name: 'Saturn',  color: '#d4c090', dotClass: 'dot-saturn',  body: Astronomy.Body.Saturn, needsDarkness: true },
];

export function observer(): Astronomy.Observer {
  return new Astronomy.Observer(config.lat, config.lon, config.elev);
}

// ─── Body positions ───────────────────────────────────────────────────────────

export function getHorizon(
  body: Astronomy.Body, t: Astronomy.AstroTime, obs: Astronomy.Observer,
  refraction: 'normal' | null = 'normal',
) {
  const eq = Astronomy.Equator(body, t, obs, true, true);
  return Astronomy.Horizon(t, obs, eq.ra, eq.dec, refraction as string);
}

/** Apparent visual magnitude. */
export function bodyMagnitude(body: Astronomy.Body, t: Astronomy.AstroTime): number {
  return Astronomy.Illumination(body, t).mag;
}

export function sunAltitude(date: Date, obs: Astronomy.Observer): number {
  return getHorizon(Astronomy.Body.Sun, Astronomy.MakeTime(date), obs, null).altitude;
}

// ─── Windows ─────────────────────────────────────────────────────────────────

export function angDiff(az: number, center: number): number {
  return ((az - center + 540) % 360) - 180;
}

export function checkWindows(az: number, alt: number, date: Date): { visible: boolean; window?: string } {
  for (const w of config.windows) {
    if (isVisible(w, az, alt, date)) return { visible: true, window: w.label };
  }
  return { visible: false };
}

// ─── Night ───────────────────────────────────────────────────────────────────

export function getNight(refDate: Date, obs: Astronomy.Observer): Night | null {
  // Start searching from 12 h before refDate — catches both daytime (upcoming sunset) and nighttime (current night)
  const from = Astronomy.MakeTime(new Date(refDate.getTime() - 12 * 3_600_000));
  const sunset  = Astronomy.SearchRiseSet(Astronomy.Body.Sun, obs, -1, from, 1);
  if (!sunset) return null;
  const sunrise = Astronomy.SearchRiseSet(Astronomy.Body.Sun, obs, +1, sunset, 1);
  if (!sunrise) return null;
  return { start: sunset, end: sunrise };
}

export function findVisSpans(samples: Sample[]): VisSpan[] {
  const spans: VisSpan[] = [];
  let cur: VisSpan | null = null;
  for (const s of samples) {
    if (s.visible) {
      if (!cur) cur = { start: s.time.date, end: s.time.date, direction: s.window ?? '' };
      else      cur.end = s.time.date;
    } else if (cur) {
      spans.push(cur);
      cur = null;
    }
  }
  if (cur) spans.push(cur);
  return spans;
}

const STEP_MS = 15 * 60_000;

function sampleRange(obj: Astronomy.Body, obs: Astronomy.Observer, fromMs: number, toMs: number): Sample[] {
  const samples: Sample[] = [];
  for (let ms = fromMs; ms <= toMs; ms += STEP_MS) {
    const t  = Astronomy.MakeTime(new Date(ms));
    const hz = getHorizon(obj, t, obs);
    const cv = checkWindows(hz.azimuth, hz.altitude, t.date);
    samples.push({ time: t, azimuth: hz.azimuth, altitude: hz.altitude, ...cv });
  }
  return samples;
}

const DAYLIGHT_MARGIN_MS = 24 * 3_600_000;

export function computeData(night: Night, refTime: Astronomy.AstroTime): ObjectData[] {
  const obs = observer();
  const startMs = night.start.date.getTime();
  const endMs   = night.end.date.getTime();

  const data = OBJECTS.map(obj => {
    const samples = sampleRange(obj.body, obs, startMs, endMs);
    // Objects visible in daylight: find the true window over a wider range, but keep only spans that
    // overlap this night so an occurrence on a neighbouring day does not show up as a bogus extra.
    const visSpans = obj.needsDarkness
      ? findVisSpans(samples)
      : findVisSpans(sampleRange(obj.body, obs, startMs - DAYLIGHT_MARGIN_MS, endMs + DAYLIGHT_MARGIN_MS))
          .filter(s => s.end.getTime() >= startMs && s.start.getTime() <= endMs);
    return { ...obj, samples, visSpans, curAz: 0, curAlt: 0, curVisible: false } as ObjectData;
  });
  updateCurrent(data, refTime);
  return data;
}

/** Recompute the "displayed moment" position of each object in place (cheap; no resampling). */
export function updateCurrent(data: ObjectData[], refTime: Astronomy.AstroTime): void {
  const obs = observer();
  for (const d of data) {
    const hz = getHorizon(d.body, refTime, obs);
    const cv = checkWindows(hz.azimuth, hz.altitude, refTime.date);
    d.curAz = hz.azimuth; d.curAlt = hz.altitude; d.curVisible = cv.visible; d.curWindow = cv.window;
  }
}

// ─── Fixed stars (J2000 catalogue) ────────────────────────────────────────────

const D2R = Math.PI / 180;

/** Unit vector in the J2000 equatorial frame (x = vernal equinox, z = north pole). */
export function eqjUnit(raDeg: number, decDeg: number): [number, number, number] {
  const cd = Math.cos(decDeg * D2R);
  return [cd * Math.cos(raDeg * D2R), cd * Math.sin(raDeg * D2R), Math.sin(decDeg * D2R)];
}

/**
 * 3x3 matrix (row-major, 9 numbers) taking a J2000 equatorial unit vector to
 * local (east, north, up). Computed once per time step and applied to
 * every catalogue vector.
 */
export function eqjToEnu(date: Date, obs: Astronomy.Observer): Float64Array {
  const r = Astronomy.Rotation_EQJ_HOR(Astronomy.MakeTime(date), obs).rot;
  // astronomy-engine HOR frame: x = north, y = west, z = zenith; RotateVector uses
  // out[j] = sum_i r[i][j] * v[i].
  const hx = [r[0][0], r[1][0], r[2][0]]; // north
  const hy = [r[0][1], r[1][1], r[2][1]]; // west
  const hz = [r[0][2], r[1][2], r[2][2]]; // up
  return new Float64Array([
    -hy[0], -hy[1], -hy[2], // east  = -west
     hx[0],  hx[1],  hx[2], // north
     hz[0],  hz[1],  hz[2], // up
  ]);
}

/** (east, north, up) unit vector -> azimuth (0 = N, 90 = E) and altitude in degrees. */
export function enuToAzAlt(e: number, n: number, u: number): { az: number; alt: number } {
  let az = Math.atan2(e, n) / D2R;
  if (az < 0) az += 360;
  return { az, alt: Math.asin(Math.max(-1, Math.min(1, u))) / D2R };
}

export function azAltToEnu(azDeg: number, altDeg: number): [number, number, number] {
  const ca = Math.cos(altDeg * D2R);
  return [Math.sin(azDeg * D2R) * ca, Math.cos(azDeg * D2R) * ca, Math.sin(altDeg * D2R)];
}

/** Sample a fixed star through the night (same 15-min grid as the planets). */
export function sampleFixedStar(v: [number, number, number], night: Night): Sample[] {
  const obs = observer();
  const out: Sample[] = [];
  for (let ms = night.start.date.getTime(); ms <= night.end.date.getTime(); ms += STEP_MS) {
    const m = eqjToEnu(new Date(ms), obs);
    const e = m[0] * v[0] + m[1] * v[1] + m[2] * v[2];
    const n = m[3] * v[0] + m[4] * v[1] + m[5] * v[2];
    const u = m[6] * v[0] + m[7] * v[1] + m[8] * v[2];
    const { az, alt } = enuToAzAlt(e, n, u);
    out.push({ time: Astronomy.MakeTime(new Date(ms)), azimuth: az, altitude: alt, ...checkWindows(az, alt, new Date(ms)) });
  }
  return out;
}
