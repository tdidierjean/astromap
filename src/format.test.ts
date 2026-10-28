import { test, expect, describe } from 'bun:test';
import { localParts, localToMs, addLocalDays, nextLocalHour, tzOffsetMs } from './format';

const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe('localParts', () => {
  test('basic zones', () => {
    expect(localParts(Date.UTC(2026, 0, 15, 12, 0), 'Europe/Berlin')).toMatchObject({ y: 2026, m: 1, d: 15, h: 13, mi: 0 });
    expect(localParts(Date.UTC(2026, 6, 15, 12, 0), 'Europe/Berlin')).toMatchObject({ h: 14 });
    expect(localParts(Date.UTC(2026, 0, 15, 12, 0), 'Asia/Kolkata')).toMatchObject({ h: 17, mi: 30 });
    expect(localParts(Date.UTC(2026, 0, 15, 12, 0), 'UTC')).toMatchObject({ h: 12 });
  });
  test('midnight is hour 0, not 24', () => {
    expect(localParts(Date.UTC(2026, 0, 15, 23, 0), 'Europe/Berlin')).toMatchObject({ d: 16, h: 0 });
  });
  test('date changes with the zone', () => {
    const t = Date.UTC(2026, 5, 1, 20, 0);
    expect(localParts(t, 'America/New_York').d).toBe(1);
    expect(localParts(t, 'Australia/Sydney')).toMatchObject({ d: 2, h: 6 });
  });
});

describe('localToMs', () => {
  test('ordinary times', () => {
    expect(iso(localToMs(2026, 1, 15, 20, 0, 'Europe/Berlin'))).toBe('2026-01-15T19:00:00.000Z');
    expect(iso(localToMs(2026, 7, 15, 20, 0, 'Europe/Berlin'))).toBe('2026-07-15T18:00:00.000Z');
    expect(iso(localToMs(2026, 1, 15, 20, 0, 'Asia/Kolkata'))).toBe('2026-01-15T14:30:00.000Z');
    expect(iso(localToMs(2026, 1, 15, 20, 0, 'UTC'))).toBe('2026-01-15T20:00:00.000Z');
    expect(iso(localToMs(2026, 1, 15, 20, 0, 'America/New_York'))).toBe('2026-01-16T01:00:00.000Z');
    expect(iso(localToMs(2026, 1, 15, 20, 0, 'Australia/Sydney'))).toBe('2026-01-15T09:00:00.000Z');
  });
  test('Berlin spring forward 2026-03-29', () => {
    expect(iso(localToMs(2026, 3, 29, 1, 59, 'Europe/Berlin'))).toBe('2026-03-29T00:59:00.000Z');
    expect(iso(localToMs(2026, 3, 29, 3, 0, 'Europe/Berlin'))).toBe('2026-03-29T01:00:00.000Z');
    // non-existent 02:30 lands on a valid instant right at the transition
    const gap = localToMs(2026, 3, 29, 2, 30, 'Europe/Berlin');
    expect(gap).toBeGreaterThanOrEqual(Date.UTC(2026, 2, 29, 0, 30));
    expect(gap).toBeLessThanOrEqual(Date.UTC(2026, 2, 29, 1, 30));
  });
  test('Berlin fall back 2026-10-25', () => {
    expect(iso(localToMs(2026, 10, 25, 1, 59, 'Europe/Berlin'))).toBe('2026-10-24T23:59:00.000Z');
    // ambiguous 02:30 -> first occurrence (CEST)
    expect(iso(localToMs(2026, 10, 25, 2, 30, 'Europe/Berlin'))).toBe('2026-10-25T00:30:00.000Z');
    expect(iso(localToMs(2026, 10, 25, 3, 0, 'Europe/Berlin'))).toBe('2026-10-25T02:00:00.000Z');
  });
  test('New York transitions (2026-03-08, 2026-11-01)', () => {
    expect(iso(localToMs(2026, 3, 8, 3, 0, 'America/New_York'))).toBe('2026-03-08T07:00:00.000Z');
    expect(iso(localToMs(2026, 3, 8, 1, 30, 'America/New_York'))).toBe('2026-03-08T06:30:00.000Z');
    expect(iso(localToMs(2026, 11, 1, 1, 30, 'America/New_York'))).toBe('2026-11-01T05:30:00.000Z');
    expect(iso(localToMs(2026, 11, 1, 3, 0, 'America/New_York'))).toBe('2026-11-01T08:00:00.000Z');
  });
  test('Sydney transitions (2026-04-05 end, 2026-10-04 start)', () => {
    expect(iso(localToMs(2026, 4, 5, 3, 30, 'Australia/Sydney'))).toBe('2026-04-04T17:30:00.000Z');
    expect(iso(localToMs(2026, 4, 5, 2, 30, 'Australia/Sydney'))).toBe('2026-04-04T15:30:00.000Z'); // ambiguous: first
    expect(iso(localToMs(2026, 4, 5, 4, 0, 'Australia/Sydney'))).toBe('2026-04-04T18:00:00.000Z');
    expect(iso(localToMs(2026, 10, 4, 1, 59, 'Australia/Sydney'))).toBe('2026-10-03T15:59:00.000Z');
    expect(iso(localToMs(2026, 10, 4, 3, 0, 'Australia/Sydney'))).toBe('2026-10-03T16:00:00.000Z');
  });
  test('day/hour overflow normalises', () => {
    expect(iso(localToMs(2026, 1, 32, 0, 0, 'UTC'))).toBe('2026-02-01T00:00:00.000Z');
    expect(iso(localToMs(2026, 12, 31, 24, 0, 'Europe/Berlin'))).toBe('2026-12-31T23:00:00.000Z');
  });
  test('round trip over a year of hours in several zones', () => {
    for (const tz of ['Europe/Berlin', 'America/New_York', 'Australia/Sydney', 'Asia/Kolkata', 'UTC']) {
      for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 37 * 60_000 * 7) {
        const p = localParts(t, tz);
        const back = localToMs(p.y, p.m, p.d, p.h, p.mi, tz);
        const q = localParts(back, tz);
        expect([q.y, q.m, q.d, q.h, q.mi]).toEqual([p.y, p.m, p.d, p.h, p.mi]);
        expect(Math.abs(back - t)).toBeLessThanOrEqual(H); // equal, or the other of an ambiguous pair
      }
    }
  });
});

describe('addLocalDays / nextLocalHour', () => {
  test('calendar days across DST are 23/25 h long', () => {
    const a = localToMs(2026, 3, 28, 20, 0, 'Europe/Berlin');
    expect(addLocalDays(a, 1, 'Europe/Berlin') - a).toBe(23 * H);
    const b = localToMs(2026, 10, 24, 20, 0, 'Europe/Berlin');
    expect(addLocalDays(b, 1, 'Europe/Berlin') - b).toBe(25 * H);
    expect(addLocalDays(b, -1, 'Europe/Berlin')).toBe(localToMs(2026, 10, 23, 20, 0, 'Europe/Berlin'));
  });
  test('next full local hour', () => {
    const t = Date.UTC(2026, 0, 15, 12, 10); // 17:40 in Kolkata
    expect(iso(nextLocalHour(t, 'Asia/Kolkata'))).toBe('2026-01-15T12:30:00.000Z'); // 18:00 local
    expect(iso(nextLocalHour(t, 'UTC'))).toBe('2026-01-15T13:00:00.000Z');
    expect(nextLocalHour(Date.UTC(2026, 0, 15, 13, 0), 'UTC')).toBe(Date.UTC(2026, 0, 15, 14, 0));
  });
  test('offsets', () => {
    expect(tzOffsetMs(Date.UTC(2026, 0, 15), 'Asia/Kolkata')).toBe(5.5 * H);
    expect(tzOffsetMs(Date.UTC(2026, 0, 15), 'Australia/Sydney')).toBe(11 * H);
  });
});

import { esc } from './format';
describe('esc', () => {
  test('escapes HTML', () => {
    expect(esc(`<b>x</b> & "y" 'z'`)).toBe('&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot; &#39;z&#39;');
  });
});
