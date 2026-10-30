import { test, expect, describe } from 'bun:test';
import { round2, formatCoords, locationLabel, parseLat, parseLon, parseGeocoding, parseElevation, searchPlaces, lookupElevation } from './location';

describe('coordinates', () => {
  test('round2', () => {
    expect(round2(50.7349)).toBe(50.73);
    expect(round2(7.126)).toBe(7.13);
    expect(round2(-33.8688)).toBe(-33.87);
  });
  test('formatCoords with hemispheres', () => {
    expect(formatCoords(50.73, 7.13)).toBe('50.73°N 7.13°E');
    expect(formatCoords(-33.87, -70.5)).toBe('33.87°S 70.50°W');
    expect(formatCoords(0, 0)).toBe('0.00°N 0.00°E');
  });
  test('locationLabel: name, else coordinates', () => {
    expect(locationLabel({ name: 'Bonn', lat: 1, lon: 2 })).toBe('Bonn');
    expect(locationLabel({ name: '  ', lat: 50.74, lon: 7.12 })).toBe('50.74°N 7.12°E');
    expect(locationLabel({ lat: 50.74, lon: 7.12 })).toBe('50.74°N 7.12°E');
  });
  test('range validation', () => {
    expect(parseLat('50.5')).toBe(50.5);
    expect(parseLat('50,5')).toBe(50.5);
    expect(parseLat('90')).toBe(90);
    expect(parseLat('91')).toBeNull();
    expect(parseLat('')).toBeNull();
    expect(parseLat('abc')).toBeNull();
    expect(parseLon('-180')).toBe(-180);
    expect(parseLon('181')).toBeNull();
  });
});

describe('parseGeocoding', () => {
  const json = { results: [
    { name: 'Bonn', latitude: 50.73438, longitude: 7.09549, elevation: 64.4, timezone: 'Europe/Berlin', admin1: 'North Rhine-Westphalia', country: 'Germany' },
    { name: 'Nowhere', latitude: 10, longitude: 20, timezone: 'Mars/Olympus' },
    { name: 'Bad', latitude: 120, longitude: 20 },
    { latitude: 1, longitude: 2 },
    'junk',
  ] };
  test('maps fields, rounds, describes', () => {
    const [bonn] = parseGeocoding(json, 'UTC');
    expect(bonn).toEqual({ name: 'Bonn', lat: 50.73, lon: 7.1, elev: 64, tz: 'Europe/Berlin', detail: 'Bonn, North Rhine-Westphalia, Germany' });
  });
  test('invalid tz -> fallback, missing elevation -> 0, bad entries dropped', () => {
    const r = parseGeocoding(json, 'Asia/Tokyo');
    expect(r).toHaveLength(2);
    expect(r[1]).toMatchObject({ name: 'Nowhere', tz: 'Asia/Tokyo', elev: 0, detail: 'Nowhere' });
  });
  test('no results / garbage -> empty', () => {
    for (const g of [{}, null, undefined, { results: 'x' }, 5]) expect(parseGeocoding(g, 'UTC')).toEqual([]);
  });
});

describe('elevation', () => {
  test('parseElevation', () => {
    expect(parseElevation({ elevation: [63.6] })).toBe(64);
    expect(parseElevation({ elevation: 12 })).toBe(12);
    expect(parseElevation({ elevation: [] })).toBeNull();
    expect(parseElevation(null)).toBeNull();
  });
  test('lookupElevation: 0 on failure', async () => {
    expect(await lookupElevation(1, 2, (async () => { throw new Error('offline'); }) as unknown as typeof fetch)).toBe(0);
    expect(await lookupElevation(1, 2, (async () => ({ ok: true, json: async () => ({ elevation: [88.2] }) })) as unknown as typeof fetch)).toBe(88);
    expect(await lookupElevation(1, 2, (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch)).toBe(0);
  });
});

describe('searchPlaces', () => {
  test('builds the request and parses', async () => {
    let url = '';
    const f = (async (u: string) => { url = u; return { ok: true, json: async () => ({ results: [{ name: 'Köln', latitude: 50.94, longitude: 6.96 }] }) }; }) as unknown as typeof fetch;
    const r = await searchPlaces('Köln & co', 'de', 'UTC', f);
    expect(url).toBe('https://geocoding-api.open-meteo.com/v1/search?name=K%C3%B6ln%20%26%20co&count=5&language=de');
    expect(r[0].name).toBe('Köln');
  });
  test('rejects when offline', async () => {
    await expect(searchPlaces('x', 'en', 'UTC', (async () => { throw new Error('offline'); }) as unknown as typeof fetch)).rejects.toThrow();
  });
});
