import { useReducer } from "react";
import Stepper from "./Stepper";
import { postLog } from "../lib/api";
import { weightStepFor } from "../lib/weight-step";
import type {
  LastLoggedEntry,
  LogExerciseIn,
  LogSetIn,
  PlannedExercise,
} from "../lib/types";

interface Props {
  exercise: PlannedExercise;
  plan_id: number;
  rounds: number;
  last: LastLoggedEntry | null;
  /** Already logged today — render the panel as ✓ Logged and disable. */
  alreadyLogged: boolean;
  isFinisher?: boolean;
  onLogged: (exerciseName: string) => void;
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

/** Single-exercise stepper card. Used by:
 *  - WorkoutScreen's main panel during a rest step (logs the just-finished
 *    exercise in the rest you're already in)
 *  - LogPanel's full-screen overlay
 * Both routes hit the same /api/health/log endpoint and call onLogged()
 * so the parent's loggedExercises set propagates everywhere. */
export default function InlineExerciseLogger({
  exercise,
  plan_id,
  rounds,
  last,
  alreadyLogged,
  isFinisher,
  onLogged,
}: Props) {
  const w = weightStepFor(exercise);
  const useReps = exercise.format === "reps";

  const initial: State = {
    weight: last?.weight_lbs ?? exercise.target_load_lbs ?? null,
    reps: useReps
      ? last?.reps_done ?? exercise.target_reps ?? null
      : exercise.duration_sec ?? null,
    rpe: null,
    status: "idle",
    error: null,
  };
  const [state, dispatch] = useReducer(reducer, initial);
  const isDone = alreadyLogged || state.status === "ok";

  async function save() {
    if (isDone) return;
    dispatch({ type: "save_start" });
    const sets: LogSetIn[] = Array.from({ length: Math.max(1, rounds) }, (_, i) => ({
      set_num: i + 1,
      reps_done: useReps ? state.reps ?? null : null,
      weight_lbs: w.isBodyweight ? null : state.weight ?? null,
      duration_sec: useReps ? null : state.reps ?? null,
      rpe_actual: state.rpe ?? null,
    }));
    const body: LogExerciseIn = {
      plan_id,
      exercise: exercise.name,
      log_type: "strength_set",
      sets,
      notes: isFinisher ? "finisher" : null,
    };
    const r = await postLog(body);
    if (r.status === "ok") {
      dispatch({ type: "save_ok" });
      onLogged(exercise.name);
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
          {useReps
            ? `target ${exercise.target_reps ?? "?"}${exercise.target_load_lbs ? ` @ ${exercise.target_load_lbs} lb` : ""}`
            : `target ${exercise.duration_sec ?? "?"} sec`}
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
            blankStart={exercise.target_load_lbs ?? 0}
            hint={last?.weight_lbs ?? null}
            disabled={isDone}
            onChange={(v) => dispatch({ type: "set_weight", v })}
          />
        )}
        <Stepper
          label={useReps ? "Reps" : "Seconds"}
          value={state.reps}
          step={useReps ? 1 : 5}
          min={0}
          blankStart={useReps ? exercise.target_reps ?? 0 : exercise.duration_sec ?? 0}
          hint={useReps ? last?.reps_done ?? null : null}
          disabled={isDone}
          onChange={(v) => dispatch({ type: "set_reps", v })}
        />
        <Stepper
          label="RPE"
          value={state.rpe}
          step={1}
          min={1}
          max={10}
          blankStart={7}
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
        aria-label={`Log ${exercise.name}`}
      >
        {isDone
          ? "Logged ✓"
          : state.status === "saving"
          ? "Saving…"
          : logButtonLabel(state, rounds, useReps, w.isBodyweight)}
      </button>
    </div>
  );
}

function logButtonLabel(state: State, rounds: number, useReps: boolean, isBw: boolean): string {
  const parts: string[] = [];
  if (rounds > 1) parts.push(`${rounds} ×`);
  if (!isBw && useReps && state.weight != null) parts.push(`${prettyN(state.weight)}lb`);
  if (state.reps != null) parts.push(useReps ? `${state.reps} reps` : `${state.reps}s`);
  if (state.rpe != null) parts.push(`@RPE ${prettyN(state.rpe)}`);
  return parts.length > 0 ? `Log ${parts.join(" ")}` : "Log";
}

function prettyN(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}
