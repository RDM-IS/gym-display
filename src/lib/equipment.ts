import type { PlannedExercise } from "./types";

// ---------------------------------------------------------------------------
// Equipment classes — the ONE place an exercise maps to how its load is
// adjusted. Office gym (all Precor): selectorized machines (the seated
// Abdominal / Back Extension machine covers back extensions — there is no 45°
// back extension / roman chair), S3.23 functional trainer, Icarian Smith
// machine, hex dumbbells. TODO(office): the whole list is unverified in person.
// ---------------------------------------------------------------------------

export type EquipmentClass =
  | "dumbbell"
  | "machine"
  | "cable"
  | "smith"
  | "barbell"
  | "bodyweight"
  // LOCATION-1 (Ryan, 2026-09-23): the farm's classes. All three carry NO
  // numeric load — see NO_LOAD_CLASSES — but they are not `bodyweight`: the
  // resolver matches a TRX row to a pull and a band pulldown to a vertical
  // pull, and the box's lighter_load() returns nothing for them rather than
  // inventing a number.
  | "bands"
  | "trx"
  | "cardio";

export const EQUIPMENT_CLASSES: readonly EquipmentClass[] = [
  "dumbbell", "machine", "cable", "smith", "barbell", "bodyweight",
  "bands", "trx", "cardio",
];

/** Classes with no numeric load: no stepper, reps (or time) only. */
export const NO_LOAD_CLASSES: readonly EquipmentClass[] = [
  "bodyweight", "bands", "trx", "cardio",
];

export interface LoadConfig {
  /** Stepper increment in lb of TOTAL load. */
  step: number;
  min: number;
  max: number;
  /** Bar weight for plate math (smith / barbell). */
  barLbs?: number;
}

/** Plates available PER SIDE — one of each; there are no 2.5s. Any total is
 * bar + 2 × (a subset sum of these), so per-side 20 or 100 is impossible and
 * the most per side is 120. */
// LOCATION-1 (2026-09-25): there is NO load table here any more, and no plate
// constants. What a load looks like travels on the plan row
// (`blocks.load_config`), written by artemis from knowledge/load_config.py —
// one source, two consumers. A second copy here would drift the moment
// Richfield's PowerBlocks differ from the office's hex rack, and the drift
// would show up as a stepper offering weights the gym does not own.

export function reachablePerSide(plates: readonly number[]): number[] {
  const sums = new Set<number>([0]);
  for (const p of plates) {
    for (const s of [...sums]) sums.add(s + p);
  }
  return [...sums].sort((a, b) => a - b);
}

/** Every loadable total for a bar, ascending. */
export function reachableTotals(barLbs: number, plates: readonly number[]): number[] {
  return reachablePerSide(plates).map((s) => barLbs + 2 * s);
}

/** The plates for one side, largest first — fewest plates, then the largest
 * plates first when two combinations tie (40 → 35 + 5). null when the load
 * can't be made. */
export function plateBreakdown(perSide: number, plates: readonly number[]): number[] | null {
  const sorted = [...plates].sort((a, b) => b - a);
  let best: number[] | null = null;
  const n = sorted.length;
  for (let mask = 0; mask < 1 << n; mask++) {
    const pick = sorted.filter((_, i) => mask & (1 << i));
    if (pick.reduce((a, b) => a + b, 0) !== perSide) continue;
    if (
      best === null ||
      pick.length < best.length ||
      (pick.length === best.length && lexGreater(pick, best))
    ) {
      best = pick;
    }
  }
  return best;
}

function lexGreater(a: number[], b: number[]): boolean {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return a.length > b.length;
}

/** The exercise's class, from the ROW — or null when it carries none.
 *
 * LOCATION-1 (2026-09-25): the keyword rules are gone. They only knew the
 * office's vocabulary, so "TRX row" read as `machine`
 * and offered a 10 lb stack step for a strap and a rubber band. Every row
 * carries `equipment_class` (EXERCISE-CLASS), and one that does not is an
 * explicit unknown the UI reports — never a guess.
 *
 * A class newer than this build (`kettlebell`, say) is also null: unknown is
 * the honest answer, and the caller renders it as such rather than throwing. */
export function equipmentClassFor(
  ex: Pick<PlannedExercise, "name" | "format" | "equipment_class">,
): EquipmentClass | null {
  if (ex.equipment_class && EQUIPMENT_CLASSES.includes(ex.equipment_class)) {
    return ex.equipment_class;
  }
  return null;
}
