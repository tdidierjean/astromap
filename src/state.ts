// Shared mutable app state (night navigation).
export const MIN_OFFSET = -7;
export const MAX_OFFSET = 14;

export const state = {
  /** Night browser offset in days (0 = tonight). */
  offsetDays: 0,
};
