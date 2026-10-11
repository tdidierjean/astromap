// Sanity check: fast catalogue rotation vs astronomy-engine's Horizon().
// Run: bun run scripts/check-astro.ts
import * as Astronomy from 'astronomy-engine';
import { catalog } from '../src/catalog';
import { eqjToEnu, enuToAzAlt } from '../src/astro';

const obs = new Astronomy.Observer(50.74, 7.12, 60);
const when = new Date('2026-10-11T20:00:00Z'); // 22:00 CEST
const t = Astronomy.MakeTime(when);
const m = eqjToEnu(when, obs);
const toEqd = Astronomy.Rotation_EQJ_EQD(t);

let worst = 0;
for (const hip of [91262, 11767, 27989, 32349, 102098, 97649, 677, 54061, 24608]) {
  const i = Array.from(catalog.hip).indexOf(hip);
  const v = catalog.starVec.subarray(i * 3, i * 3 + 3);
  const e = m[0] * v[0] + m[1] * v[1] + m[2] * v[2];
  const n = m[3] * v[0] + m[4] * v[1] + m[5] * v[2];
  const u = m[6] * v[0] + m[7] * v[1] + m[8] * v[2];
  const mine = enuToAzAlt(e, n, u);
  // reference: J2000 -> equator-of-date -> Horizon() without refraction
  const eqd = Astronomy.EquatorFromVector(Astronomy.RotateVector(toEqd, new Astronomy.Vector(v[0], v[1], v[2], t)));
  const ref = Astronomy.Horizon(t, obs, eqd.ra, eqd.dec);
  const dAz = Math.abs(((mine.az - ref.azimuth + 540) % 360) - 180);
  const dAlt = Math.abs(mine.alt - ref.altitude);
  worst = Math.max(worst, dAz, dAlt);
  const nm = catalog.names.get(i) ?? `HIP ${hip}`;
  console.log(`${nm.padEnd(12)} mine az ${mine.az.toFixed(2)} alt ${mine.alt.toFixed(2)} | Horizon() az ${ref.azimuth.toFixed(2)} alt ${ref.altitude.toFixed(2)}`);
}
console.log('worst difference (deg):', worst.toFixed(4));
if (worst > 0.05) { console.error('MISMATCH'); process.exit(1); }
