import type { LoadConfigByClass, PlannedExercise } from "./types";
import {
  equipmentClassFor,
  NO_LOAD_CLASSES,
  plateBreakdown,
  reachableTotals,
  type EquipmentClass,
} from "./equipment";

/** Load-stepper configuration for one exercise.
 *
 * LOCATION-1 (2026-09-25): everything here comes from the plan row — the
 * exercise's `equipment_class` and the row's `blocks.load_config`. There is no
 * compile-time table and no name map to fall back to, so a row that does not
 * say enough produces `loadMode: "unknown"` and the UI says so.
 *
 *   step          — +/- delta in lb of total load
 *   loadMode      — "numeric" | "none" (no load exists) | "unknown" (row is silent)
 *   showPlateMath — smith / barbell: show the per-side plate load
 */
export interface WeightStep {
  /** null when the row carries no class this build knows. */
  cls: EquipmentClass | null;
  step: number;
  loadMode: "numeric" | "none" | "unknown";
  isBodyweight: boolean;
  min: number;
  max: number;
  showPlateMath: boolean;
  barLbs: number;
  /** Plate-loaded classes: the only totals the stepper may offer. */
  values: number[] | null;
  /** The plates this gym actually owns, for the per-side label. */
  plates: readonly number[] | null;
}

const BLANK = {
  step: 0, isBodyweight: true, min: 0, max: 0,
  showPlateMath: false, barLbs: 0, values: null, plates: null,
};

export function weightStepFor(
  ex: Pick<PlannedExercise, "name" | "format" | "equipment_class">,
  /** The row's own `blocks.load_config`. Absent → unknown, never the office. */
  config?: LoadConfigByClass | null,
): WeightStep {
  const cls = equipmentClassFor(ex);
  // The row carries no class this build knows: say unknown, guess nothing.
  if (cls === null) return { ...BLANK, cls: null, loadMode: "unknown", isBodyweight: false };
  // Classes that never carry a numeric load. This is a real answer, not a gap.
  if (NO_LOAD_CLASSES.includes(cls)) return { ...BLANK, cls, loadMode: "none" };
  // No config on the row at all — a row seeded before LOCATION-1.
  if (!config) return { ...BLANK, cls, loadMode: "unknown", isBodyweight: false };

  const cfg = config[cls];
  // This gym has no entry for the class, i.e. it does not have that equipment.
  if (!cfg) return { ...BLANK, cls, loadMode: "unknown", isBodyweight: false };
  if (cfg.mode === "none") return { ...BLANK, cls, loadMode: "none" };

  const plates = ("plates" in cfg && cfg.plates?.length) ? cfg.plates : undefined;
  const bar: number =
    Number(("bar" in cfg ? cfg.bar : undefined) ?? ("barLbs" in cfg ? cfg.barLbs : undefined) ?? 0);
  const plateMath = plates !== undefined;
  if (!cfg.step || cfg.step <= 0) {
    return { ...BLANK, cls, loadMode: "unknown", isBodyweight: false };
  }
  return {
    cls,
    step: cfg.step,
    loadMode: "numeric",
    isBodyweight: false,
    min: cfg.min ?? 0,
    max: cfg.max ?? 0,
    showPlateMath: plateMath,
    barLbs: bar,
    values: plateMath && plates ? reachableTotals(bar, plates) : null,
    plates: plates ?? null,
  };
}

/** "65 lb/side: 35 + 25 + 5" — the actual plates per side, largest first. */
export function plateLabel(totalLbs: number, barLbs: number,
                           availablePlates: readonly number[]): string {
  const side = platesPerSide(totalLbs, barLbs);
  if (side == null) return "below bar weight";
  if (side === 0) return "bar only";
  const plates = plateBreakdown(side, availablePlates);
  const s = Number.isInteger(side) ? String(side) : side.toFixed(1);
  return plates ? `${s} lb/side: ${plates.join(" + ")}` : `${s} lb/side — not loadable with these plates`;
}

/** Plate load per side for a total bar load, or null when below the bar. */
export function platesPerSide(totalLbs: number, barLbs: number): number | null {
  const side = (totalLbs - barLbs) / 2;
  return side >= 0 ? Math.round(side * 100) / 100 : null;
}
