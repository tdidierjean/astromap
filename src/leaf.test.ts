import { test, expect, describe } from 'bun:test';
import { inLeaf, parseMonthDay, defaultLeafSeason, defaultSeasonText } from './leaf';
import { migrateConfig, DEFAULT_CONFIG } from './config';
import { parseTransfer, serializeConfig } from './transfer';

const SYD = -33.87, SEA = 47.61, BONN = 50.74;

describe('default leaf season by latitude', () => {
  test('north keeps 25 Apr - 10 Nov (unchanged behaviour)', () => {
    expect(inLeaf(4, 24, BONN)).toBe(false);
    expect(inLeaf(4, 25, BONN)).toBe(true);
    expect(inLeaf(7, 1, SEA)).toBe(true);
    expect(inLeaf(11, 10, BONN)).toBe(true);
    expect(inLeaf(11, 11, BONN)).toBe(false);
    expect(inLeaf(1, 15, BONN)).toBe(false);
  });
  test('south is shifted by six months and wraps over New Year', () => {
    expect(inLeaf(1, 15, SYD)).toBe(true);
    expect(inLeaf(5, 10, SYD)).toBe(true);
    expect(inLeaf(5, 11, SYD)).toBe(false);
    expect(inLeaf(7, 1, SYD)).toBe(false);
    expect(inLeaf(10, 24, SYD)).toBe(false);
    expect(inLeaf(10, 25, SYD)).toBe(true);
    expect(inLeaf(12, 31, SYD)).toBe(true);
  });
  test('tropics (|lat| < 15): always in leaf', () => {
    for (const lat of [0, 10, -10, 14.9, -14.9]) for (const m of [1, 4, 7, 11]) expect(inLeaf(m, 15, lat)).toBe(true);
    expect(defaultLeafSeason(15)).not.toBeNull();
    expect(defaultLeafSeason(-15)).not.toBeNull();
    expect(defaultSeasonText(5)).toContain('always');
    expect(defaultSeasonText(SYD)).toBe('25 Oct – 10 May');
  });
});

describe('user override', () => {
  test('both dates replace the default, also in the tropics', () => {
    expect(inLeaf(3, 1, BONN, '03-01', '09-30')).toBe(true);
    expect(inLeaf(10, 1, BONN, '03-01', '09-30')).toBe(false);
    expect(inLeaf(1, 1, 0, '03-01', '09-30')).toBe(false);
  });
  test('wrapping override', () => {
    expect(inLeaf(12, 1, SEA, '10-01', '03-31')).toBe(true);
    expect(inLeaf(6, 1, SEA, '10-01', '03-31')).toBe(false);
  });
  test('one unset date falls back to the default of that side of the equator', () => {
    expect(inLeaf(4, 1, BONN, '04-01', undefined)).toBe(true);  // 1 Apr - 10 Nov
    expect(inLeaf(3, 31, BONN, '04-01', undefined)).toBe(false);
    expect(inLeaf(1, 1, SYD, undefined, '03-01')).toBe(true);   // 25 Oct - 1 Mar
    expect(inLeaf(4, 1, SYD, undefined, '03-01')).toBe(false);
  });
  test('invalid strings are ignored', () => {
    expect(parseMonthDay('02-30')).toBeNull();
    expect(parseMonthDay('13-01')).toBeNull();
    expect(parseMonthDay('4-5')).toBeNull();
    expect(parseMonthDay('02-29')).toBe(229);
    expect(inLeaf(1, 1, BONN, 'junk', '99-99')).toBe(false); // = default
  });
});

describe('config and import/export', () => {
  test('old configs have no leaf dates and stay unchanged', () => {
    const c = migrateConfig({ version: 1, lat: 1, lon: 2, windows: [] });
    expect('leafStart' in c).toBe(false);
    expect('leafEnd' in c).toBe(false);
    expect(migrateConfig({ lat: 50.74, lon: 7.12 }).leafStart).toBeUndefined();
  });
  test('valid dates survive migrateConfig, invalid are dropped', () => {
    const c = migrateConfig({ version: 1, lat: 1, lon: 2, windows: [], leafStart: '10-01', leafEnd: '2-3' });
    expect(c.leafStart).toBe('10-01');
    expect(c.leafEnd).toBeUndefined();
  });
  test('export -> import round trip, and hostile values are sanitised', () => {
    const cfg = { ...structuredClone(DEFAULT_CONFIG), lat: SYD, lon: 151.21, leafStart: '10-01', leafEnd: '04-15' };
    const r = parseTransfer(serializeConfig(cfg));
    expect(r.ok && r.kind === 'config' && [r.config.leafStart, r.config.leafEnd]).toEqual(['10-01', '04-15']);
    const bad = parseTransfer(JSON.stringify({ astromap: 1, kind: 'config', config: { ...cfg, leafStart: { x: 1 }, leafEnd: '<b>' } }));
    expect(bad.ok && bad.kind === 'config' && [bad.config.leafStart, bad.config.leafEnd]).toEqual([undefined, undefined]);
  });
});
