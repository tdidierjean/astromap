// Sky background colour from the Sun's altitude, and star colours from B-V.

type RGB = [number, number, number];

// [sun altitude, zenith colour, horizon colour]
const KEYS: Array<[number, RGB, RGB]> = [
  [ 10, [ 44,  82, 130], [112, 150, 192]], // day
  [  0, [ 34,  58,  98], [176, 124, 104]], // sunset / sunrise
  [ -6, [ 20,  32,  64], [ 78,  74,  98]], // civil twilight ends
  [-12, [ 10,  16,  36], [ 30,  38,  64]], // nautical twilight ends
  [-18, [  4,   6,  13], [ 16,  21,  38]], // astronomical night
];

function lerp(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export const rgb = (c: RGB) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;

export function skyColors(sunAlt: number): { top: RGB; bottom: RGB } {
  if (sunAlt >= KEYS[0][0]) return { top: KEYS[0][1], bottom: KEYS[0][2] };
  for (let i = 0; i < KEYS.length - 1; i++) {
    const [a0, t0, b0] = KEYS[i], [a1, t1, b1] = KEYS[i + 1];
    if (sunAlt <= a0 && sunAlt >= a1) {
      const t = (a0 - sunAlt) / (a0 - a1);
      return { top: lerp(t0, t1, t), bottom: lerp(b0, b1, t) };
    }
  }
  const last = KEYS[KEYS.length - 1];
  return { top: last[1], bottom: last[2] };
}

export function twilightName(sunAlt: number): string {
  if (sunAlt > 0)   return 'Daylight';
  if (sunAlt > -6)  return 'Civil twilight';
  if (sunAlt > -12) return 'Nautical twilight';
  if (sunAlt > -18) return 'Astronomical twilight';
  return 'Night';
}

/**
 * Faintest magnitude that is realistically visible for a given Sun altitude
 * (stars appear one by one as the sky darkens).
 */
export function twilightLimit(sunAlt: number): number {
  const pts: Array<[number, number]> = [[0, -2], [-6, 0.5], [-12, 2.5], [-18, 7]];
  if (sunAlt >= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [a0, m0] = pts[i], [a1, m1] = pts[i + 1];
    if (sunAlt <= a0 && sunAlt >= a1) return m0 + (m1 - m0) * (a0 - sunAlt) / (a0 - a1);
  }
  return pts[pts.length - 1][1];
}

/** Approximate star colour (CSS) from the B-V index. */
export function starColor(bv: number): string {
  const stops: Array<[number, RGB]> = [
    [-0.3, [160, 190, 255]], [0.0, [200, 218, 255]], [0.4, [255, 248, 235]],
    [0.8, [255, 226, 170]], [1.3, [255, 190, 130]], [2.0, [255, 150, 100]],
  ];
  if (bv <= stops[0][0]) return rgb(stops[0][1]);
  for (let i = 0; i < stops.length - 1; i++) {
    const [b0, c0] = stops[i], [b1, c1] = stops[i + 1];
    if (bv <= b1) return rgb(lerp(c0, c1, (bv - b0) / (b1 - b0)));
  }
  return rgb(stops[stops.length - 1][1]);
}
