import type { LoadConfigByClass, PlannedExercise } from "./types";
import {
  equipmentClassFor,
  LOAD_CONFIG,
  NO_LOAD_CLASSES,
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
  /** LOCATION-1: "none" = no load stepper at all (bodyweight, bands, trx,
   * cardio). `isBodyweight` is kept as the derived flag the screens read. */
  loadMode: "numeric" | "none";
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
  /** LOCATION-1: the row's own `blocks.load_config`. Omitted → the office,
   * which is what every row seeded before LOCATION-1 means. */
  config?: LoadConfigByClass | null,
): WeightStep {
  const cls = equipmentClassFor(ex);
  const fromRow = config?.[cls];
  const none = { cls, step: 0, loadMode: "none" as const, isBodyweight: true, min: 0, max: 0,
                 showPlateMath: false, barLbs: 0, values: null };
  if (fromRow?.mode === "none" || NO_LOAD_CLASSES.includes(cls)) return none;
  // A class the row's gym doesn't have at all: nothing to load it with.
  if (config && !fromRow) return none;

  const cfg = fromRow ?? LOAD_CONFIG[cls];
  if (!cfg) return none;
  const plates = ("plates" in cfg && cfg.plates?.length) ? cfg.plates : undefined;
  const bar = ("bar" in cfg ? cfg.bar : undefined) ?? ("barLbs" in cfg ? cfg.barLbs : undefined) ?? 0;
  const plateMath = plates !== undefined || cls === "smith" || cls === "barbell";
  const override =
    cls === "machine" || cls === "cable"
      ? STEP_OVERRIDES[(ex.name ?? "").toLowerCase().trim()]
      : undefined;
  return {
    cls,
    step: override ?? cfg.step,
    loadMode: "numeric",
    isBodyweight: false,
    min: cfg.min,
    max: cfg.max,
    showPlateMath: plateMath,
    barLbs: bar,
    values: plateMath ? reachableTotals(bar, plates) : null,
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
