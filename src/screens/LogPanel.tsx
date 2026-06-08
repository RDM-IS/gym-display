import { useEffect, useMemo, useReducer, useState } from "react";
import { fetchLoggedToday, postLog } from "../lib/api";
import { displayTitle, formatPlanDate } from "../lib/format";
import type {
  Blocks,
  Finisher,
  LogExerciseIn,
  LogSetIn,
  LoggedExerciseEntry,
  Plan,
  PlannedExercise,
} from "../lib/types";

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

type Status = "idle" | "saving" | "ok" | "error";

interface ExerciseFormState {
  sets: LogSetIn[];
  status: Status;
  error: string | null;
}

interface CardioFormState {
  block: LogSetIn;
  status: Status;
  error: string | null;
}

interface SummaryFormState {
  rpe_actual: number | null;
  notes: string;
  status: Status;
  error: string | null;
}

interface State {
  exercises: Record<string, ExerciseFormState>;  // key = exercise name
  cardio: CardioFormState | null;
  loggedFromServer: Set<string>;
  hasSummary: boolean;
  summary: SummaryFormState;
}

type Action =
  | { type: "set_rep"; key: string; idx: number; value: number | null }
  | { type: "set_weight"; key: string; idx: number; value: number | null }
  | { type: "set_rpe"; key: string; idx: number; value: number | null }
  | { type: "set_cardio"; field: keyof LogSetIn; value: number | null }
  | { type: "set_summary_rpe"; value: number | null }
  | { type: "set_summary_notes"; value: string }
  | { type: "save_start"; key: string }
  | { type: "save_ok"; key: string }
  | { type: "save_err"; key: string; message: string }
  | { type: "cardio_save_start" }
  | { type: "cardio_save_ok" }
  | { type: "cardio_save_err"; message: string }
  | { type: "summary_save_start" }
  | { type: "summary_save_ok" }
  | { type: "summary_save_err"; message: string }
  | { type: "hydrate_logged"; logged: LoggedExerciseEntry[]; hasSummary: boolean };

function buildInitialState(plan: Plan): State {
  const exercises: Record<string, ExerciseFormState> = {};
  const rounds = circuitRounds(plan.blocks);
  for (const ex of mainExercises(plan.blocks)) {
    exercises[ex.name] = blankExerciseForm(ex, rounds);
  }
  for (const ex of finisherExercises(plan.blocks?.finisher)) {
    // Same-name collisions between main + finisher: prefix finisher key so
    // both forms exist independently.
    exercises[`finisher:${ex.name}`] = blankExerciseForm(
      ex,
      Math.max(1, plan.blocks?.finisher?.rounds ?? 1)
    );
  }
  const blockType = plan.blocks?.type;
  const cardio: CardioFormState | null =
    blockType === "steady" || blockType === "intervals" || blockType === "walk"
      ? {
          block: { duration_sec: null, distance_m: null, hr_avg: null, hr_peak: null, rpe_actual: null },
          status: "idle",
          error: null,
        }
      : null;
  return {
    exercises,
    cardio,
    loggedFromServer: new Set(),
    hasSummary: false,
    summary: { rpe_actual: null, notes: "", status: "idle", error: null },
  };
}

function blankExerciseForm(ex: PlannedExercise, rounds: number): ExerciseFormState {
  const n = Math.max(1, rounds);
  const sets: LogSetIn[] = Array.from({ length: n }, (_, i) => ({
    set_num: i + 1,
    reps_done: ex.format === "reps" ? ex.target_reps ?? null : null,
    weight_lbs: ex.target_load_lbs ?? null,
    duration_sec: ex.format === "duration" ? ex.duration_sec ?? null : null,
    rpe_actual: null,
  }));
  return { sets, status: "idle", error: null };
}

function mainExercises(blocks: Blocks | undefined): PlannedExercise[] {
  if (!blocks) return [];
  if (blocks.type === "circuit") {
    return Array.isArray(blocks.exercises) ? blocks.exercises : [];
  }
  return [];
}

function finisherExercises(f: Finisher | null | undefined): PlannedExercise[] {
  if (!f) return [];
  return Array.isArray(f.exercises) ? f.exercises : [];
}

function circuitRounds(blocks: Blocks | undefined): number {
  if (!blocks) return 1;
  if (blocks.type === "circuit") return Math.max(1, blocks.rounds ?? 1);
  return 1;
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "set_rep":   return setField(state, action.key, action.idx, "reps_done", action.value);
    case "set_weight": return setField(state, action.key, action.idx, "weight_lbs", action.value);
    case "set_rpe":   return setField(state, action.key, action.idx, "rpe_actual", action.value);
    case "set_cardio": {
      if (!state.cardio) return state;
      return { ...state, cardio: { ...state.cardio, block: { ...state.cardio.block, [action.field]: action.value }, status: "idle", error: null } };
    }
    case "set_summary_rpe":   return { ...state, summary: { ...state.summary, rpe_actual: action.value, status: "idle", error: null } };
    case "set_summary_notes": return { ...state, summary: { ...state.summary, notes: action.value, status: "idle", error: null } };
    case "save_start": return mut(state, action.key, (f) => ({ ...f, status: "saving", error: null }));
    case "save_ok":    return mut(state, action.key, (f) => ({ ...f, status: "ok", error: null }));
    case "save_err":   return mut(state, action.key, (f) => ({ ...f, status: "error", error: action.message }));
    case "cardio_save_start":
      return state.cardio ? { ...state, cardio: { ...state.cardio, status: "saving", error: null } } : state;
    case "cardio_save_ok":
      return state.cardio ? { ...state, cardio: { ...state.cardio, status: "ok", error: null } } : state;
    case "cardio_save_err":
      return state.cardio ? { ...state, cardio: { ...state.cardio, status: "error", error: action.message } } : state;
    case "summary_save_start": return { ...state, summary: { ...state.summary, status: "saving", error: null } };
    case "summary_save_ok":    return { ...state, summary: { ...state.summary, status: "ok", error: null }, hasSummary: true };
    case "summary_save_err":   return { ...state, summary: { ...state.summary, status: "error", error: action.message } };
    case "hydrate_logged": {
      const fromServer = new Set<string>(action.logged.map((e) => e.exercise));
      return { ...state, loggedFromServer: fromServer, hasSummary: action.hasSummary };
    }
  }
}

function mut(state: State, key: string, fn: (f: ExerciseFormState) => ExerciseFormState): State {
  const f = state.exercises[key];
  if (!f) return state;
  return { ...state, exercises: { ...state.exercises, [key]: fn(f) } };
}

function setField(state: State, key: string, idx: number, field: keyof LogSetIn, value: number | null): State {
  const f = state.exercises[key];
  if (!f) return state;
  const nextSets = f.sets.map((s, i) => (i === idx ? { ...s, [field]: value } : s));
  return { ...state, exercises: { ...state.exercises, [key]: { ...f, sets: nextSets, status: "idle", error: null } } };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  plan: Plan;
  elapsed_sec: number;       // for auto-filling cardio duration
  onBackToTimer: () => void;
  onFinish: () => void;      // call after session_summary saved
}

export default function LogPanel({ plan, elapsed_sec, onBackToTimer, onFinish }: Props) {
  const initial = useMemo(() => buildInitialState(plan), [plan]);
  const [state, dispatch] = useReducer(reducer, initial);
  const [loading, setLoading] = useState(true);

  // Hydrate logged-state on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await fetchLoggedToday();
      if (cancelled) return;
      if (r.status === "ok") {
        dispatch({ type: "hydrate_logged", logged: r.data.exercises, hasSummary: r.data.has_session_summary });
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  async function saveExercise(key: string, exerciseName: string, isFinisher: boolean) {
    const form = state.exercises[key];
    if (!form) return;
    dispatch({ type: "save_start", key });
    const body: LogExerciseIn = {
      plan_id: plan.plan_id,
      exercise: exerciseName,
      log_type: "strength_set",
      sets: form.sets.map((s, i) => ({
        set_num: i + 1,
        reps_done: s.reps_done ?? null,
        weight_lbs: s.weight_lbs ?? null,
        rpe_actual: s.rpe_actual ?? null,
        duration_sec: s.duration_sec ?? null,
      })),
      notes: isFinisher ? "finisher" : null,
    };
    const r = await postLog(body);
    if (r.status === "ok") {
      dispatch({ type: "save_ok", key });
    } else {
      dispatch({ type: "save_err", key, message: r.message });
    }
  }

  async function saveCardio() {
    if (!state.cardio) return;
    dispatch({ type: "cardio_save_start" });
    const b = state.cardio.block;
    const body: LogExerciseIn = {
      plan_id: plan.plan_id,
      exercise: plan.blocks?.display_name ?? displayTitle(plan),
      log_type: "cardio_block",
      sets: [{
        duration_sec: b.duration_sec ?? Math.round(elapsed_sec),
        distance_m: b.distance_m ?? null,
        hr_avg: b.hr_avg ?? null,
        hr_peak: b.hr_peak ?? null,
        rpe_actual: b.rpe_actual ?? null,
      }],
    };
    const r = await postLog(body);
    if (r.status === "ok") {
      dispatch({ type: "cardio_save_ok" });
    } else {
      dispatch({ type: "cardio_save_err", message: r.message });
    }
  }

  async function saveSummary() {
    dispatch({ type: "summary_save_start" });
    const body: LogExerciseIn = {
      plan_id: plan.plan_id,
      log_type: "session_summary",
      sets: [{ rpe_actual: state.summary.rpe_actual ?? null }],
      notes: state.summary.notes.trim() || null,
    };
    const r = await postLog(body);
    if (r.status === "ok") {
      dispatch({ type: "summary_save_ok" });
      onFinish();
    } else {
      dispatch({ type: "summary_save_err", message: r.message });
    }
  }

  const mains = mainExercises(plan.blocks);
  const fins = finisherExercises(plan.blocks?.finisher);
  const cardio = state.cardio;
  const blockType = plan.blocks?.type;

  return (
    <div className="log-panel">
      <div className="log-top">
        <button className="control-btn" onClick={onBackToTimer} aria-label="Back to timer">
          ◀ Timer
        </button>
        <div className="log-title">{displayTitle(plan)}</div>
        <div className="log-meta tv-mono">{formatPlanDate(plan)}</div>
      </div>

      <div className="log-scroll">
        {loading && <div className="log-empty">Loading current state…</div>}

        {cardio && (
          <CardioBlockForm
            blockType={blockType}
            form={cardio}
            elapsed_sec={elapsed_sec}
            onChange={(field, value) => dispatch({ type: "set_cardio", field, value })}
            onSave={saveCardio}
          />
        )}

        {mains.length > 0 && (
          <div className="log-section">
            <div className="log-section-title">Main</div>
            {mains.map((ex) => (
              <ExerciseForm
                key={ex.name}
                exercise={ex}
                form={state.exercises[ex.name]}
                alreadyLogged={state.loggedFromServer.has(ex.name)}
                onSetField={(idx, field, value) => dispatchField(dispatch, ex.name, idx, field, value)}
                onSave={() => saveExercise(ex.name, ex.name, false)}
              />
            ))}
          </div>
        )}

        {fins.length > 0 && (
          <div className="log-section">
            <div className="log-section-title">
              Finisher{plan.blocks?.finisher?.rounds && plan.blocks.finisher.rounds > 1
                ? ` — ${plan.blocks.finisher.rounds} rounds`
                : ""}
            </div>
            {fins.map((ex) => {
              const key = `finisher:${ex.name}`;
              return (
                <ExerciseForm
                  key={key}
                  exercise={ex}
                  form={state.exercises[key]}
                  alreadyLogged={state.loggedFromServer.has(ex.name)}
                  onSetField={(idx, field, value) => dispatchField(dispatch, key, idx, field, value)}
                  onSave={() => saveExercise(key, ex.name, true)}
                />
              );
            })}
          </div>
        )}

        <SessionSummaryForm
          state={state}
          onChangeRpe={(v) => dispatch({ type: "set_summary_rpe", value: v })}
          onChangeNotes={(v) => dispatch({ type: "set_summary_notes", value: v })}
          onFinish={saveSummary}
        />
      </div>
    </div>
  );
}

function dispatchField(
  dispatch: React.Dispatch<Action>,
  key: string,
  idx: number,
  field: "reps_done" | "weight_lbs" | "rpe_actual",
  value: number | null,
): void {
  if (field === "reps_done") dispatch({ type: "set_rep", key, idx, value });
  else if (field === "weight_lbs") dispatch({ type: "set_weight", key, idx, value });
  else dispatch({ type: "set_rpe", key, idx, value });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ExerciseForm({
  exercise,
  form,
  alreadyLogged,
  onSetField,
  onSave,
}: {
  exercise: PlannedExercise;
  form: ExerciseFormState | undefined;
  alreadyLogged: boolean;
  onSetField: (idx: number, field: "reps_done" | "weight_lbs" | "rpe_actual", value: number | null) => void;
  onSave: () => void;
}) {
  if (!form) return null;
  const isDone = form.status === "ok" || alreadyLogged;

  return (
    <div className={`log-exercise${isDone ? " log-exercise--done" : ""}`}>
      <div className="log-exercise-head">
        <div className="log-exercise-name">
          {exercise.name}
          {isDone && <span className="log-check"> ✓</span>}
        </div>
        <div className="log-exercise-target tv-mono">
          {exercise.format === "reps"
            ? `target ${exercise.target_reps ?? "?"} reps${
                exercise.target_load_lbs ? ` @ ${exercise.target_load_lbs} lb` : ""
              }`
            : `target ${exercise.duration_sec ?? "?"} sec`}
        </div>
      </div>
      <div className="log-sets">
        {form.sets.map((s, i) => (
          <div className="log-set-row" key={i}>
            <div className="log-set-label">Set {i + 1}</div>
            {exercise.format === "reps" && (
              <NumberInput
                label="lb"
                value={s.weight_lbs ?? null}
                onChange={(v) => onSetField(i, "weight_lbs", v)}
                disabled={isDone}
              />
            )}
            <NumberInput
              label={exercise.format === "reps" ? "reps" : "sec"}
              value={exercise.format === "reps" ? (s.reps_done ?? null) : (s.duration_sec ?? null)}
              onChange={(v) => onSetField(i, "reps_done", v)}
              disabled={isDone}
            />
            <NumberInput
              label="RPE"
              value={s.rpe_actual ?? null}
              onChange={(v) => onSetField(i, "rpe_actual", v)}
              disabled={isDone}
            />
          </div>
        ))}
      </div>
      {form.status === "error" && form.error && (
        <div className="log-error">{form.error} — tap Log to retry</div>
      )}
      <button
        className="control-btn control-btn--primary log-save"
        onClick={onSave}
        disabled={isDone || form.status === "saving"}
      >
        {isDone ? "Logged ✓" : form.status === "saving" ? "Saving…" : "Log exercise"}
      </button>
    </div>
  );
}

function CardioBlockForm({
  blockType,
  form,
  elapsed_sec,
  onChange,
  onSave,
}: {
  blockType: string | undefined;
  form: CardioFormState;
  elapsed_sec: number;
  onChange: (field: keyof LogSetIn, value: number | null) => void;
  onSave: () => void;
}) {
  const isDone = form.status === "ok";
  const b = form.block;
  const elapsedDisplay = Math.round(elapsed_sec);
  return (
    <div className={`log-exercise${isDone ? " log-exercise--done" : ""}`}>
      <div className="log-exercise-head">
        <div className="log-exercise-name">
          Cardio block{isDone && <span className="log-check"> ✓</span>}
        </div>
        <div className="log-exercise-target tv-mono">{blockType ?? "cardio"}</div>
      </div>
      <div className="log-sets">
        <div className="log-set-row">
          <div className="log-set-label">Total</div>
          <NumberInput
            label="sec"
            value={b.duration_sec ?? elapsedDisplay}
            onChange={(v) => onChange("duration_sec", v)}
            disabled={isDone}
          />
          <NumberInput
            label="m"
            value={b.distance_m ?? null}
            onChange={(v) => onChange("distance_m", v)}
            disabled={isDone}
          />
        </div>
        <div className="log-set-row">
          <div className="log-set-label">HR</div>
          <NumberInput
            label="avg"
            value={b.hr_avg ?? null}
            onChange={(v) => onChange("hr_avg", v)}
            disabled={isDone}
          />
          <NumberInput
            label="peak"
            value={b.hr_peak ?? null}
            onChange={(v) => onChange("hr_peak", v)}
            disabled={isDone}
          />
          <NumberInput
            label="RPE"
            value={b.rpe_actual ?? null}
            onChange={(v) => onChange("rpe_actual", v)}
            disabled={isDone}
          />
        </div>
      </div>
      {form.status === "error" && form.error && (
        <div className="log-error">{form.error} — tap Log to retry</div>
      )}
      <button
        className="control-btn control-btn--primary log-save"
        onClick={onSave}
        disabled={isDone || form.status === "saving"}
      >
        {isDone ? "Logged ✓" : form.status === "saving" ? "Saving…" : "Log cardio"}
      </button>
    </div>
  );
}

function SessionSummaryForm({
  state,
  onChangeRpe,
  onChangeNotes,
  onFinish,
}: {
  state: State;
  onChangeRpe: (v: number | null) => void;
  onChangeNotes: (v: string) => void;
  onFinish: () => void;
}) {
  const s = state.summary;
  const isDone = s.status === "ok" || state.hasSummary;
  return (
    <div className={`log-exercise log-summary${isDone ? " log-exercise--done" : ""}`}>
      <div className="log-exercise-head">
        <div className="log-exercise-name">
          Session summary{isDone && <span className="log-check"> ✓</span>}
        </div>
      </div>
      <div className="log-sets">
        <div className="log-set-row">
          <div className="log-set-label">Overall</div>
          <NumberInput
            label="RPE"
            value={s.rpe_actual}
            onChange={onChangeRpe}
            disabled={isDone}
          />
        </div>
        <div className="log-notes-row">
          <textarea
            className="log-notes"
            placeholder="Notes (optional)"
            value={s.notes}
            onChange={(e) => onChangeNotes(e.target.value)}
            disabled={isDone}
          />
        </div>
      </div>
      {s.status === "error" && s.error && (
        <div className="log-error">{s.error} — tap Finish to retry</div>
      )}
      <button
        className="control-btn control-btn--primary log-save log-finish"
        onClick={onFinish}
        disabled={isDone || s.status === "saving"}
      >
        {isDone ? "Workout finished ✓" : s.status === "saving" ? "Saving…" : "Finish workout"}
      </button>
    </div>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  disabled?: boolean;
}) {
  return (
    <label className="log-input">
      <span className="log-input-label">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        step="0.5"
        value={value ?? ""}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") onChange(null);
          else {
            const n = Number(raw);
            onChange(Number.isFinite(n) ? n : null);
          }
        }}
        disabled={disabled}
      />
    </label>
  );
}
