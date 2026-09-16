import { useReducer, useState } from "react";
import Stepper from "./Stepper";
import RpeChips from "./RpeChips";
import FlagChips from "./FlagChips";
import NumericKeypad from "./NumericKeypad";
import { submitLog } from "../lib/log-queue";
import { composeSetNotes, supportsSetting, type QuickFlag } from "../lib/set-notes";
import { platesPerSide, weightStepFor } from "../lib/weight-step";
import type { Prefill, SetEntry } from "../lib/log-state";
import type { LastLoggedEntry, LogExerciseIn, PlannedExercise } from "../lib/types";

interface Props {
  exercise: PlannedExercise;
  plan_id: number;
  set_num: number;
  total_sets: number;
  /** Values to pre-fill with — see computePrefill(). */
  prefill: Prefill;
  /** Last logged set FROM A PRIOR SESSION (for the "last 35 lb" hint). */
  lastHint: LastLoggedEntry | null;
  alreadyFullyLogged: boolean;
  isFinisher?: boolean;
  onLoggedSet: (exerciseName: string, set: SetEntry) => void;
}

type Status = "idle" | "saving" | "ok" | "queued" | "error";

interface State {
  weight: number | null;
  reps: number | null;
  rpe: number | null;
  setting: number | null;
  flags: QuickFlag[];
  status: Status;
  error: string | null;
}

type Action =
  | { type: "set_weight"; v: number | null }
  | { type: "set_reps"; v: number | null }
  | { type: "set_rpe"; v: number | null }
  | { type: "set_setting"; v: number | null }
  | { type: "set_flags"; flags: QuickFlag[] }
  | { type: "save_start" }
  | { type: "save_ok" }
  | { type: "save_queued" }
  | { type: "save_err"; message: string };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "set_weight":  return { ...state, weight: action.v, status: "idle", error: null };
    case "set_reps":    return { ...state, reps: action.v, status: "idle", error: null };
    case "set_rpe":     return { ...state, rpe: action.v, status: "idle", error: null };
    case "set_setting": return { ...state, setting: action.v, status: "idle", error: null };
    case "set_flags":   return { ...state, flags: action.flags, status: "idle", error: null };
    case "save_start":  return { ...state, status: "saving", error: null };
    case "save_ok":     return { ...state, status: "ok", error: null };
    case "save_queued": return { ...state, status: "queued", error: null };
    case "save_err":    return { ...state, status: "error", error: action.message };
  }
}

/** Single-set logger card — ONE session_log row per tap on the primary
 * button, with the supplied set_num.
 *
 * No OS keyboard: weight / reps are steppers whose value opens the in-app
 * keypad, RPE and quick flags are chips, and the optional machine setting is a
 * keypad field. Flags and the setting are written to the row's notes
 * ("setting=7; machine taken").
 *
 * Pre-fills from `prefill` (previous set this session > last session > plan
 * target). A write that can't reach the server is queued and counts as logged
 * locally; the header badge shows it until it syncs.
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
  const showSetting = useReps && supportsSetting(w.cls);
  const [settingPadOpen, setSettingPadOpen] = useState(false);

  const [state, dispatch] = useReducer(reducer, {
    weight: prefill.weight,
    reps: prefill.reps,
    rpe: prefill.rpe,
    setting: prefill.setting ?? null,
    flags: [],
    status: "idle",
    error: null,
  });

  const isDone = alreadyFullyLogged || state.status === "ok" || state.status === "queued";
  const skipped = state.flags.includes("skipped");

  async function save() {
    if (isDone || state.status === "saving") return;
    dispatch({ type: "save_start" });
    const setRow = {
      set_num,
      reps_done: skipped || !useReps ? null : state.reps ?? null,
      weight_lbs: skipped || w.isBodyweight || !useReps ? null : state.weight ?? null,
      duration_sec: skipped || useReps ? null : state.reps ?? null,
      rpe_actual: skipped ? null : state.rpe ?? null,
      is_skipped: skipped,
      notes: composeSetNotes({
        finisher: isFinisher,
        setting: showSetting ? state.setting : null,
        flags: state.flags,
      }),
    };
    const body: LogExerciseIn = {
      plan_id,
      exercise: exercise.name,
      log_type: "strength_set",
      sets: [setRow],
    };
    const r = await submitLog(body);
    if (r.status === "error") {
      dispatch({ type: "save_err", message: r.message });
      return;
    }
    dispatch({ type: r.status === "ok" ? "save_ok" : "save_queued" });
    onLoggedSet(exercise.name, {
      set_num,
      weight_lbs: setRow.weight_lbs,
      reps_done: setRow.reps_done,
      rpe_actual: setRow.rpe_actual,
      setting: showSetting ? state.setting : null,
    });
  }

  const perSide =
    w.showPlateMath && state.weight != null ? platesPerSide(state.weight, w.barLbs) : null;

  return (
    <div className={`log-card${isDone ? " log-card--done" : ""}`} data-testid="inline-logger" data-no-swipe>
      <div className="log-card-head">
        <div className="log-card-name">
          {exercise.name}
          {isDone && <span className="log-check"> ✓</span>}
        </div>
        <div className="log-card-target mono">
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
            min={w.min}
            max={w.max}
            allowDecimal
            blankStart={prefill.weight ?? exercise.target_load_lbs ?? (w.min || w.step)}
            hint={lastHint?.weight_lbs ?? null}
            disabled={isDone || skipped}
            sub={
              w.showPlateMath
                ? perSide == null
                  ? "below bar weight"
                  : `${prettyN(perSide)} lb per side`
                : undefined
            }
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
          disabled={isDone || skipped}
          onChange={(v) => dispatch({ type: "set_reps", v })}
        />
        {showSetting && (
          <div className="setting-field">
            <div className="stepper-label">Seat / setting #</div>
            <button
              type="button"
              className="setting-value mono"
              disabled={isDone}
              onClick={() => setSettingPadOpen(true)}
              aria-label={`Seat or setting ${state.setting ?? "not set"}, tap to enter`}
            >
              {state.setting == null ? "—" : prettyN(state.setting)}
            </button>
            {settingPadOpen && (
              <NumericKeypad
                title="Seat / setting #"
                initial={state.setting}
                allowDecimal
                allowNegative={false}
                onCancel={() => setSettingPadOpen(false)}
                onDone={(v) => {
                  setSettingPadOpen(false);
                  dispatch({ type: "set_setting", v });
                }}
              />
            )}
          </div>
        )}
      </div>

      <RpeChips
        value={state.rpe}
        disabled={isDone || skipped}
        onChange={(v) => dispatch({ type: "set_rpe", v })}
      />

      <FlagChips
        value={state.flags}
        disabled={isDone}
        onChange={(flags) => dispatch({ type: "set_flags", flags })}
      />

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
        {state.status === "queued"
          ? "Saved offline ✓ — will sync"
          : isDone
          ? "Logged ✓"
          : state.status === "saving"
          ? "Saving…"
          : logButtonLabel(state, set_num, useReps, w.isBodyweight)}
      </button>
    </div>
  );
}

function logButtonLabel(state: State, set_num: number, useReps: boolean, isBw: boolean): string {
  if (state.flags.includes("skipped")) return `Log set ${set_num}: skipped`;
  const parts: string[] = [];
  if (!isBw && useReps && state.weight != null) parts.push(`${prettyN(state.weight)}lb`);
  if (state.reps != null) parts.push(useReps ? `× ${state.reps}` : `${state.reps}s`);
  if (state.rpe != null) parts.push(`@RPE ${prettyN(state.rpe)}`);
  return parts.length > 0 ? `Log set ${set_num}: ${parts.join(" ")}` : `Log set ${set_num}`;
}

function prettyN(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}
