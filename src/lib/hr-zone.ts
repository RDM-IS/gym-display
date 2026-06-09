// HR-zone classifier — single source of truth for the gym-display.
//
// SINGLE OVERRIDABLE CONSTANT: MAX_HR_BPM below. Every zone in every
// view (Status today panel, 7-day strip, anything else that classifies
// bpm) derives from this one constant. When you do a real max-HR test
// or want to use a measured lactate-threshold figure, change this one
// number — no other file needs to be touched.
//
// Default: 172 bpm (age-based fallback, 220 − 48). Override here to
// recalibrate everything in one shot. Eventually this should be stored
// per-user on health.daily_state (or similar) and read via /api; until
// then the constant IS the configuration.
//
// Bands are %max-HR, NOT %HRR / %LT. They do not adjust for body
// weight or fitness — max HR is age/genetics-bound, and keeping the
// zone boundaries fixed is what makes aerobic improvement visible
// over time as the same perceived effort drifts down into lower zones.

export const MAX_HR_BPM = 172;

export const ZONE_BANDS: Record<1 | 2 | 3 | 4 | 5, readonly [number, number]> = {
  1: [0.50, 0.60],  // recovery
  2: [0.60, 0.70],  // aerobic base
  3: [0.70, 0.80],  // tempo
  4: [0.80, 0.90],  // threshold
  5: [0.90, 1.00],  // VO2max / max effort
};

/** Returns the zone (1-5) for a given bpm. Returns 0 below Z1 (and for
 * zero/negative bpm). Anything above Z5 still classifies as 5. */
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

/** Inclusive bpm range for a target zone (1-5), based on MAX_HR_BPM. */
export function zoneRangeBpm(zone: number): [number, number] | null {
  const band = ZONE_BANDS[zone as 1 | 2 | 3 | 4 | 5];
  if (!band) return null;
  return [Math.round(band[0] * MAX_HR_BPM), Math.round(band[1] * MAX_HR_BPM)];
}

/** Renders a logged bpm as "{N} bpm = Zone {Z}" — the per-spec label. */
export function zoneLabel(bpm: number): string {
  const z = classifyHrZone(bpm);
  if (z === 0) return `${Math.round(bpm)} bpm = below Z1`;
  return `${Math.round(bpm)} bpm = Zone ${z}`;
}

/** Renders a target zone as "Zone {Z} ({lo}–{hi} bpm)". */
export function targetZoneLabel(zone: number): string | null {
  const range = zoneRangeBpm(zone);
  if (!range) return null;
  return `Zone ${zone} (${range[0]}–${range[1]} bpm)`;
}

/** Compare actual bpm to the target zone — zone delta + bpm + range. */
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

/** ↑ if actual > target, ↓ if actual < target, ≈ if equal. */
export function zoneArrow(actualZone: number, targetZone: number): "↑" | "↓" | "≈" {
  if (actualZone > targetZone) return "↑";
  if (actualZone < targetZone) return "↓";
  return "≈";
}
