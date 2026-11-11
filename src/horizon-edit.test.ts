import { test, expect, describe } from 'bun:test';
import type { HorizonProfile, ViewWindow } from './config';
import { DEMO_CONFIG } from './demo';
import { profileAlt, profileKind, profileSpan } from './horizon';
import { sanitizeWindow, parseTransfer, serializeWindow } from './transfer';
import {
  seedProfile, facingOf, insertPoint, movePoint, deletePoint, setKind, setBare, shiftWall, outline, autoAltMax, relsOf, snap, sourceAfterEdit,
} from './horizon-edit';

const flat = (azMin: number, azMax: number, alt = 10): HorizonProfile => ({
  azMin, azMax, source: 'drawn',
  points: [{ az: azMin, alt, kind: 'estimated' }, { az: azMax, alt, kind: 'estimated' }],
});
const win = (profile: HorizonProfile): ViewWindow => ({ id: 'w1', label: 'Test', azCenter: 0, halfWidth: 45, profile });
const valid = (p: HorizonProfile) => {
  const r = sanitizeWindow(win(p));
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.window.profile).toEqual(p);   // sanitising neither reorders nor alters it
};
const azs = (p: HorizonProfile) => p.points.map(pt => pt.az);

describe('seedProfile', () => {
  test('flat at minAlt across the window range, estimated', () => {
    const p = seedProfile({ azCenter: 180, halfWidth: 45 }, 10);
    expect(p).toMatchObject({ azMin: 135, azMax: 225, source: 'drawn' });
    expect(p.points).toEqual([{ az: 135, alt: 10, kind: 'estimated' }, { az: 225, alt: 10, kind: 'estimated' }]);
    expect(profileAlt(p, 180, true)).toBe(10);
    valid(p);
  });
  test('across north', () => {
    const p = seedProfile({ azCenter: 350, halfWidth: 50 }, 5);
    expect(p).toMatchObject({ azMin: 300, azMax: 40 });
    expect(profileSpan(p)).toBe(100);
    valid(p);
  });
  test('fractional centre rounds to whole walls, tiny width keeps a span', () => {
    const p = seedProfile({ azCenter: 163.5, halfWidth: 72.5 }, 10);
    expect(Number.isInteger(p.azMin) && Number.isInteger(p.azMax)).toBe(true);
    expect(profileSpan(seedProfile({ azCenter: 10, halfWidth: 0.2 }, 10))).toBeGreaterThanOrEqual(2);
  });
  test('facingOf matches the range', () => {
    expect(facingOf(flat(300, 40))).toEqual({ azCenter: 350, halfWidth: 50 });
    expect(facingOf(flat(135, 225))).toEqual({ azCenter: 180, halfWidth: 45 });
  });
});

describe('insertPoint', () => {
  test('keeps the order and splits a segment keeping its kind', () => {
    let p = flat(135, 225);
    ({ profile: p } = insertPoint(p, 60, 20));       // az 195
    const r = insertPoint(p, 30, 8);                 // az 165, goes between the walls' points
    expect(azs(r.profile)).toEqual([135, 165, 195, 225]);
    expect(r.index).toBe(1);
    expect(r.profile.points[1]).toEqual({ az: 165, alt: 8, kind: 'estimated' });
    valid(r.profile);
  });
  test('snaps to whole degrees and clamps to the walls and altitude range', () => {
    const p = flat(135, 225);
    expect(insertPoint(p, 30.4, 7.6).profile.points[1]).toMatchObject({ az: 165, alt: 8 });
    expect(azs(insertPoint(p, -20, 5).profile)).toEqual([135, 135, 225]);
    expect(azs(insertPoint(p, 500, 5).profile)).toEqual([135, 225, 225]);
    expect(insertPoint(p, 10, 200).profile.points[1].alt).toBe(89);
    expect(insertPoint(p, 10, -4).profile.points[1].alt).toBe(0);
  });
  test('a tree segment gives the new point a bare roofline', () => {
    let p = flat(135, 225);
    p = setKind(p, 0, 'tree');                        // bare 5 (half of 10), the next point is not a tree: its roofline is its height
    const q = insertPoint(p, 40, 20).profile.points[1];
    expect(q).toMatchObject({ az: 175, alt: 20, kind: 'tree', bare: 7 });   // 5 + (10 - 5) * 40 / 90
  });
  test('across north', () => {
    const p = flat(300, 40);
    const r = insertPoint(p, 80, 12);                 // 300 + 80 = 20
    expect(azs(r.profile)).toEqual([300, 20, 40]);
    const r2 = insertPoint(r.profile, 30, 12);        // 330
    expect(azs(r2.profile)).toEqual([300, 330, 20, 40]);
    expect(r2.index).toBe(1);
    valid(r2.profile);
  });
  test('does not mutate its input', () => {
    const p = flat(135, 225), copy = structuredClone(p);
    insertPoint(p, 40, 20);
    expect(p).toEqual(copy);
  });
});

describe('movePoint', () => {
  const three = (): HorizonProfile => {
    let p = flat(135, 225);
    p = insertPoint(p, 40, 20).profile;   // 175
    p = insertPoint(p, 60, 30).profile;   // 195
    return p;                              // 135, 175, 195, 225
  };
  test('moves in whole degrees', () => {
    const p = movePoint(three(), 1, 45.4, 22.6);
    expect(p.points[1]).toMatchObject({ az: 180, alt: 23 });
  });
  test('stays between its neighbours', () => {
    const p = three();
    expect(movePoint(p, 1, 90, 20).points[1].az).toBe(195);      // up to the next point (a vertical step is allowed)
    expect(movePoint(p, 1, 0, 20).points[1].az).toBe(135);
    expect(movePoint(p, 2, 10, 20).points[2].az).toBe(175);
    expect(azs(movePoint(p, 1, 90, 20))).toEqual([135, 195, 195, 225]);
  });
  test('end points stay inside the walls', () => {
    const p = three();
    expect(movePoint(p, 0, -30, 5).points[0].az).toBe(135);
    expect(movePoint(p, 3, 400, 5).points[3].az).toBe(225);
    expect(movePoint(p, 0, 200, 5).points[0].az).toBe(135 + 40);  // not past its neighbour
  });
  test('altitude clamps to 0..89', () => {
    expect(movePoint(three(), 1, 40, 150).points[1].alt).toBe(89);
    expect(movePoint(three(), 1, 40, -3).points[1].alt).toBe(0);
  });
  test('wraparound across north: offsets, not azimuths, are ordered', () => {
    let p = flat(300, 40);
    p = insertPoint(p, 30, 10).profile;   // 330
    p = insertPoint(p, 70, 10).profile;   // 10
    expect(azs(p)).toEqual([300, 330, 10, 40]);
    const m = movePoint(p, 1, 55, 14);    // 355
    expect(azs(m)).toEqual([300, 355, 10, 40]);
    expect(movePoint(p, 1, 90, 14).points[1].az).toBe(10);       // cannot pass the point at 10
    expect(movePoint(p, 2, 20, 14).points[2].az).toBe(330);      // cannot go back past the point at 330
    expect(movePoint(p, 3, 150, 14).points[3].az).toBe(40);      // wall at 40
    valid(m);
  });
  test('bare never exceeds the new altitude', () => {
    let p = setKind(flat(135, 225, 20), 0, 'tree');
    p = setBare(p, 0, 15);
    expect(movePoint(p, 0, 0, 10).points[0].bare).toBe(10);
  });
  test('does not mutate its input', () => {
    const p = three(), copy = structuredClone(p);
    movePoint(p, 1, 45, 3);
    expect(p).toEqual(copy);
  });
});

describe('deletePoint', () => {
  test('removes and keeps the order', () => {
    let p = flat(135, 225);
    p = insertPoint(p, 30, 5).profile; p = insertPoint(p, 60, 5).profile;
    const q = deletePoint(p, 1);
    expect(azs(q)).toEqual([135, 195, 225]);
    valid(q);
  });
  test('the last remaining point cannot be deleted', () => {
    let p = flat(135, 225);
    p = deletePoint(p, 0);
    expect(p.points).toHaveLength(1);
    expect(deletePoint(p, 0)).toBe(p);
    valid(p);
  });
});

describe('kinds and bare', () => {
  test('kind applies to the segment starting at the point', () => {
    let p = flat(135, 225);
    p = insertPoint(p, 45, 10).profile;                 // 180
    p = setKind(p, 1, 'building');
    expect(profileKind(p, 150)).toBe('estimated');
    expect(profileKind(p, 200)).toBe('building');
  });
  test('tree gets a default bare roofline; leaving tree drops it', () => {
    let p = flat(135, 225, 20);
    p = setKind(p, 0, 'tree');
    expect(p.points[0]).toEqual({ az: 135, alt: 20, kind: 'tree', bare: 10 });
    expect(profileAlt(p, 135, false)).toBe(10);
    p = setKind(p, 0, 'conifer');
    expect(p.points[0]).toEqual({ az: 135, alt: 20, kind: 'conifer' });
    valid(p);
  });
  test('setBare: whole degrees, 0..alt, tree points only', () => {
    let p = setKind(flat(135, 225, 20), 0, 'tree');
    expect(setBare(p, 0, 7.4).points[0].bare).toBe(7);
    expect(setBare(p, 0, 99).points[0].bare).toBe(20);
    expect(setBare(p, 0, -5).points[0].bare).toBe(0);
    expect(setBare(p, 1, 5)).toBe(p);                    // point 1 is not a tree
  });
});

describe('shiftWall', () => {
  const shaped = (): HorizonProfile => {
    let p = flat(135, 225);
    p = insertPoint(p, 20, 30).profile;   // 155 alt 30
    p = insertPoint(p, 60, 15).profile;   // 195 alt 15
    return p;
  };
  test('outwards: the old shape stays, a point continues the edge flat', () => {
    const p = shiftWall(shaped(), 'min', -10);
    expect(p.azMin).toBe(125);
    expect(azs(p)).toEqual([125, 135, 155, 195, 225]);
    expect(p.points[0]).toEqual({ az: 125, alt: 10, kind: 'estimated' });
    const q = shiftWall(shaped(), 'max', 10);
    expect(q.azMax).toBe(235);
    expect(azs(q)).toEqual([135, 155, 195, 225, 235]);
    for (const az of [140, 160, 200]) expect(profileAlt(q, az, true)).toBe(profileAlt(shaped(), az, true));
    valid(p); valid(q);
  });
  test('inwards: points past the wall go, the shape at the wall is kept', () => {
    const before = shaped();
    const p = shiftWall(before, 'min', 30);                 // 165, past the point at 155
    expect(p.azMin).toBe(165);
    expect(azs(p)).toEqual([165, 195, 225]);
    expect(p.points[0].alt).toBe(profileAlt(before, 165, true));
    for (const az of [170, 190, 210]) expect(profileAlt(p, az, true)).toBeCloseTo(profileAlt(before, az, true), 5);
    const q = shiftWall(before, 'max', -40);                 // 185
    expect(q.azMax).toBe(185);
    expect(azs(q)).toEqual([135, 155, 185]);
    expect(q.points[2].alt).toBe(profileAlt(before, 185, true));
    valid(p); valid(q);
  });
  test('a point exactly on the new wall is reused', () => {
    const p = shiftWall(shaped(), 'min', 20);
    expect(azs(p)).toEqual([155, 195, 225]);
  });
  test('snaps to whole degrees, keeps at least 2 degrees and at most 359', () => {
    expect(shiftWall(shaped(), 'min', 5.4).azMin).toBe(140);
    expect(profileSpan(shiftWall(shaped(), 'min', 500))).toBe(2);
    expect(profileSpan(shiftWall(shaped(), 'max', -500))).toBe(2);
    expect(profileSpan(shiftWall(shaped(), 'max', 500))).toBe(359);
    expect(shiftWall(shaped(), 'min', 0.2)).toEqual(shaped());
  });
  test('across north (300 -> 40)', () => {
    let p = flat(300, 40);
    p = insertPoint(p, 50, 25).profile;                       // 350
    const w = shiftWall(p, 'min', -20);                       // 280
    expect(w.azMin).toBe(280);
    expect(profileSpan(w)).toBe(120);
    expect(azs(w)).toEqual([280, 300, 350, 40]);
    const e = shiftWall(p, 'max', 15);                        // 55
    expect(e).toMatchObject({ azMin: 300, azMax: 55 });
    expect(azs(e)).toEqual([300, 350, 40, 55]);
    const i = shiftWall(p, 'min', 70);                        // 10: past the point at 350
    expect(i).toMatchObject({ azMin: 10, azMax: 40 });
    expect(azs(i)).toEqual([10, 40]);
    expect(i.points[0].alt).toBeCloseTo(profileAlt(p, 10, true), 5);
    const j = shiftWall(p, 'max', -50);                       // 350
    expect(j).toMatchObject({ azMin: 300, azMax: 350 });
    expect(azs(j)).toEqual([300, 350]);
    for (const x of [w, e, i, j]) valid(x);
  });
  test('wall dragged through north, either direction', () => {
    const p = flat(350, 100);
    const a = shiftWall(p, 'min', 20);                        // 10
    expect(a.azMin).toBe(10);
    const b = shiftWall(p, 'min', -30);                       // 320
    expect(b.azMin).toBe(320);
    const c = shiftWall(flat(200, 350), 'max', 30);           // 20
    expect(c.azMax).toBe(20);
    expect(profileSpan(c)).toBe(180);
    for (const x of [a, b, c]) valid(x);
  });
  test('a tree edge keeps its bare roofline', () => {
    let p = flat(135, 225, 20);
    p = setBare(setKind(p, 0, 'tree'), 0, 4);
    p = setBare(setKind(p, 1, 'tree'), 1, 8);
    const q = shiftWall(p, 'min', 45);                         // halfway: bare 6
    expect(q.points[0]).toMatchObject({ az: 180, kind: 'tree', bare: 6 });
    valid(q);
  });
  test('does not mutate its input', () => {
    const p = shaped(), copy = structuredClone(p);
    shiftWall(p, 'min', 30); shiftWall(p, 'max', -30);
    expect(p).toEqual(copy);
  });
});

describe('sourceAfterEdit', () => {
  test('labels', () => {
    expect(sourceAfterEdit(undefined)).toBe('drawn');
    expect(sourceAfterEdit('drawn')).toBe('drawn');
    expect(sourceAfterEdit('measured from photos')).toBe('measured from photos, edited');
    expect(sourceAfterEdit('measured from photos, edited')).toBe('measured from photos, edited');
    expect(sourceAfterEdit('x'.repeat(200)).length).toBe(120);
  });
});

describe('outline and axis', () => {
  test('flat extensions to both walls where the end points are inside', () => {
    const p: HorizonProfile = { azMin: 100, azMax: 200, source: 'drawn', points: [{ az: 120, alt: 5, kind: 'building' }, { az: 180, alt: 9, kind: 'tree', bare: 3 }] };
    const o = outline(p);
    expect(o.map(v => [v.rel, v.alt, v.point])).toEqual([[0, 5, -1], [20, 5, 0], [80, 9, 1], [100, 9, -1]]);
    expect(o[2].bare).toBe(3);
    expect(relsOf(p)).toEqual([20, 80]);
  });
  test('autoAltMax', () => {
    expect(autoAltMax(flat(0, 90, 5))).toBe(40);
    expect(autoAltMax(flat(0, 90, 24))).toBe(40);
    expect(autoAltMax(flat(0, 90, 30))).toBe(50);
    expect(autoAltMax(flat(0, 90, 80))).toBe(90);
  });
  test('snap', () => { expect(snap(2.5)).toBe(3); expect(snap(-0.4)).toBe(-0); });
});

describe('real and round-tripped profiles', () => {
  test('editing the measured South profile stays valid and is not altered elsewhere', () => {
    const south = structuredClone(DEMO_CONFIG.windows[1].profile!);
    let p = insertPoint(south, 60, 12).profile;
    p = movePoint(p, 5, 20, 30);
    p = setKind(p, 3, 'conifer');
    p = shiftWall(p, 'max', -10);
    p = deletePoint(p, 2);
    valid(p);
    expect(south).toEqual(DEMO_CONFIG.windows[1].profile!);
  });
  test('an edited profile round-trips through export / import', () => {
    let p = seedProfile({ azCenter: 350, halfWidth: 50 }, 10);
    p = insertPoint(p, 40, 22).profile;
    p = setKind(p, 1, 'tree');
    const w = { ...win(p), profile: { ...p, source: 'drawn' } };
    const r = parseTransfer(serializeWindow(w));
    expect(r.ok && r.kind === 'window' && r.window.profile).toEqual(w.profile);
  });
});
