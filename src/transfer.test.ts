import { test, expect, describe } from 'bun:test';
import {
  serializeConfig, serializeWindow, parseTransfer, withFreshId, slug, configFilename, windowFilename,
  TRANSFER_VERSION, MAX_IMPORT_BYTES,
} from './transfer';
import { demoConfig, CONFIG_VERSION, type ViewWindow } from './config';

const wrap = (o: object) => JSON.stringify({ astromap: TRANSFER_VERSION, ...o });
const okWin = (): ViewWindow => ({ id: 'w1', label: 'Kitchen', azCenter: 90, halfWidth: 40 });
const prof = () => ({ azMin: 300, azMax: 84, source: 'test', points: [
  { az: 10, alt: 20, kind: 'building' }, { az: 310, alt: 5, kind: 'tree', bare: 3 }, { az: 350, alt: 12, kind: 'estimated' }] });

describe('round trip', () => {
  test('whole config incl. measured profiles', () => {
    const c = demoConfig();
    const r = parseTransfer(serializeConfig(c));
    expect(r.ok && r.kind === 'config' && r.config).toEqual(c);
  });
  test('window with profile', () => {
    const w = demoConfig().windows[0];
    const r = parseTransfer(serializeWindow(w));
    expect(r.ok && r.kind === 'window' && r.window).toEqual(w);
  });
});

describe('rejects', () => {
  const err = (t: string) => { const r = parseTransfer(t); return r.ok ? '' : r.error; };
  test('not JSON', () => expect(err('hello')).toContain('not a JSON'));
  test('no marker / wrong shape', () => {
    for (const t of ['{}', '[]', 'null', '42', '{"astromap":"1"}', JSON.stringify({ config: {} })]) expect(err(t)).toContain('not an AstroMap');
  });
  test('too-new format version', () => expect(err(wrap({ astromap: 2 }).replace('"astromap":1', '"astromap":2'))).toContain('newer version'));
  test('too-new config version', () => expect(err(wrap({ kind: 'config', config: { ...demoConfig(), version: CONFIG_VERSION + 1 } }))).toContain('newer version'));
  test('unknown kind', () => expect(err(wrap({ kind: 'x' }))).toContain('whether'));
  test('too large', () => expect(err(' '.repeat(MAX_IMPORT_BYTES + 1))).toContain('too large'));
  test('config without a valid place', () => {
    expect(err(wrap({ kind: 'config', config: { windows: [] } }))).toContain('location');
    expect(err(wrap({ kind: 'config', config: { lat: 91, lon: 0 } }))).toContain('out of range');
    expect(err(wrap({ kind: 'config', config: 'x' }))).toContain('no settings');
  });
  test('window garbage', () => {
    const bad = [null, 5, {}, { ...okWin(), label: '  ' }, { ...okWin(), azCenter: 400 }, { ...okWin(), azCenter: NaN }, { ...okWin(), halfWidth: 'x' },
      { ...okWin(), profile: 'x' }, { ...okWin(), profile: { ...prof(), points: [] } },
      { ...okWin(), profile: { ...prof(), azMin: -5 } },
      { ...okWin(), profile: { ...prof(), points: [{ az: 1, alt: 95, kind: 'tree' }] } },
      { ...okWin(), profile: { ...prof(), points: [{ az: 1, alt: 5, kind: 'wall' }] } }];
    for (const w of bad) expect(err(wrap({ kind: 'window', window: w }))).not.toBe('');
  });
  test('one bad window rejects the whole config', () => {
    const c = demoConfig(); (c.windows[1] as any).azCenter = 999;
    expect(err(wrap({ kind: 'config', config: c }))).toContain('0 and 360');
  });
});

describe('clamping and normalising', () => {
  const win = (w: object) => { const r = parseTransfer(wrap({ kind: 'window', window: w })); if (!r.ok || r.kind !== 'window') throw new Error('bad'); return r.window; };
  test('halfWidth, label, az wrap', () => {
    expect(win({ ...okWin(), halfWidth: 500 }).halfWidth).toBe(90);
    expect(win({ ...okWin(), halfWidth: -3 }).halfWidth).toBe(1);
    expect(win({ ...okWin(), label: 'x'.repeat(100) }).label.length).toBe(40);
    expect(win({ ...okWin(), azCenter: 360 }).azCenter).toBe(0);
  });
  test('profile points sorted from azMin, source defaulted', () => {
    const p = win({ ...okWin(), profile: { ...prof(), source: undefined } }).profile!;
    expect(p.points.map(x => x.az)).toEqual([310, 350, 10]);
    expect(p.source).toBe('imported');
  });
  test('unknown fields are dropped', () => {
    expect(win({ ...okWin(), evil: 1, profile: { ...prof(), x: 1 } })).not.toHaveProperty('evil');
  });
  test('config numbers clamped, duplicate window ids made unique', () => {
    const c: any = { ...demoConfig(), minAlt: 500, limitMag: -4, elev: 1e9 };
    c.windows = [okWin(), okWin()];
    const r = parseTransfer(wrap({ kind: 'config', config: c }));
    if (!r.ok || r.kind !== 'config') throw new Error('bad');
    expect([r.config.minAlt, r.config.limitMag, r.config.elev]).toEqual([45, 2, 9000]);
    expect(new Set(r.config.windows.map(w => w.id)).size).toBe(2);
  });
});

describe('withFreshId', () => {
  test('keeps a free id, replaces a colliding or empty one', () => {
    const w = okWin();
    expect(withFreshId(w, [{ ...w, id: 'other' }]).id).toBe('w1');
    const n = withFreshId(w, [w]);
    expect(n.id).not.toBe('w1'); expect(n.id).toBeTruthy();
    expect(withFreshId({ ...w, id: '' }, []).id).toBeTruthy();
  });
  test('copy is independent', () => {
    const w = { ...okWin(), profile: prof() as any };
    expect(withFreshId(w, []).profile).not.toBe(w.profile);
  });
});

describe('file names', () => {
  test('slug', () => {
    expect(slug('Café Bonn-Beuel!')).toBe('cafe-bonn-beuel');
    expect(slug('../../etc/passwd')).toBe('etc-passwd');
    expect(slug('日本')).toBe('');
  });
  test('names', () => {
    expect(configFilename({ name: 'Bonn-Beuel', lat: 50.74, lon: 7.12 })).toBe('astromap-bonn-beuel.json');
    expect(configFilename({ name: '', lat: -33.87, lon: 151.21 })).toBe('astromap--33.87_151.21.json');
    expect(windowFilename({ label: 'South Balcony' })).toBe('astromap-window-south-balcony.json');
    expect(windowFilename({ label: '???' })).toBe('astromap-window-window.json');
  });
});
