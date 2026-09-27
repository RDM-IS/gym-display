import { displayTitle } from "./format";
import type { LogExerciseIn, Plan } from "./types";

// CARDIO-REQUIRED (artemis HEALTH-PRIORITY #2, 2026-09-26).
//
// A cardio day used to be finishable through the session summary alone, which
// records THAT it happened and nothing about WHAT happened: 36 cardio sessions
// planned, 1 logged, 0 with a modality. On a cardio row the finish is now one
// card and one POST — the cardio block (duration required, modality from the
// row) with the session RPE riding along as `session_rpe`, which the Lambda
// writes as the summary row in the same transaction.

/** Rows whose finish must carry a cardio block. */
export function isCardioPlan(plan: Plan): boolean {
  const t = plan.blocks?.type;
  return t === "steady" || t === "intervals";
}

/** The name the cardio block is logged under — the same one LogPanel uses, so
 * `loggedCountFor` sees a block logged from either screen. */
export function cardioExerciseName(plan: Plan): string {
  return plan.blocks?.display_name ?? displayTitle(plan);
}

/** What the row says the session runs on. The client never picks (CARDIO-LOC):
 * a row without `blocks.cardio` logs a null modality rather than a guess. */
export function rowCardio(plan: Plan): { modality: string | null; device: string | null } {
  const c = plan.blocks?.type === "steady" ? plan.blocks.cardio ?? null : null;
  return { modality: c?.modality ?? null, device: c?.device ?? null };
}

export interface CardioFinishInput {
  duration_min: number | null;
  distance_m: number | null;
  hr_avg: number | null;
  hr_peak: number | null;
  rpe: number | null;
  notes: string;
}

/** Why the finish can't be sent yet, or null when it can. */
export function finishBlocker(f: CardioFinishInput): string | null {
  if (f.duration_min == null || f.duration_min < 1) return "Enter how many minutes you did.";
  if (f.rpe == null) return "Pick an effort to finish.";
  return null;
}

/** One POST: the cardio block, plus the summary via `session_rpe` — unless the
 * row already has a summary (an older finish), which must not get a second. */
export function cardioFinishBody(
  plan: Plan,
  f: CardioFinishInput,
  opts: { withSummary: boolean } = { withSummary: true },
): LogExerciseIn {
  const { modality, device } = rowCardio(plan);
  return {
    plan_id: plan.plan_id,
    exercise: cardioExerciseName(plan),
    modality,
    device,
    log_type: "cardio_block",
    sets: [{
      duration_sec: Math.round((f.duration_min ?? 0) * 60),
      distance_m: f.distance_m ?? null,
      hr_avg: f.hr_avg ?? null,
      hr_peak: f.hr_peak ?? null,
      rpe_actual: f.rpe ?? null,
    }],
    notes: f.notes.trim() || null,
    session_rpe: opts.withSummary ? f.rpe ?? null : null,
  };
}

/** Minutes to pre-fill from the workout timer; null under a minute. */
export function prefillMinutes(elapsed_sec: number): number | null {
  const m = Math.round(elapsed_sec / 60);
  return m >= 1 ? m : null;
}
