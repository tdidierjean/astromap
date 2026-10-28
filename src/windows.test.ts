import { test, expect, describe } from 'bun:test';
import { pointAz, pointIndex, parseDegrees, rangeHint, defaultWindowName, newSimpleWindow, seedFromProfile, moveWindow, COMPASS16 } from './windows';
import { DEFAULT_CONFIG, type ViewWindow, type HorizonProfile } from './config';

const win = (id: string, label = id): ViewWindow => ({ id, label, azCenter: 0, halfWidth: 45 });
const prof = (azMin: number, azMax: number): HorizonProfile => ({ azMin, azMax, points: [], source: 't' });

describe('compass', () => {
  test('point degrees', () => {
    expect(pointAz(COMPASS16.indexOf('WSW'))).toBe(247);
    expect(pointAz(0)).toBe(0);
    expect(pointAz(8)).toBe(180);
    expect(pointAz(15)).toBe(337);
  });
  test('pointIndex: exact points only', () => {
    expect(pointIndex(180)).toBe(8);
    expect(pointIndex(247)).toBe(11);
    expect(pointIndex(163)).toBe(-1);
    for (let i = 0; i < 16; i++) expect(pointIndex(pointAz(i))).toBe(i);
  });
  test('parseDegrees', () => {
    expect(parseDegrees('247')).toBe(247);
    expect(parseDegrees(' 0 ')).toBe(0);
    for (const bad of ['', '360', '-1', '1.5', 'abc']) expect(parseDegrees(bad)).toBeNull();
  });
});

describe('rangeHint', () => {
  test('wraps through north', () => {
    expect(rangeHint(0, 45)).toBe('315° – 45°');
    expect(rangeHint(180, 45)).toBe('135° – 225°');
    expect(rangeHint(247, 30)).toBe('217° – 277°');
    expect(rangeHint(350, 90)).toBe('260° – 80°');
  });
});

describe('naming and creation', () => {
  test('first unused Window N', () => {
    expect(defaultWindowName([])).toBe('Window 1');
    expect(defaultWindowName([win('a', 'Window 1'), win('b', 'Window 3')])).toBe('Window 2');
  });
  test('new window faces the equator', () => {
    const n = newSimpleWindow([], 50.7), s = newSimpleWindow([n], -33.9);
    expect(n).toMatchObject({ label: 'Window 1', azCenter: 180, halfWidth: 45 });
    expect(s).toMatchObject({ label: 'Window 2', azCenter: 0, halfWidth: 45 });
    expect(n.id).toBeTruthy();
    expect(n.id).not.toBe(s.id);
  });
});

describe('seedFromProfile', () => {
  test('keeps the direction of the built-in windows', () => {
    const south = DEFAULT_CONFIG.windows[1].profile!, north = DEFAULT_CONFIG.windows[0].profile!;
    const s = seedFromProfile(south), n = seedFromProfile(north);
    expect(Math.abs(s.azCenter - 163.5)).toBeLessThanOrEqual(1);
    expect(Math.abs(n.azCenter - 12)).toBeLessThanOrEqual(1);
    expect(s.halfWidth % 5).toBe(0);
  });
  test('range crossing north', () => {
    expect(seedFromProfile(prof(300, 84))).toEqual({ azCenter: 12, halfWidth: 70 });
    expect(seedFromProfile(prof(350, 10))).toEqual({ azCenter: 0, halfWidth: 10 });
  });
  test('half-width clamped to the slider', () => {
    expect(seedFromProfile(prof(0, 2)).halfWidth).toBe(5);
    expect(seedFromProfile(prof(10, 350)).halfWidth).toBe(90);
  });
});

describe('moveWindow', () => {
  test('swaps neighbours and refuses at the ends', () => {
    const l = [win('a'), win('b'), win('c')];
    expect(moveWindow(l, 'c', -1)).toBe(true);
    expect(l.map(w => w.id)).toEqual(['a', 'c', 'b']);
    expect(moveWindow(l, 'a', -1)).toBe(false);
    expect(moveWindow(l, 'b', 1)).toBe(false);
    expect(moveWindow(l, 'zzz', 1)).toBe(false);
    expect(l.map(w => w.id)).toEqual(['a', 'c', 'b']);
  });
});
