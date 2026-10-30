import { test, expect, describe } from 'bun:test';
import { migrateConfig, DEFAULT_CONFIG, CONFIG_VERSION, isValidTz, demoConfig, deviceTz, type Config } from './config';
import { DEMO_CONFIG } from './demo';
import { HORIZON_NORTH } from './data/horizon-north';
import { HORIZON_SOUTH } from './data/horizon-south';

/** A config exactly as the app saved it before versioning (no version, no ids). */
const v0 = (): any => {
  const c: any = demoConfig();
  c.tz = deviceTz(); delete c.name;
  delete c.version;
  for (const w of c.windows) delete w.id;
  return c;
};

/** What migrateConfig produced for legacy configs before the demo split (Bonn values hard-wired into DEFAULT_CONFIG); written out literally. */
const LEGACY_RESULT = (): Config => ({
  version: 1, name: 'Bonn-Beuel', lat: 50.74, lon: 7.12, elev: 60, tz: deviceTz(), clock: 'auto',
  windows: [
    { id: 'north', label: 'North', azCenter: 12, halfWidth: 72, profile: HORIZON_NORTH },
    { id: 'south', label: 'South', azCenter: 163.5, halfWidth: 72.5, profile: HORIZON_SOUTH },
  ],
  minAlt: 10, limitMag: 4.0, showGrid: false, leaf: 'auto',
});

describe('legacy (v0) configs still migrate to the Bonn setup', () => {
  test('as saved by the app', () => expect(migrateConfig(v0())).toEqual(LEGACY_RESULT()));
  test('oldest shape: only windows by label, no profiles, no ids, no tz/clock/elev', () => {
    const c = migrateConfig({ lat: 50.74, lon: 7.12, minAlt: 10, windows: [
      { label: 'North', azCenter: 0, halfWidth: 45 }, { label: 'South', azCenter: 180, halfWidth: 45 }] });
    expect(c).toEqual(LEGACY_RESULT());
  });
  test('stored data missing every field -> Bonn values', () => {
    expect(migrateConfig({})).toEqual(LEGACY_RESULT());
    expect(migrateConfig({ lat: 1 })).toEqual({ ...LEGACY_RESULT(), lat: 1 });
  });
  test('v0 without windows array gets both Bonn windows', () => {
    expect(migrateConfig({ lat: 48, lon: 2 }).windows).toEqual(LEGACY_RESULT().windows);
  });
  test('v0 with an own empty list stays empty; name still Bonn-Beuel (as the old header showed)', () => {
    const c = migrateConfig({ windows: [] });
    expect(c.windows).toEqual([]);
    expect(c.name).toBe('Bonn-Beuel');
  });
});

describe('v1 stored configs are untouched', () => {
  test('complete v1 config (own place, windows, no name) round-trips unchanged', () => {
    const c: Config = { ...structuredClone(DEFAULT_CONFIG), lat: -33.87, lon: 151.21, elev: 20, tz: 'Australia/Sydney',
      windows: [{ id: 'abc', label: 'Garden', azCenter: 0, halfWidth: 60 }] };
    expect(migrateConfig(JSON.parse(JSON.stringify(c)))).toEqual(c);
  });
  test('v1 with the Bonn setup keeps exactly what is stored', () => {
    const c = { ...demoConfig(), name: '' };
    expect(migrateConfig(JSON.parse(JSON.stringify(c)))).toEqual(c);
  });
  test('v1 without name: empty (header falls back to coordinates); name kept and trimmed when present', () => {
    expect(migrateConfig({ version: 1, lat: 1, lon: 2 }).name).toBe('');
    expect(migrateConfig({ version: 1, name: '  Home ' }).name).toBe('Home');
    expect(migrateConfig({ version: 1, name: 5 }).name).toBe('');
  });
  test('v1 never gets Bonn profiles baked in', () => {
    const c = migrateConfig({ version: 1, windows: [{ id: 'x', label: 'North', azCenter: 1, halfWidth: 2 }] });
    expect(c.windows[0].profile).toBeUndefined();
  });
});

describe('demo preset', () => {
  test('demoConfig is Bonn with Europe/Berlin and fresh copies', () => {
    const d = demoConfig();
    expect(d).toMatchObject({ version: CONFIG_VERSION, name: 'Bonn-Beuel', tz: 'Europe/Berlin', lat: 50.74, lon: 7.12, elev: 60 });
    expect(d.windows.map(w => w.id)).toEqual(['north', 'south']);
    d.windows[0].label = 'x';
    expect(DEMO_CONFIG.windows[0].label).toBe('North');
  });
  test('default config is neutral', () => {
    expect(DEFAULT_CONFIG.windows).toEqual([]);
    expect(DEFAULT_CONFIG.name).toBe('');
  });
});

describe('migrateConfig', () => {
  test('no saved config -> defaults', () => {
    expect(migrateConfig(undefined)).toEqual(DEFAULT_CONFIG);
    expect(migrateConfig(undefined).version).toBe(CONFIG_VERSION);
  });
  test('v0 as saved by the app: ids added, profiles intact', () => {
    const c = migrateConfig(v0());
    expect(c).toEqual(LEGACY_RESULT());
    expect(c.windows.map(w => w.id)).toEqual(['north', 'south']);
  });
  test('v0 with profiles missing: built-ins baked in', () => {
    const r = v0();
    for (const w of r.windows) { delete w.profile; w.azCenter = 0; w.halfWidth = 45; }
    const c = migrateConfig(r);
    expect(c.windows[0].profile).toEqual(HORIZON_NORTH);
    expect(c.windows[1].profile).toEqual(HORIZON_SOUTH);
    expect(c.windows[0].azCenter).toBe(12);
    expect(c.windows[1].halfWidth).toBe(72.5);
  });
  test('v0 with profileOptOut on South: stays simple', () => {
    const r = v0();
    delete r.windows[1].profile; r.windows[1].profileOptOut = true; r.windows[1].azCenter = 180; r.windows[1].halfWidth = 45;
    const c = migrateConfig(r);
    expect(c.windows[1].profile).toBeUndefined();
    expect(c.windows[1].profileOptOut).toBe(true);
    expect(c.windows[1].azCenter).toBe(180);
    expect(c.windows[0].profile).toEqual(HORIZON_NORTH);
  });
  test('v0 user changes preserved', () => {
    const r = v0(); r.lat = 48.1; r.limitMag = 5.5; r.leaf = 'bare'; r.showGrid = true;
    const c = migrateConfig(r);
    expect([c.lat, c.limitMag, c.leaf, c.showGrid]).toEqual([48.1, 5.5, 'bare', true]);
  });
  test('v0 missing scalar fields filled from the Bonn preset', () => {
    const c = migrateConfig({ lat: 1, windows: [] });
    expect(c.lon).toBe(7.12);
    expect(c.windows).toEqual([]);
  });
  test('v0 other windows get generated unique ids, no profile', () => {
    const c = migrateConfig({ windows: [{ label: 'Balcony', azCenter: 90, halfWidth: 30 }, { label: 'Roof', azCenter: 0, halfWidth: 50 }] });
    expect(c.windows[0].id).toBeTruthy();
    expect(c.windows[0].id).not.toBe(c.windows[1].id);
    expect(c.windows[0].profile).toBeUndefined();
  });
  test('v1 round trip', () => {
    const c = migrateConfig(v0());
    expect(migrateConfig(JSON.parse(JSON.stringify(c)))).toEqual(c);
  });
  test('v1 window without profile stays without profile (even if labelled South)', () => {
    const c: Config = { ...demoConfig(), windows: [{ id: 'south', label: 'South', azCenter: 170, halfWidth: 40 }] };
    const m = migrateConfig(JSON.parse(JSON.stringify(c)));
    expect(m.windows[0].profile).toBeUndefined();
    expect(m.windows[0].halfWidth).toBe(40);
  });
  test('v1 renamed window keeps id and profile', () => {
    const c = demoConfig(); c.windows[0].label = 'Street side';
    const m = migrateConfig(JSON.parse(JSON.stringify(c)));
    expect(m.windows[0].id).toBe('north');
    expect(m.windows[0].profile).toEqual(HORIZON_NORTH);
  });
  test('v1 missing fields filled', () => {
    const m = migrateConfig({ version: 1, lat: 10, lon: 20 });
    expect(m.lat).toBe(10);
    expect(m.minAlt).toBe(DEFAULT_CONFIG.minAlt);
    expect(m.windows).toEqual([]);
    expect(m.lon).toBe(20);
  });
  test('garbage -> defaults', () => {
    for (const g of [null, 42, 'x', [], true, undefined]) expect(migrateConfig(g)).toEqual(DEFAULT_CONFIG);
  });
  test('wrong field types fall back to defaults', () => {
    const m = migrateConfig({ lat: 'x', lon: null, leaf: 'nope', showGrid: 1, windows: [5, null, { label: 3 }] });
    expect(m.lat).toBe(50.74); // v0: Bonn preset
    expect(m.leaf).toBe('auto');
    expect(m.showGrid).toBe(false);
    expect(m.windows).toEqual([]);
  });
  test('does not mutate DEFAULT_CONFIG', () => {
    const before = JSON.stringify([DEFAULT_CONFIG, DEMO_CONFIG]);
    const m = migrateConfig(undefined); m.windows.push({ id: 'a', label: 'x', azCenter: 0, halfWidth: 1 }); m.lat = 5;
    migrateConfig({}).windows[0].label = 'y';
    expect(JSON.stringify([DEFAULT_CONFIG, DEMO_CONFIG])).toBe(before);
  });
});

describe('tz / clock', () => {
  test('defaults: valid device zone, clock auto', () => {
    expect(isValidTz(DEFAULT_CONFIG.tz)).toBe(true);
    expect(DEFAULT_CONFIG.clock).toBe('auto');
    expect(migrateConfig(undefined).tz).toBe(DEFAULT_CONFIG.tz);
  });
  test('valid values kept, invalid replaced by defaults', () => {
    expect(migrateConfig({ version: 1, tz: 'Asia/Kolkata', clock: '12' })).toMatchObject({ tz: 'Asia/Kolkata', clock: '12' });
    expect(migrateConfig({ version: 1, tz: 'Mars/Olympus', clock: 'x' })).toMatchObject({ tz: DEFAULT_CONFIG.tz, clock: 'auto' });
    expect(migrateConfig({ version: 1, tz: 5 }).tz).toBe(DEFAULT_CONFIG.tz);
    expect(migrateConfig({ version: 1 }).tz).toBe(DEFAULT_CONFIG.tz);
  });
});
