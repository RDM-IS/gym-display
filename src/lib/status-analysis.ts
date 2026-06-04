import type { ExerciseLog, LoggedSession } from "./types";

/** Best (heaviest) strength set per exercise within a session. */
export function bestStrengthSetsByExercise(
  session: LoggedSession
): Map<string, ExerciseLog> {
  const out = new Map<string, ExerciseLog>();
  for (const ex of session.exercises) {
    if (ex.log_type !== "strength_set" || !ex.exercise) continue;
    const prev = out.get(ex.exercise);
    if (!prev || (ex.weight_lbs ?? 0) > (prev.weight_lbs ?? 0)) {
      out.set(ex.exercise, ex);
    }
  }
  return out;
}

/** Cardio block per exercise (most-recent or sole entry). */
export function cardioBlocksByExercise(
  session: LoggedSession
): Map<string, ExerciseLog> {
  const out = new Map<string, ExerciseLog>();
  for (const ex of session.exercises) {
    if (ex.log_type !== "cardio_block" || !ex.exercise) continue;
    out.set(ex.exercise, ex);
  }
  return out;
}

export interface PerExerciseDelta {
  exercise: string;
  current: ExerciseLog;
  history_avg_weight: number | null;
  history_avg_reps: number | null;
  weight_delta: number | null;
  reps_delta: number | null;
  n_history: number;
}

function avgOf(values: (number | null | undefined)[]): number | null {
  const xs = values.filter((v): v is number => typeof v === "number");
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function perExerciseDeltas(
  current: LoggedSession,
  history: LoggedSession[]
): PerExerciseDelta[] {
  const currentBests = bestStrengthSetsByExercise(current);
  const historyBestsByName: Map<string, ExerciseLog[]> = new Map();
  for (const h of history) {
    const bests = bestStrengthSetsByExercise(h);
    bests.forEach((ex, name) => {
      const arr = historyBestsByName.get(name) ?? [];
      arr.push(ex);
      historyBestsByName.set(name, arr);
    });
  }

  const out: PerExerciseDelta[] = [];
  currentBests.forEach((curEx, name) => {
    const hist = historyBestsByName.get(name) ?? [];
    const avgW = avgOf(hist.map((e) => e.weight_lbs));
    const avgR = avgOf(hist.map((e) => e.reps_done));
    out.push({
      exercise: name,
      current: curEx,
      history_avg_weight: avgW,
      history_avg_reps: avgR,
      weight_delta:
        curEx.weight_lbs != null && avgW != null ? curEx.weight_lbs - avgW : null,
      reps_delta:
        curEx.reps_done != null && avgR != null ? curEx.reps_done - avgR : null,
      n_history: hist.length,
    });
  });
  return out;
}
