// Generates src/data/catalog.json from the d3-celestial datasets (BSD-3-Clause,
// https://github.com/ofrohn/d3-celestial). Run once: `bun run scripts/build-catalog.ts`
// Output is committed; the app never fetches anything at runtime.

const BASE = 'https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/';
const MAG_LIMIT = 5.0;
const NAMED_STARS = 75; // only stars that can rise at mid-northern latitudes (dec > -35)

async function get(name: string): Promise<any> {
  const r = await fetch(BASE + name);
  if (!r.ok) throw new Error(`${name}: ${r.status}`);
  return r.json();
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const ra360 = (ra: number) => (ra < 0 ? ra + 360 : ra);

// Asterisms, as polylines of HIP numbers (each inner array = one polyline).
const ASTERISMS: Array<{ name: string; paths: number[][] }> = [
  { name: 'Big Dipper', paths: [[54061, 53910, 58001, 59774, 54061], [59774, 62956, 65378, 67301]] },
  { name: 'Summer Triangle', paths: [[91262, 102098, 97649, 91262]] },
  { name: 'Winter Triangle', paths: [[27989, 32349, 37279, 27989]] },
  { name: 'Winter Hexagon', paths: [[24608, 21421, 24436, 32349, 37279, 37826, 24608]] },
  { name: "Orion's Belt", paths: [[25930, 26311, 26727]] },
  { name: 'Spring Triangle', paths: [[69673, 65474, 57632, 69673]] },
  { name: 'Great Square', paths: [[113963, 113881, 677, 1067, 113963]] },
  { name: 'Pointers', paths: [[54061, 53910], [54061, 11767]] },
];

const stars = await get('stars.6.json');
const names = await get('starnames.json');
const lines = await get('constellations.lines.json');
const cons = await get('constellations.json');

// ---- stars ----
type S = { hip: number; ra: number; dec: number; mag: number; bv: number };
const all: S[] = stars.features.map((f: any) => ({
  hip: f.id as number,
  ra: ra360(f.geometry.coordinates[0]),
  dec: f.geometry.coordinates[1],
  mag: f.properties.mag as number,
  bv: parseFloat(f.properties.bv) || 0,
}));

const needed = new Set<number>(ASTERISMS.flatMap(a => a.paths.flat()));
const kept = all.filter(s => s.mag <= MAG_LIMIT || needed.has(s.hip)).sort((a, b) => a.mag - b.mag);
const idxOfHip = new Map<number, number>();
kept.forEach((s, i) => idxOfHip.set(s.hip, i));
for (const h of needed) if (!idxOfHip.has(h)) throw new Error('asterism star missing: HIP ' + h);

// ---- proper names: brightest N stars having a proper name ----
const nameOf = (hip: number): string => (names[String(hip)]?.name ?? '').trim();
const named: Array<[number, string]> = [];
for (let i = 0; i < kept.length && named.length < NAMED_STARS; i++) {
  const n = nameOf(kept[i].hip);
  if (n && kept[i].dec > -35) named.push([i, n]);
}

// ---- constellation lines: vertices annotated with the magnitude of the matching star ----
function magAt(ra: number, dec: number): number {
  let best = 99, bd = 0.05;
  for (const s of all) {
    const d = Math.hypot((s.ra - ra360(ra)) * Math.cos(dec * Math.PI / 180), s.dec - dec);
    if (d < bd) { bd = d; best = s.mag; }
  }
  return best;
}
let unmatched = 0, total = 0;
const conLines = lines.features.map((f: any) => ({
  id: f.id as string,
  paths: (f.geometry.coordinates as number[][][]).map(path =>
    path.map(([ra, dec]) => {
      const m = magAt(ra, dec);
      total++; if (m === 99) unmatched++;
      return [r2(ra360(ra)), r2(dec), m === 99 ? 9 : m];
    })),
}));
console.error(`line vertices: ${total}, unmatched to a star: ${unmatched}`);

const conNames = cons.features.map((f: any) => ({
  id: f.id as string,
  name: f.properties.name as string,
  rank: Number(f.properties.rank) || 3,
  ra: r2(ra360(f.geometry.coordinates[0])),
  dec: r2(f.geometry.coordinates[1]),
}));

const out = {
  // stars[i] = [raDeg 0..360, decDeg, mag, bv]  (J2000), sorted brightest first
  stars: kept.map(s => [r2(s.ra), r2(s.dec), s.mag, Math.round(s.bv * 100) / 100]),
  hip: kept.map(s => s.hip),
  // Bayer letter (or Flamsteed number) and constellation code, e.g. "α", "Lyr" (empty when unknown)
  des: kept.map(s => names[String(s.hip)]?.bayer || names[String(s.hip)]?.flam || ''),
  con: kept.map(s => names[String(s.hip)]?.c || ''),
  names: named,
  lines: conLines,
  asterisms: ASTERISMS.map(a => ({ name: a.name, paths: a.paths.map(p => p.map(h => idxOfHip.get(h)!)) })),
  constellations: conNames,
};
const path = new URL('../src/data/catalog.json', import.meta.url).pathname;
await Bun.write(path, JSON.stringify(out));
console.error(`stars: ${kept.length}, named: ${named.length}, constellations: ${conNames.length}`);
console.error('names:', named.map(n => n[1]).join(', '));
