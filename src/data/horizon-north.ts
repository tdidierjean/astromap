// Measured horizon profile of the NORTH balcony window.
//
// Derived from plate-solved phone photos taken from the north balcony on 2026-10-12
// (star field -> exact camera orientation; tops of the obstructions traced and converted to
// azimuth / altitude). Accuracy is about +-1-2 deg.
//
// The window runs clockwise from azMin = 300 through north (0/360) to azMax = 84, i.e. it CROSSES
// the 360 -> 0 seam. All code measures azimuth from azMin, so points are listed west -> east
// with azimuths wrapping from 355.8 to 1.1.
//
//  - West limit: az 300, beyond the edge of the photos (not directly measured). The stretch
//    300-309 deg is assumed at 10 deg altitude (kind 'estimated').
//  - East limit: az 84, the wall / eave of the user's own building. Its edge LEANS outwards with
//    height (az 83.5 at alt 22, 84.5 at 27, 88.5 at 41, 99 at 64); it is modelled as a vertical wall
//    at 84, which is conservative (hides a little sky) low down, where it matters most.
//  - Az 19-31 is NOT covered by the photos: assumed (kind 'estimated') between the neighbouring roofs.
//  - Deciduous trees ('tree') block only when in leaf; `bare` is the altitude of the roofline
//    or branch level seen when they are bare.
//
// Each point's `kind` describes the segment that STARTS at that point (up to the next point).

import type { HorizonProfile, ProfilePoint } from '../config';

const b = (az: number, alt: number): ProfilePoint => ({ az, alt, kind: 'building' });
const tree = (bare: number) => (az: number, alt: number): ProfilePoint => ({ az, alt, kind: 'tree', bare });
const con = (az: number, alt: number): ProfilePoint => ({ az, alt, kind: 'conifer' });
const est = (az: number, alt: number): ProfilePoint => ({ az, alt, kind: 'estimated' });

const birch = tree(4);  // deciduous birch + trees, roofline behind ~4 deg
const t2 = tree(3);     // deciduous trees, roofline behind ~3 deg

export const HORIZON_NORTH: HorizonProfile = {
  azMin: 300,
  azMax: 84,
  source: 'measured from photos',
  points: [
    est(300, 10), est(309, 10),
    b(309, 9.9), b(312, 9.9), b(314.4, 8.9), b(317.9, 9.0),
    con(319.4, 12.1), con(321, 15.7), con(322.2, 18.0), con(324, 15.4),
    birch(325, 14.8), birch(327.7, 16.7), birch(332, 14.5), birch(334.4, 11.6), birch(334.5, 8.2), birch(335.9, 6.2), birch(337.2, 4.8),
    b(339.2, 2.8), b(344.8, 2.5),
    t2(346.6, 3.9), t2(350, 7.3), t2(353.9, 7.8), t2(355.1, 6.1),
    b(355.8, 2.7), b(1.1, 2.7), b(4.9, 3.7), b(9.6, 5.1), b(14.3, 8.0),
    b(17.7, 9.1), b(19.2, 9.7),
    est(19.2, 9.7), est(30.8, 12.8),
    b(30.8, 12.8), b(36.5, 14.9), b(37.7, 16.1), b(41.3, 16.0), b(45.7, 17.6), b(55.7, 17.2), b(59.3, 20.0),
    b(68.3, 18.7), b(71.8, 19.8), b(78.5, 19.4), b(81.9, 19.1), b(84, 19.1),
  ],
};
