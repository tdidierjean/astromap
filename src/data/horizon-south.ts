// Measured horizon profile of the SOUTH balcony window.
//
// Derived from phone photos taken from the south balcony on 2026-10-11 and 2026-10-12.
// The photos were plate-solved (star field -> exact camera orientation), then the tops of the
// obstructions were traced and converted to (azimuth, altitude). Accuracy is about +-1-2 deg;
// the conifer (az 176-187) was cross-checked between two photos to ~1 deg.
//
//  - East limit: a building wall at az ~91 deg (everything further east is blocked, full height).
//    Between az 91 and 97 a lower red building blocks up to altitude 24 deg.
//  - West limit: the balcony wall at az ~236 deg (vertical, full height). No overhang.
//  - Az 147-190 (house roof, deciduous tree #3, birch, conifer) is measured from the 2026-10-12 photos.
//  - Deciduous trees ('tree') block only when in leaf; `bare` is the altitude of the roofline
//    behind them (used when the trees are bare).
//
// Each point's `kind` describes the segment that STARTS at that point (up to the next point).

import type { HorizonProfile, ProfilePoint } from '../config';

const b = (az: number, alt: number): ProfilePoint => ({ az, alt, kind: 'building' });
const tree = (bare: number) => (az: number, alt: number): ProfilePoint => ({ az, alt, kind: 'tree', bare });
const con = (az: number, alt: number): ProfilePoint => ({ az, alt, kind: 'conifer' });

const t1 = tree(5);  // deciduous tree #1 (roofs behind it ~4.5-5 deg)
const t2 = tree(4);  // deciduous tree #2 (roofs behind it ~3-6 deg)
const t3 = tree(6.0);   // deciduous tree #3 (roof behind it ~6 deg)
const birch = tree(6.4); // deciduous birch (roof behind it ~6.4 deg)

export const HORIZON_SOUTH: HorizonProfile = {
  azMin: 91,
  azMax: 236,
  source: 'measured from photos',
  points: [
    b(91, 24), b(97, 24),
    t1(99, 16), t1(104, 18.3), t1(108, 20.6), t1(116, 18.7), t1(119, 17.5), t1(123, 13), tree(4.5)(125.5, 4.5),
    b(127, 4.6), b(137, 10.4), b(142, 9.7), b(147, 7.6),
    b(149.5, 6.0), b(157, 6.0),
    t3(157.5, 11.3), t3(158.9, 14.7), t3(161.7, 16.9), t3(163.6, 17.9), t3(166.5, 16.4), t3(168.9, 13.4), t3(169.7, 9.9),
    birch(170.8, 11.8), birch(172.7, 13.8), birch(174.2, 14.1), birch(175.7, 13.8),
    con(176.7, 16.5), con(178.3, 18.7), con(180.6, 17.4), con(182.8, 14.3), con(184.1, 11.8), con(184.9, 7.3), con(186.9, 5.4),
    b(190, 3), b(197, 3.8), b(201, 2.8), b(203, 6.2),
    t2(205, 15), t2(210, 23.5), t2(215, 23.6), t2(223.5, 22.9), t2(229, 21.3), t2(233.5, 19), t2(236, 22),
  ],
};
