import type { PlannedExercise } from "./types";
import {
  equipmentClassFor,
  LOAD_CONFIG,
  plateBreakdown,
  reachableTotals,
  STEP_OVERRIDES,
  type EquipmentClass,
} from "./equipment";

/** Load-stepper configuration for one exercise, derived from its equipment
 * class (see equipment.ts for the name map and per-class config).
 *
 *   step          — +/- delta in lb of total load (0 for bodyweight)
 *   isBodyweight  — no load stepper at all; reps only
 *   showPlateMath — smith / barbell: show the per-side plate load
 */
export interface WeightStep {
  cls: EquipmentClass;
  step: number;
  isBodyweight: boolean;
  min: number;
  max: number;
  showPlateMath: boolean;
  barLbs: number;
  /** Plate-loaded classes: the only totals the stepper may offer. */
  values: number[] | null;
}

export function weightStepFor(
  ex: Pick<PlannedExercise, "name" | "format" | "equipment_class">,
): WeightStep {
  const cls = equipmentClassFor(ex);
  if (cls === "bodyweight") {
    return { cls, step: 0, isBodyweight: true, min: 0, max: 0, showPlateMath: false, barLbs: 0, values: null };
  }
  const cfg = LOAD_CONFIG[cls];
  const override =
    cls === "machine" || cls === "cable"
      ? STEP_OVERRIDES[(ex.name ?? "").toLowerCase().trim()]
      : undefined;
  return {
    cls,
    step: override ?? cfg.step,
    isBodyweight: false,
    min: cfg.min,
    max: cfg.max,
    showPlateMath: cls === "smith" || cls === "barbell",
    barLbs: cfg.barLbs ?? 0,
    values: cls === "smith" || cls === "barbell" ? reachableTotals(cfg.barLbs ?? 0) : null,
  };
}

/** "65 lb/side: 35 + 25 + 5" — the actual plates per side, largest first. */
export function plateLabel(totalLbs: number, barLbs: number): string {
  const side = platesPerSide(totalLbs, barLbs);
  if (side == null) return "below bar weight";
  if (side === 0) return "bar only";
  const plates = plateBreakdown(side);
  const s = Number.isInteger(side) ? String(side) : side.toFixed(1);
  return plates ? `${s} lb/side: ${plates.join(" + ")}` : `${s} lb/side — not loadable with these plates`;
}

/** Plate load per side for a total bar load, or null when below the bar. */
export function platesPerSide(totalLbs: number, barLbs: number): number | null {
  const side = (totalLbs - barLbs) / 2;
  return side >= 0 ? Math.round(side * 100) / 100 : null;
}
