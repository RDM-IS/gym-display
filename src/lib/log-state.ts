import { exerciseSets } from "./adjustment";
import type { Plan } from "./types";
import { parseSetup, type MachineSetup } from "./set-notes";

// ---------------------------------------------------------------------------
// Per-set logging model.
// One row in health.session_log = one set of one exercise. The rest-panel
// and LogPanel both write ONE row at a time with the correct set_num so
// sets that diverge mid-workout (35lb sets 1–2, then 40lb set 3) land as
// distinct rows.
// ---------------------------------------------------------------------------

export interface SetEntry {
  set_num: number;
  weight_lbs: number | null;
  reps_done: number | null;
  rpe_actual: number | null;
  /** Machine positions recorded with this set (seat / pad / range), if any. */
  setup?: MachineSetup | null;
}

export type SessionSets = Record<string, SetEntry[]>;
export type ServerLoggedCount = Record<string, number>;

/** Total sets the user is expected to do for an exercise this session.
 *
 *   Circuit (each round = one set):
 *     occurrences × rounds  — where `occurrences` = how many times the
 *     exercise appears in exercises[]. Pure circuit: occurrences=1.
 *     Straight-sets style (same name listed N times): occurrences=N.
 *
 *   Finisher (separate circuit body): same formula, summed in.
 *
 * Straight-sets handling is supported by the occurrences math but
 * untested against real plan data (current plans are all circuits).
 */
export function totalSetsFor(plan: Plan, exerciseName: string): number {
  let total = 0;
  const blocks = plan.blocks;
  if (blocks?.type === "circuit") {
    const rounds = Math.max(1, blocks.rounds ?? 1);
    // A check-in adjustment can give one exercise fewer sets than the rounds.
    for (const e of Array.isArray(blocks.exercises) ? blocks.exercises : []) {
      if (e.name === exerciseName) total += exerciseSets(e, rounds);
    }
  }
  const fin = blocks?.finisher;
  if (fin && Array.isArray(fin.exercises)) {
    const occ = fin.exercises.filter((e) => e.name === exerciseName).length;
    const rounds = Math.max(1, fin.rounds ?? 1);
    total += occ * rounds;
  }
  return total > 0 ? total : 1;
}

export function loggedCountFor(
  name: string,
  sessionSets: SessionSets,
  serverLoggedCount: ServerLoggedCount,
): number {
  const s = sessionSets[name]?.length ?? 0;
  const t = serverLoggedCount[name] ?? 0;
  // We take the max — server hydration may show the count from rows
  // written before the user reloaded mid-workout, while sessionSets
  // tracks live values from this load.
  return Math.max(s, t);
}

export function nextSetNumFor(
  name: string,
  sessionSets: SessionSets,
  serverLoggedCount: ServerLoggedCount,
): number {
  return loggedCountFor(name, sessionSets, serverLoggedCount) + 1;
}

/** Last set logged THIS session — primary prefill source. */
export function previousSetFor(
  name: string,
  sessionSets: SessionSets,
): SetEntry | null {
  const arr = sessionSets[name];
  return arr && arr.length > 0 ? arr[arr.length - 1] : null;
}

export function isFullyLogged(
  name: string,
  plan: Plan,
  sessionSets: SessionSets,
  serverLoggedCount: ServerLoggedCount,
): boolean {
  return (
    loggedCountFor(name, sessionSets, serverLoggedCount) >= totalSetsFor(plan, name)
  );
}

/** Build the prefill triple for the next set.
 *  Priority: previous set THIS session > last-logged-session > plan target.
 *  When a check-in LOWERED the target (`targetIsLighter`, PAIN-1) the target
 *  beats last session's weight, so the stepper doesn't open at the old load. */
export interface Prefill {
  weight: number | null;
  reps: number | null;
  rpe: number | null;
  /** Machine positions: previous set this session > last session's notes. */
  setup: MachineSetup;
}

export function computePrefill(
  name: string,
  format: "reps" | "duration",
  target_load_lbs: number | null | undefined,
  target_reps: number | null | undefined,
  target_duration_sec: number | null | undefined,
  sessionSets: SessionSets,
  lastSession: { weight_lbs: number | null; reps_done: number | null; notes?: string | null } | null,
  targetIsLighter = false,
): Prefill {
  const prev = previousSetFor(name, sessionSets);
  // Reps OR duration, depending on format.
  const repsFromPrev = prev?.reps_done ?? null;
  const repsTarget = format === "reps" ? target_reps ?? null : target_duration_sec ?? null;
  return {
    weight: prev?.weight_lbs
      ?? (targetIsLighter && target_load_lbs != null ? target_load_lbs : null)
      ?? lastSession?.weight_lbs ?? target_load_lbs ?? null,
    reps: repsFromPrev ?? lastSession?.reps_done ?? repsTarget,
    rpe: prev?.rpe_actual ?? null,
    setup: prev?.setup ?? parseSetup(lastSession?.notes),
  };
}

export interface ExerciseCompletion {
  logged: number;
  total: number;
}

/** Build the completion map JourneyMap needs for ✓ / "(n/m)" badges. */
export function buildCompletionMap(
  plan: Plan,
  exerciseNames: Iterable<string>,
  sessionSets: SessionSets,
  serverLoggedCount: ServerLoggedCount,
): Map<string, ExerciseCompletion> {
  const m = new Map<string, ExerciseCompletion>();
  for (const name of exerciseNames) {
    if (m.has(name)) continue;
    m.set(name, {
      logged: loggedCountFor(name, sessionSets, serverLoggedCount),
      total: totalSetsFor(plan, name),
    });
  }
  return m;
}
