import { useReducer, useState } from "react";
import Stepper from "./Stepper";
import RpeChips from "./RpeChips";
import FlagChips from "./FlagChips";
import NumericKeypad from "./NumericKeypad";
import { submitLog } from "../lib/log-queue";
import { composeSetNotes, formatSetup, SETUP_FIELDS, SETUP_LABELS, supportsSetting,
         type MachineSetup, type PainEntry, type QuickFlag, type SetupField } from "../lib/set-notes";
import { plateLabel, weightStepFor } from "../lib/weight-step";
import type { Prefill, SetEntry } from "../lib/log-state";
import type { LoadConfigByClass, LastLoggedEntry, LogExerciseIn, PlannedExercise } from "../lib/types";

interface Props {
  exercise: PlannedExercise;
  plan_id: number;
  /** LOCATION-1: the row's blocks.load_config — what a load means at this
   * gym. Omitted → the office defaults, which is what pre-LOCATION-1 rows
   * mean. */
  loadConfig?: LoadConfigByClass | null;
  set_num: number;
  total_sets: number;
  /** Values to pre-fill with — see computePrefill(). */
  prefill: Prefill;
  /** Last logged set FROM A PRIOR SESSION (for the "last 35 lb" hint). */
  lastHint: LastLoggedEntry | null;
  alreadyFullyLogged: boolean;
  isFinisher?: boolean;
  /** Program week — week 1 opens the Machine setup field on set 1. */
  week_num?: number;
  onLoggedSet: (exerciseName: string, set: SetEntry) => void;
}

export const MACHINE_SETUP_HELP =
  "The numbered positions you used — seat, pad, range. Next time they're pre-filled.";

/** Machine setup starts expanded on set 1 of a machine exercise in week 1 —
 * that's when the seat/pad numbers are first found and worth writing down. */
export function machineSetupOpenByDefault(week_num: number | undefined, set_num: number): boolean {
  return week_num === 1 && set_num === 1;
}

type Status = "idle" | "saving" | "ok" | "queued" | "error";

interface State {
  weight: number | null;
  reps: number | null;
  rpe: number | null;
  setup: MachineSetup;
  flags: QuickFlag[];
  pain: PainEntry[];
  status: Status;
  error: string | null;
}

type Action =
  | { type: "set_weight"; v: number | null }
  | { type: "set_reps"; v: number | null }
  | { type: "set_rpe"; v: number | null }
  | { type: "set_setup"; field: SetupField; v: number | null }
  | { type: "set_flags"; flags: QuickFlag[] }
  | { type: "set_pain"; pain: PainEntry[] }
  | { type: "save_start" }
  | { type: "save_ok" }
  | { type: "save_queued" }
  | { type: "save_err"; message: string };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "set_weight":  return { ...state, weight: action.v, status: "idle", error: null };
    case "set_reps":    return { ...state, reps: action.v, status: "idle", error: null };
    case "set_rpe":     return { ...state, rpe: action.v, status: "idle", error: null };
    case "set_setup": {
      const setup = { ...state.setup };
      if (action.v == null) delete setup[action.field];
      else setup[action.field] = action.v;
      return { ...state, setup, status: "idle", error: null };
    }
    case "set_flags":   return { ...state, flags: action.flags, status: "idle", error: null };
    case "set_pain":    return { ...state, pain: action.pain, status: "idle", error: null };
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
 * keypad, RPE and quick flags are chips, and the optional machine setup is up
 * to three keypad fields (seat, pad, range). Flags, pain and the positions are
 * written to the row's notes ("seat=4; pad=3; pain=shoulder:2; machine taken").
 *
 * Pre-fills from `prefill` (previous set this session > last session > plan
 * target). A write that can't reach the server is queued and counts as logged
 * locally; the header badge shows it until it syncs.
 */
export default function InlineExerciseLogger({
  exercise,
  plan_id,
  loadConfig,
  set_num,
  total_sets,
  prefill,
  lastHint,
  alreadyFullyLogged,
  isFinisher,
  week_num,
  onLoggedSet,
}: Props) {
  const w = weightStepFor(exercise, loadConfig);
  const useReps = exercise.format === "reps";
  const showSetting = useReps && supportsSetting(w.cls);
  const [setupPad, setSetupPad] = useState<SetupField | null>(null);
  const [setupOpen, setSetupOpen] = useState(() => machineSetupOpenByDefault(week_num, set_num));

  const [state, dispatch] = useReducer(reducer, {
    weight: prefill.weight,
    reps: prefill.reps,
    rpe: prefill.rpe,
    setup: prefill.setup ?? {},
    flags: [],
    pain: [],
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
        setup: showSetting ? state.setup : null,
        pain: state.pain,
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
      setup: showSetting ? state.setup : null,
    });
  }


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
          {useReps && exercise.load_from != null ? ` (last ${exercise.load_from} lb)` : ""}
        </div>
        {useReps && exercise.load_note && (
          <div className="log-card-note" data-testid="load-note">{exercise.load_note}</div>
        )}
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
            values={w.values}
            blankStart={prefill.weight ?? exercise.target_load_lbs ?? (w.min || w.step)}
            hint={lastHint?.weight_lbs ?? null}
            disabled={isDone || skipped}
            sub={
              w.showPlateMath && state.weight != null
                ? plateLabel(state.weight, w.barLbs)
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
        {showSetting && !setupOpen && (
          <button
            type="button"
            className="setting-toggle"
            data-testid="machine-setup-toggle"
            aria-expanded={false}
            onClick={() => setSetupOpen(true)}
          >
            Machine setup{formatSetup(state.setup) ? `: ${formatSetup(state.setup)} ▸` : " ▸"}
          </button>
        )}
        {showSetting && setupOpen && (
          <div className="setting-field" data-testid="machine-setup">
            <button
              type="button"
              className="stepper-label setting-label"
              aria-expanded={true}
              onClick={() => setSetupOpen(false)}
            >
              Machine setup ▾
            </button>
            <div className="setting-help">{MACHINE_SETUP_HELP}</div>
            <div className="setting-positions">
              {SETUP_FIELDS.map((f) => (
                <label key={f} className="setting-position">
                  <span className="setting-position-label">{SETUP_LABELS[f]}</span>
                  <button
                    type="button"
                    className="setting-value mono"
                    disabled={isDone}
                    data-testid={`setup-${f}`}
                    onClick={() => setSetupPad(f)}
                    aria-label={`${SETUP_LABELS[f]} ${state.setup[f] ?? "not set"}, tap to enter`}
                  >
                    {state.setup[f] == null ? "—" : prettyN(state.setup[f]!)}
                  </button>
                </label>
              ))}
            </div>
            {setupPad && (
              <NumericKeypad
                title={SETUP_LABELS[setupPad]}
                initial={state.setup[setupPad] ?? null}
                allowDecimal
                allowNegative={false}
                onCancel={() => setSetupPad(null)}
                onDone={(v) => {
                  const f = setupPad;
                  setSetupPad(null);
                  dispatch({ type: "set_setup", field: f, v });
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
        pain={state.pain}
        disabled={isDone}
        onChange={(flags) => dispatch({ type: "set_flags", flags })}
        onPainChange={(pain) => dispatch({ type: "set_pain", pain })}
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
