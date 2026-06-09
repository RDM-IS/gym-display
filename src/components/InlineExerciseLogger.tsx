import { useReducer } from "react";
import Stepper from "./Stepper";
import { postLog } from "../lib/api";
import { weightStepFor } from "../lib/weight-step";
import type { Prefill, SetEntry } from "../lib/log-state";
import type { LastLoggedEntry, LogExerciseIn, PlannedExercise } from "../lib/types";

interface Props {
  exercise: PlannedExercise;
  plan_id: number;
  set_num: number;
  total_sets: number;
  /** Values to pre-fill the steppers with — see computePrefill(). */
  prefill: Prefill;
  /** Last logged set FROM A PRIOR SESSION (for the small "last 35 lb" hint
   * under each stepper). */
  lastHint: LastLoggedEntry | null;
  alreadyFullyLogged: boolean;
  isFinisher?: boolean;
  onLoggedSet: (exerciseName: string, set: SetEntry) => void;
}

type Status = "idle" | "saving" | "ok" | "error";

interface State {
  weight: number | null;
  reps: number | null;
  rpe: number | null;
  status: Status;
  error: string | null;
}

type Action =
  | { type: "set_weight"; v: number | null }
  | { type: "set_reps"; v: number | null }
  | { type: "set_rpe"; v: number | null }
  | { type: "save_start" }
  | { type: "save_ok" }
  | { type: "save_err"; message: string };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "set_weight": return { ...state, weight: action.v, status: "idle", error: null };
    case "set_reps":   return { ...state, reps: action.v, status: "idle", error: null };
    case "set_rpe":    return { ...state, rpe: action.v, status: "idle", error: null };
    case "save_start": return { ...state, status: "saving", error: null };
    case "save_ok":    return { ...state, status: "ok", error: null };
    case "save_err":   return { ...state, status: "error", error: action.message };
  }
}

/** Single-set logger card.
 *
 * Captures ONE set of one exercise and writes ONE session_log row via
 * POST /api/health/log with the supplied set_num. The Log button reads
 * the single-set value ("Log set 2: 30 lb × 12 @RPE 8") so a glance
 * tells the user exactly what they're about to write.
 *
 * Pre-fills from `prefill` (parent computes: previous set this session
 * > last-logged-session > plan target) so set 2 starts from set 1's
 * values — when the user bumps the weight for set 3, they're actively
 * surfacing divergence rather than blindly carrying a wrong value.
 *
 * The same component is used by:
 *   - WorkoutScreen's main panel during a rest step (logs the just-
 *     finished exercise / round in the rest you're already in)
 *   - LogPanel's full-screen overlay (logs the next unlogged set)
 *
 * Both routes hit the same /api/health/log endpoint. The parent calls
 * `onLoggedSet(name, setEntry)` to append to the shared sessionSets so
 * the next render of this card (keyed by set_num) shows the next set.
 */
export default function InlineExerciseLogger({
  exercise,
  plan_id,
  set_num,
  total_sets,
  prefill,
  lastHint,
  alreadyFullyLogged,
  isFinisher,
  onLoggedSet,
}: Props) {
  const w = weightStepFor(exercise);
  const useReps = exercise.format === "reps";

  const [state, dispatch] = useReducer(reducer, {
    weight: prefill.weight,
    reps: prefill.reps,
    rpe: prefill.rpe,
    status: "idle",
    error: null,
  });

  const isDone = alreadyFullyLogged || state.status === "ok";

  async function save() {
    if (isDone) return;
    dispatch({ type: "save_start" });
    const setRow = {
      set_num,
      reps_done: useReps ? state.reps ?? null : null,
      weight_lbs: w.isBodyweight ? null : state.weight ?? null,
      duration_sec: useReps ? null : state.reps ?? null,
      rpe_actual: state.rpe ?? null,
    };
    const body: LogExerciseIn = {
      plan_id,
      exercise: exercise.name,
      log_type: "strength_set",
      sets: [setRow],
      notes: isFinisher ? "finisher" : null,
    };
    const r = await postLog(body);
    if (r.status === "ok") {
      dispatch({ type: "save_ok" });
      onLoggedSet(exercise.name, {
        set_num,
        weight_lbs: setRow.weight_lbs,
        reps_done: setRow.reps_done,
        rpe_actual: setRow.rpe_actual,
      });
    } else {
      dispatch({ type: "save_err", message: r.message });
    }
  }

  return (
    <div className={`log-card${isDone ? " log-card--done" : ""}`} data-testid="inline-logger">
      <div className="log-card-head">
        <div className="log-card-name">
          {exercise.name}
          {isDone && <span className="log-check"> ✓</span>}
        </div>
        <div className="log-card-target tv-mono">
          Set {set_num} of {total_sets}
          {useReps && exercise.target_load_lbs ? ` · target ${exercise.target_load_lbs} lb` : ""}
          {useReps && exercise.target_reps != null ? ` × ${exercise.target_reps}` : ""}
        </div>
      </div>
      <div className="log-steppers">
        {!w.isBodyweight && useReps && (
          <Stepper
            label="Weight"
            unit="lb"
            value={state.weight}
            step={w.step}
            min={0}
            blankStart={prefill.weight ?? exercise.target_load_lbs ?? 0}
            hint={lastHint?.weight_lbs ?? null}
            disabled={isDone}
            onChange={(v) => dispatch({ type: "set_weight", v })}
          />
        )}
        <Stepper
          label={useReps ? "Reps" : "Seconds"}
          value={state.reps}
          step={useReps ? 1 : 5}
          min={0}
          blankStart={prefill.reps ?? (useReps ? exercise.target_reps ?? 0 : exercise.duration_sec ?? 0)}
          hint={useReps ? lastHint?.reps_done ?? null : null}
          disabled={isDone}
          onChange={(v) => dispatch({ type: "set_reps", v })}
        />
        <Stepper
          label="RPE"
          value={state.rpe}
          step={1}
          min={1}
          max={10}
          blankStart={prefill.rpe ?? 7}
          disabled={isDone}
          onChange={(v) => dispatch({ type: "set_rpe", v })}
        />
      </div>
      {state.status === "error" && state.error && (
        <div className="log-error">{state.error} — tap Log to retry</div>
      )}
      <button
        className="log-save"
        type="button"
        onClick={save}
        disabled={isDone || state.status === "saving"}
        aria-label={`Log ${exercise.name} set ${set_num}`}
      >
        {isDone
          ? "Logged ✓"
          : state.status === "saving"
          ? "Saving…"
          : logButtonLabel(state, set_num, useReps, w.isBodyweight)}
      </button>
    </div>
  );
}

function logButtonLabel(state: State, set_num: number, useReps: boolean, isBw: boolean): string {
  const parts: string[] = [];
  if (!isBw && useReps && state.weight != null) parts.push(`${prettyN(state.weight)}lb`);
  if (state.reps != null) parts.push(useReps ? `× ${state.reps}` : `${state.reps}s`);
  if (state.rpe != null) parts.push(`@RPE ${prettyN(state.rpe)}`);
  return parts.length > 0
    ? `Log set ${set_num}: ${parts.join(" ")}`
    : `Log set ${set_num}`;
}

function prettyN(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}
