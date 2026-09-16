import type { PlannedExercise } from "./types";

// ---------------------------------------------------------------------------
// Equipment classes — the ONE place an exercise maps to how its load is
// adjusted. Office gym (all Precor): selectorized machines, S3.23 functional
// trainer, Icarian Smith machine, hex dumbbells.
// ---------------------------------------------------------------------------

export type EquipmentClass =
  | "dumbbell"
  | "machine"
  | "cable"
  | "smith"
  | "barbell"
  | "bodyweight";

export const EQUIPMENT_CLASSES: readonly EquipmentClass[] = [
  "dumbbell", "machine", "cable", "smith", "barbell", "bodyweight",
];

export interface LoadConfig {
  /** Stepper increment in lb of TOTAL load. */
  step: number;
  min: number;
  max: number;
  /** Bar weight for plate math (smith / barbell). */
  barLbs?: number;
}

export const LOAD_CONFIG: Record<Exclude<EquipmentClass, "bodyweight">, LoadConfig> = {
  // Hex dumbbell rack. TODO(office): survey the actual min/max on the rack.
  dumbbell: { step: 5, min: 5, max: 100 },
  // TODO(office): confirm the pin-stack increment on each Precor machine;
  // override per exercise in STEP_OVERRIDES once measured.
  machine: { step: 10, min: 0, max: 300 },
  // S3.23 functional trainer — same stack step as the machines until confirmed.
  cable: { step: 10, min: 0, max: 200 },
  // 2.5 lb per side. TODO(office): Icarian Smith effective bar weight (it may be
  // counterbalanced); plate math uses barLbs.
  smith: { step: 5, min: 0, max: 500, barLbs: 0 },
  barbell: { step: 5, min: 45, max: 500, barLbs: 45 },
};

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
    "captain's chair", "captains chair", "back extension", "plank", "push-up",
    "pushup", "dead bug", "bird dog", "hollow", "mountain climber", "glute bridge",
  ]],
  ["cable", ["cable", "rope", "pallof", "face pull"]],
  ["dumbbell", ["db ", "dumbbell", "goblet"]],
  ["barbell", ["barbell", "back squat", "front squat"]],
  ["machine", [
    "leg press", "pulldown", "row", "leg curl", "leg extension", "pec fly",
    "rear delt", "calf press", "ab crunch", "ab machine",
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

/** blocks.exercises[].equipment_class wins; otherwise duration work is
 * bodyweight and reps work is inferred from the name (unknown → dumbbell). */
export function equipmentClassFor(
  ex: Pick<PlannedExercise, "name" | "format" | "equipment_class">,
): EquipmentClass {
  if (ex.equipment_class && EQUIPMENT_CLASSES.includes(ex.equipment_class)) {
    return ex.equipment_class;
  }
  if (ex.format === "duration") return "bodyweight";
  return inferEquipmentClass(ex.name) ?? "dumbbell";
}
