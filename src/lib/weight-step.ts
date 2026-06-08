import type { PlannedExercise } from "./types";

/** Weight-increment inference for stepper UI.
 *
 * The current planned-exercise schema (PlannedExercise in types.ts) does not
 * carry a weight_increment field — so we infer the step from the exercise
 * name. When the schema gains a `weight_increment` field, the only change
 * needed is replacing the function body with `return ex.weight_increment ?? infer(ex.name)`.
 *
 * Returns:
 *   step          — the +/- delta to apply when the stepper button is tapped
 *   isBodyweight  — true when the movement has no weight at all (hide the
 *                   weight stepper entirely; reps + RPE only)
 *
 * Centralized so the gym laptop's "Are you sure you want to log 0.5 lb?"
 * question only has one answer in one place.
 */

export interface WeightStep {
  step: number;
  isBodyweight: boolean;
}

const BODYWEIGHT_KEYWORDS: readonly string[] = [
  "plank",
  "hollow",
  "dead bug",
  "bird dog",
  "side plank",
  "mountain climber",
  "glute bridge",
  "push-up",
  "pushup",
  "trx row",
  "trx chest press",
  "trx press",
  "band ",
  "banded ",
  "face pull",
];

const BARBELL_KEYWORDS: readonly string[] = [
  "barbell",
  "back squat",
  "front squat",
  "bench press",
  "deadlift_bb",
];

// Dumbbell / Powerblock-family — 5 lb step.
// Keep this list short and obvious; the default of 5 already covers
// most DB movements.
const DUMBBELL_KEYWORDS: readonly string[] = [
  "db ",
  "dumbbell",
  "powerblock",
  "goblet",
];

function containsAny(s: string, list: readonly string[]): boolean {
  for (const k of list) if (s.includes(k)) return true;
  return false;
}

export function weightStepFor(ex: Pick<PlannedExercise, "name" | "format">): WeightStep {
  const name = (ex.name ?? "").toLowerCase();
  // Duration-format exercises (planks, holds, mountain climbers timed)
  // are always bodyweight.
  if (ex.format === "duration") {
    return { step: 0, isBodyweight: true };
  }
  if (containsAny(name, BODYWEIGHT_KEYWORDS)) {
    return { step: 0, isBodyweight: true };
  }
  if (containsAny(name, BARBELL_KEYWORDS)) {
    return { step: 10, isBodyweight: false };
  }
  if (containsAny(name, DUMBBELL_KEYWORDS)) {
    return { step: 5, isBodyweight: false };
  }
  // Lighter isolation / accessory default — 2.5 lb step.
  return { step: 2.5, isBodyweight: false };
}
