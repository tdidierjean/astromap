// Demo preset: the author's Bonn-Beuel balcony with its two measured horizon profiles.
// Used by demo mode (in memory only) and as the source of the built-in profiles for legacy configs.
import type { Config } from './config';
import { HORIZON_SOUTH } from './data/horizon-south';
import { HORIZON_NORTH } from './data/horizon-north';

/** Everything of a Config except `version` and `tz`: the schema version belongs to config.ts and the demo zone
 *  is fixed (Europe/Berlin) in DEMO_TZ, while legacy configs without a zone keep using the device's. */
export type DemoPreset = Omit<Config, 'version' | 'tz'>;

export const DEMO_TZ = 'Europe/Berlin';

export const DEMO_CONFIG: DemoPreset = {
  name: 'Bonn-Beuel',
  lat: 50.74,
  lon: 7.12,
  elev: 60,
  clock: 'auto',
  windows: [
    { id: 'north', label: 'North', azCenter: 12, halfWidth: 72, profile: HORIZON_NORTH },
    { id: 'south', label: 'South', azCenter: 163.5, halfWidth: 72.5, profile: HORIZON_SOUTH },
  ],
  minAlt: 10,
  limitMag: 4.0,
  showGrid: false,
  leaf: 'auto',
};
