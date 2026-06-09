// HR-zone classifier for the Status page.
//
// IMPORTANT: HR-zone bpm thresholds are NOT stored in the DB (only the
// integer `target_hr_zone` 1-5 is on health.plan). This module is the
// single client-side source of truth — when the user gives us a real
// max HR or lactate-threshold figures, edit MAX_HR_BPM (and optionally
// ZONE_BANDS) in ONE place.
//
// Defaults below assume an estimated max HR of 175 bpm and standard
// %max-HR zones (Z1 50-60, Z2 60-70, Z3 70-80, Z4 80-90, Z5 90-105).
// Verify by eye until thresholds land in the DB.

export const MAX_HR_BPM = 175;

export const ZONE_BANDS: Record<1 | 2 | 3 | 4 | 5, readonly [number, number]> = {
  1: [0.50, 0.60],
  2: [0.60, 0.70],
  3: [0.70, 0.80],
  4: [0.80, 0.90],
  5: [0.90, 1.05],
};

/** Returns the zone (1-5) for a given bpm. Returns 0 below Z1, 5 above Z5. */
export function classifyHrZone(bpm: number): 0 | 1 | 2 | 3 | 4 | 5 {
  if (bpm <= 0) return 0;
  const pct = bpm / MAX_HR_BPM;
  if (pct < ZONE_BANDS[1][0]) return 0;
  if (pct < ZONE_BANDS[2][0]) return 1;
  if (pct < ZONE_BANDS[3][0]) return 2;
  if (pct < ZONE_BANDS[4][0]) return 3;
  if (pct < ZONE_BANDS[5][0]) return 4;
  return 5;
}

/** Inclusive bpm range for a zone. */
export function zoneRangeBpm(zone: number): [number, number] | null {
  const band = ZONE_BANDS[zone as 1 | 2 | 3 | 4 | 5];
  if (!band) return null;
  return [Math.round(band[0] * MAX_HR_BPM), Math.round(band[1] * MAX_HR_BPM)];
}

/** Compare actual bpm to the target zone. Returns:
 *   { actualZone, targetZone, delta } where delta is the zone diff
 *   (positive = above target, negative = below). */
export interface ZoneCompare {
  actualZone: number;
  targetZone: number;
  delta: number;
  actualBpm: number;
  targetRangeBpm: [number, number] | null;
}

export function compareToTargetZone(actualBpm: number, targetZone: number): ZoneCompare {
  const actualZone = classifyHrZone(actualBpm);
  return {
    actualZone,
    targetZone,
    delta: actualZone - targetZone,
    actualBpm,
    targetRangeBpm: zoneRangeBpm(targetZone),
  };
}
