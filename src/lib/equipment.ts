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
export const PLATES_PER_SIDE: readonly number[] = [45, 35, 25, 10, 5];
const MAX_PER_SIDE = PLATES_PER_SIDE.reduce((a, b) => a + b, 0);

/** Olympic bar. TODO(office): confirm it is 45 lb. */
export const OLYMPIC_BAR_LBS = 45;
/** TODO(office): Icarian Smith starting (effective) bar weight — it may be
 * counterbalanced. Until measured, loads are plates only (0). */
export const SMITH_BAR_LBS = 0;

/** The OFFICE's loading rules — the fallback for a row that carries none,
 * which is every row seeded before LOCATION-1. A row's own `load_config`
 * wins; see weightStepFor. */
export const LOAD_CONFIG: Record<string, LoadConfig> = {
  // Hex dumbbell rack: 5–45 lb in 5s.
  dumbbell: { step: 5, min: 5, max: 45 },
  // TODO(office): confirm the pin-stack increment on each Precor machine;
  // override per exercise in STEP_OVERRIDES once measured. 10 lb default.
  machine: { step: 10, min: 0, max: 300 },
  // S3.23 functional trainer — same stack step as the machines until confirmed.
  cable: { step: 10, min: 0, max: 200 },
  // Plate-loaded: 10 lb total per step (5 per side); the stepper only offers
  // reachable totals (see reachableTotals).
  smith: { step: 10, min: SMITH_BAR_LBS, max: SMITH_BAR_LBS + 2 * MAX_PER_SIDE, barLbs: SMITH_BAR_LBS },
  barbell: { step: 10, min: OLYMPIC_BAR_LBS, max: OLYMPIC_BAR_LBS + 2 * MAX_PER_SIDE, barLbs: OLYMPIC_BAR_LBS },
};

/** Every per-side load the plates can make, ascending (0 = empty bar). */
export function reachablePerSide(plates: readonly number[] = PLATES_PER_SIDE): number[] {
  const sums = new Set<number>([0]);
  for (const p of plates) {
    for (const s of [...sums]) sums.add(s + p);
  }
  return [...sums].sort((a, b) => a - b);
}

/** Every loadable total for a bar, ascending. */
export function reachableTotals(barLbs: number, plates: readonly number[] = PLATES_PER_SIDE): number[] {
  return reachablePerSide(plates).map((s) => barLbs + 2 * s);
}

/** The plates for one side, largest first — fewest plates, then the largest
 * plates first when two combinations tie (40 → 35 + 5). null when the load
 * can't be made. */
export function plateBreakdown(perSide: number, plates: readonly number[] = PLATES_PER_SIDE): number[] | null {
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

/** Per-exercise stack-step overrides (lb) for machine / cable exercises,
 * keyed by lower-case exercise name. */
export const STEP_OVERRIDES: Record<string, number> = {};

/** Exact names the keyword rules would misclassify. */
const EXACT: Record<string, EquipmentClass> = {
  // Runs on the Pulldown/Seated Row machine despite "cable" in the name.
  "seated cable row": "machine",
};

/** Ordered keyword rules — first match wins. */
const RULES: ReadonlyArray<readonly [EquipmentClass, readonly string[]]> = [
  ["smith", ["smith"]],
  ["bodyweight", [
    "captain's chair", "captains chair", "plank", "push-up",
    "pushup", "dead bug", "bird dog", "hollow", "mountain climber", "glute bridge",
  ]],
  ["cable", ["cable", "rope", "pallof", "face pull"]],
  ["dumbbell", ["db ", "dumbbell", "goblet"]],
  ["barbell", ["barbell", "back squat", "front squat"]],
  ["machine", [
    "leg press", "pulldown", "row", "leg curl", "leg extension", "pec fly",
    "rear delt", "calf press", "ab crunch", "ab machine", "back extension",
  ]],
];

/** Infer a class from the exercise name, or null when nothing matches. */
export function inferEquipmentClass(name: string): EquipmentClass | null {
  const n = (name ?? "").toLowerCase().trim();
  if (EXACT[n]) return EXACT[n];
  for (const [cls, keywords] of RULES) {
    if (keywords.some((k) => n.includes(k))) return cls;
  }
  return null;
}

/** blocks.exercises[].equipment_class wins.
 *
 * EXERCISE-CLASS (Ryan, 2026-09-23): every exercise seeded from 2026-09-23 on
 * carries its class, so the name rules below are a FALLBACK for older rows
 * only. They were written for the office and misread anything else — "TRX row"
 * and "Band pulldown" both read as `machine`, which would offer a 10 lb stack
 * step for a strap and a rubber band. A class the client doesn't know (a newer
 * one than this build) falls back the same way rather than throwing. */
export function equipmentClassFor(
  ex: Pick<PlannedExercise, "name" | "format" | "equipment_class">,
): EquipmentClass {
  if (ex.equipment_class && EQUIPMENT_CLASSES.includes(ex.equipment_class)) {
    return ex.equipment_class;
  }
  if (ex.format === "duration") return "bodyweight";
  return inferEquipmentClass(ex.name) ?? "dumbbell";
}
