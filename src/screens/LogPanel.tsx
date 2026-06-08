import { useEffect, useMemo, useReducer, useState } from "react";
import Stepper from "../components/Stepper";
import { fetchLastLogged, fetchLoggedToday, postLog } from "../lib/api";
import { displayTitle, formatPlanDate } from "../lib/format";
import { weightStepFor } from "../lib/weight-step";
import type {
  Blocks,
  Finisher,
  LastLoggedEntry,
  LogExerciseIn,
  LogSetIn,
  LoggedExerciseEntry,
  Plan,
  PlannedExercise,
} from "../lib/types";

// ---------------------------------------------------------------------------
// Card model — "simple" (one stepper triple applies to all rounds)
//             vs "expanded" (per-set steppers).
// ---------------------------------------------------------------------------

type Status = "idle" | "saving" | "ok" | "error";

interface ExerciseFormState {
  rounds: number;
  mode: "simple" | "expanded";
  /** Simple mode value (applied to all rounds on submit). */
  simple: { weight: number | null; reps: number | null; rpe: number | null };
  /** Per-set values (used in expanded mode). Always length = rounds. */
  perSet: Array<{ weight: number | null; reps: number | null; rpe: number | null }>;
  status: Status;
  error: string | null;
  /** Pre-fill source for hints + initial values. */
  last: LastLoggedEntry | null;
}

interface CardioFormState {
  duration_sec: number | null;
  distance_m: number | null;
  hr_avg: number | null;
  hr_peak: number | null;
  rpe: number | null;
  status: Status;
  error: string | null;
  last: LastLoggedEntry | null;
}

interface State {
  exercises: Record<string, ExerciseFormState>;
  cardio: CardioFormState | null;
  loggedFromServer: Set<string>;
  hasSummary: boolean;
  summary: { rpe: number | null; notes: string; status: Status; error: string | null };
  hydrated: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function finisherRounds(f: Finisher | null | undefined): number {
  return Math.max(1, f?.rounds ?? 1);
}

function blankExerciseForm(ex: PlannedExercise, rounds: number): ExerciseFormState {
  const n = Math.max(1, rounds);
  const simple = {
    weight: ex.target_load_lbs ?? null,
    reps: ex.format === "reps" ? ex.target_reps ?? null : null,
    rpe: null as number | null,
  };
  return {
    rounds: n,
    mode: "simple",
    simple,
    perSet: Array.from({ length: n }, () => ({ ...simple })),
    status: "idle",
    error: null,
    last: null,
  };
}

function buildInitialState(plan: Plan): State {
  const exercises: Record<string, ExerciseFormState> = {};
  const rMain = circuitRounds(plan.blocks);
  for (const ex of mainExercises(plan.blocks)) {
    exercises[ex.name] = blankExerciseForm(ex, rMain);
  }
  const rFin = finisherRounds(plan.blocks?.finisher);
  for (const ex of finisherExercises(plan.blocks?.finisher)) {
    exercises[`finisher:${ex.name}`] = blankExerciseForm(ex, rFin);
  }
  const t = plan.blocks?.type;
  const cardio: CardioFormState | null =
    t === "steady" || t === "intervals" || t === "walk"
      ? {
          duration_sec: null,
          distance_m: null,
          hr_avg: null,
          hr_peak: null,
          rpe: null,
          status: "idle",
          error: null,
          last: null,
        }
      : null;
  return {
    exercises,
    cardio,
    loggedFromServer: new Set(),
    hasSummary: false,
    summary: { rpe: null, notes: "", status: "idle", error: null },
    hydrated: false,
  };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

type Field = "weight" | "reps" | "rpe";

type Action =
  | { type: "set_simple"; key: string; field: Field; value: number | null }
  | { type: "set_perset"; key: string; idx: number; field: Field; value: number | null }
  | { type: "toggle_expand"; key: string }
  | { type: "save_start"; key: string }
  | { type: "save_ok"; key: string }
  | { type: "save_err"; key: string; message: string }
  | { type: "set_cardio_field"; field: keyof Omit<CardioFormState, "status" | "error" | "last">; value: number | null }
  | { type: "cardio_save_start" }
  | { type: "cardio_save_ok" }
  | { type: "cardio_save_err"; message: string }
  | { type: "set_summary_rpe"; value: number | null }
  | { type: "set_summary_notes"; value: string }
  | { type: "summary_save_start" }
  | { type: "summary_save_ok" }
  | { type: "summary_save_err"; message: string }
  | { type: "hydrate";
      logged: LoggedExerciseEntry[];
      hasSummary: boolean;
      lastByExercise: Record<string, LastLoggedEntry>;
    };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "set_simple": {
      const f = state.exercises[action.key];
      if (!f) return state;
      const simple = { ...f.simple, [action.field]: action.value };
      // Keep per-set in sync as the user edits the simple triple
      const perSet = f.perSet.map(() => ({ ...simple }));
      return {
        ...state,
        exercises: { ...state.exercises, [action.key]: { ...f, simple, perSet, status: "idle", error: null } },
      };
    }
    case "set_perset": {
      const f = state.exercises[action.key];
      if (!f) return state;
      const perSet = f.perSet.map((s, i) =>
        i === action.idx ? { ...s, [action.field]: action.value } : s
      );
      return {
        ...state,
        exercises: { ...state.exercises, [action.key]: { ...f, perSet, status: "idle", error: null } },
      };
    }
    case "toggle_expand": {
      const f = state.exercises[action.key];
      if (!f) return state;
      const nextMode = f.mode === "simple" ? "expanded" : "simple";
      // When collapsing, snap perSet back to the simple triple so the next
      // POST sends what's visible.
      const perSet =
        nextMode === "simple" ? f.perSet.map(() => ({ ...f.simple })) : f.perSet;
      return {
        ...state,
        exercises: { ...state.exercises, [action.key]: { ...f, mode: nextMode, perSet } },
      };
    }
    case "save_start":  return mut(state, action.key, (f) => ({ ...f, status: "saving", error: null }));
    case "save_ok":     return mut(state, action.key, (f) => ({ ...f, status: "ok", error: null }));
    case "save_err":    return mut(state, action.key, (f) => ({ ...f, status: "error", error: action.message }));
    case "set_cardio_field": {
      if (!state.cardio) return state;
      return { ...state, cardio: { ...state.cardio, [action.field]: action.value, status: "idle", error: null } };
    }
    case "cardio_save_start": return state.cardio ? { ...state, cardio: { ...state.cardio, status: "saving", error: null } } : state;
    case "cardio_save_ok":    return state.cardio ? { ...state, cardio: { ...state.cardio, status: "ok", error: null } } : state;
    case "cardio_save_err":   return state.cardio ? { ...state, cardio: { ...state.cardio, status: "error", error: action.message } } : state;
    case "set_summary_rpe":   return { ...state, summary: { ...state.summary, rpe: action.value, status: "idle", error: null } };
    case "set_summary_notes": return { ...state, summary: { ...state.summary, notes: action.value, status: "idle", error: null } };
    case "summary_save_start": return { ...state, summary: { ...state.summary, status: "saving", error: null } };
    case "summary_save_ok":    return { ...state, summary: { ...state.summary, status: "ok", error: null }, hasSummary: true };
    case "summary_save_err":   return { ...state, summary: { ...state.summary, status: "error", error: action.message } };
    case "hydrate": {
      const fromServer = new Set<string>(action.logged.map((e) => e.exercise));
      // Pre-fill defaults from last_logged. Lookup tries both raw exercise
      // name and the finisher: prefix.
      const exercises = { ...state.exercises };
      for (const [key, form] of Object.entries(exercises)) {
        const rawName = key.startsWith("finisher:") ? key.slice("finisher:".length) : key;
        const last = action.lastByExercise[rawName] ?? null;
        if (last) {
          const simple = {
            weight: last.weight_lbs ?? form.simple.weight,
            reps: last.reps_done ?? form.simple.reps,
            rpe: form.simple.rpe, // never override last RPE — user enters fresh
          };
          exercises[key] = {
            ...form,
            simple,
            perSet: form.perSet.map(() => ({ ...simple })),
            last,
          };
        }
      }
      const cardio = state.cardio;
      return {
        ...state,
        exercises,
        cardio,
        loggedFromServer: fromServer,
        hasSummary: action.hasSummary,
        hydrated: true,
      };
    }
  }
}

function mut(state: State, key: string, fn: (f: ExerciseFormState) => ExerciseFormState): State {
  const f = state.exercises[key];
  if (!f) return state;
  return { ...state, exercises: { ...state.exercises, [key]: fn(f) } };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  plan: Plan;
  elapsed_sec: number;
  onBackToTimer: () => void;
  onFinish: () => void;
}

export default function LogPanel({ plan, elapsed_sec, onBackToTimer, onFinish }: Props) {
  const initial = useMemo(() => buildInitialState(plan), [plan]);
  const [state, dispatch] = useReducer(reducer, initial);
  const [loading, setLoading] = useState(true);

  // Pre-fetch logged state + last-logged for every named exercise
  useEffect(() => {
    let cancelled = false;
    const names = [
      ...mainExercises(plan.blocks).map((e) => e.name),
      ...finisherExercises(plan.blocks?.finisher).map((e) => e.name),
    ];
    (async () => {
      const [loggedR, lastR] = await Promise.all([
        fetchLoggedToday(),
        fetchLastLogged(names),
      ]);
      if (cancelled) return;
      dispatch({
        type: "hydrate",
        logged: loggedR.status === "ok" ? loggedR.data.exercises : [],
        hasSummary: loggedR.status === "ok" ? loggedR.data.has_session_summary : false,
        lastByExercise: lastR.status === "ok" ? lastR.data.by_exercise : {},
      });
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [plan]);

  async function saveExercise(key: string, exerciseName: string, isFinisher: boolean) {
    const form = state.exercises[key];
    if (!form) return;
    dispatch({ type: "save_start", key });
    const sets: LogSetIn[] = (form.mode === "expanded" ? form.perSet : form.perSet).map((s, i) => ({
      set_num: i + 1,
      reps_done: s.reps ?? null,
      weight_lbs: s.weight ?? null,
      rpe_actual: s.rpe ?? null,
    }));
    const body: LogExerciseIn = {
      plan_id: plan.plan_id,
      exercise: exerciseName,
      log_type: "strength_set",
      sets,
      notes: isFinisher ? "finisher" : null,
    };
    const r = await postLog(body);
    if (r.status === "ok") dispatch({ type: "save_ok", key });
    else dispatch({ type: "save_err", key, message: r.message });
  }

  async function saveCardio() {
    if (!state.cardio) return;
    dispatch({ type: "cardio_save_start" });
    const c = state.cardio;
    const body: LogExerciseIn = {
      plan_id: plan.plan_id,
      exercise: plan.blocks?.display_name ?? displayTitle(plan),
      log_type: "cardio_block",
      sets: [{
        duration_sec: c.duration_sec ?? Math.round(elapsed_sec),
        distance_m: c.distance_m ?? null,
        hr_avg: c.hr_avg ?? null,
        hr_peak: c.hr_peak ?? null,
        rpe_actual: c.rpe ?? null,
      }],
    };
    const r = await postLog(body);
    if (r.status === "ok") dispatch({ type: "cardio_save_ok" });
    else dispatch({ type: "cardio_save_err", message: r.message });
  }

  async function saveSummary() {
    dispatch({ type: "summary_save_start" });
    const body: LogExerciseIn = {
      plan_id: plan.plan_id,
      log_type: "session_summary",
      sets: [{ rpe_actual: state.summary.rpe ?? null }],
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

        {state.cardio && (
          <CardioCard
            blockType={blockType}
            form={state.cardio}
            elapsed_sec={elapsed_sec}
            onField={(field, value) => dispatch({ type: "set_cardio_field", field, value })}
            onSave={saveCardio}
          />
        )}

        {mains.length > 0 && (
          <Section title="Main">
            {mains.map((ex) => (
              <ExerciseCard
                key={ex.name}
                exercise={ex}
                form={state.exercises[ex.name]}
                alreadyLoggedOnServer={state.loggedFromServer.has(ex.name)}
                onSimple={(field, value) => dispatch({ type: "set_simple", key: ex.name, field, value })}
                onPerSet={(idx, field, value) => dispatch({ type: "set_perset", key: ex.name, idx, field, value })}
                onToggleExpand={() => dispatch({ type: "toggle_expand", key: ex.name })}
                onSave={() => saveExercise(ex.name, ex.name, false)}
              />
            ))}
          </Section>
        )}

        {fins.length > 0 && (
          <Section title={`Finisher${plan.blocks?.finisher?.rounds && plan.blocks.finisher.rounds > 1
            ? ` — ${plan.blocks.finisher.rounds} rounds` : ""}`}>
            {fins.map((ex) => {
              const key = `finisher:${ex.name}`;
              return (
                <ExerciseCard
                  key={key}
                  exercise={ex}
                  form={state.exercises[key]}
                  alreadyLoggedOnServer={state.loggedFromServer.has(ex.name)}
                  onSimple={(field, value) => dispatch({ type: "set_simple", key, field, value })}
                  onPerSet={(idx, field, value) => dispatch({ type: "set_perset", key, idx, field, value })}
                  onToggleExpand={() => dispatch({ type: "toggle_expand", key })}
                  onSave={() => saveExercise(key, ex.name, true)}
                />
              );
            })}
          </Section>
        )}

        <SummaryCard
          state={state}
          onRpe={(v) => dispatch({ type: "set_summary_rpe", value: v })}
          onNotes={(v) => dispatch({ type: "set_summary_notes", value: v })}
          onFinish={saveSummary}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card components
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="log-section">
      <div className="log-section-title">{title}</div>
      {children}
    </div>
  );
}

function ExerciseCard({
  exercise,
  form,
  alreadyLoggedOnServer,
  onSimple,
  onPerSet,
  onToggleExpand,
  onSave,
}: {
  exercise: PlannedExercise;
  form: ExerciseFormState | undefined;
  alreadyLoggedOnServer: boolean;
  onSimple: (field: Field, value: number | null) => void;
  onPerSet: (idx: number, field: Field, value: number | null) => void;
  onToggleExpand: () => void;
  onSave: () => void;
}) {
  if (!form) return null;
  const isDone = form.status === "ok" || alreadyLoggedOnServer;
  const w = weightStepFor(exercise);
  const useReps = exercise.format === "reps";
  const lastWeight = form.last?.weight_lbs ?? null;
  const lastReps = form.last?.reps_done ?? null;

  return (
    <div className={`log-card${isDone ? " log-card--done" : ""}`}>
      <div className="log-card-head">
        <div className="log-card-name">
          {exercise.name}
          {isDone && <span className="log-check"> ✓</span>}
        </div>
        <div className="log-card-target tv-mono">
          {useReps
            ? `target ${exercise.target_reps ?? "?"} ${exercise.target_load_lbs ? `@ ${exercise.target_load_lbs} lb` : ""}`
            : `target ${exercise.duration_sec ?? "?"} sec`}
        </div>
      </div>

      {form.mode === "simple" ? (
        <div className="log-steppers">
          {!w.isBodyweight && useReps && (
            <Stepper
              label="Weight"
              unit="lb"
              value={form.simple.weight}
              step={w.step}
              min={0}
              blankStart={exercise.target_load_lbs ?? 0}
              hint={lastWeight}
              disabled={isDone}
              onChange={(v) => onSimple("weight", v)}
            />
          )}
          <Stepper
            label={useReps ? "Reps" : "Seconds"}
            value={form.simple.reps}
            step={useReps ? 1 : 5}
            min={0}
            blankStart={useReps ? (exercise.target_reps ?? 0) : (exercise.duration_sec ?? 0)}
            hint={lastReps}
            disabled={isDone}
            onChange={(v) => onSimple("reps", v)}
          />
          <Stepper
            label="RPE"
            value={form.simple.rpe}
            step={1}
            min={1}
            max={10}
            blankStart={7}
            disabled={isDone}
            onChange={(v) => onSimple("rpe", v)}
          />
        </div>
      ) : (
        <div className="log-per-set">
          {form.perSet.map((s, i) => (
            <div className="log-per-set-row" key={i}>
              <div className="log-per-set-label">Set {i + 1}</div>
              {!w.isBodyweight && useReps && (
                <Stepper
                  label="Wt"
                  unit="lb"
                  value={s.weight}
                  step={w.step}
                  min={0}
                  blankStart={form.simple.weight ?? exercise.target_load_lbs ?? 0}
                  disabled={isDone}
                  onChange={(v) => onPerSet(i, "weight", v)}
                />
              )}
              <Stepper
                label={useReps ? "Reps" : "Sec"}
                value={s.reps}
                step={useReps ? 1 : 5}
                min={0}
                blankStart={form.simple.reps ?? (useReps ? exercise.target_reps ?? 0 : exercise.duration_sec ?? 0)}
                disabled={isDone}
                onChange={(v) => onPerSet(i, "reps", v)}
              />
              <Stepper
                label="RPE"
                value={s.rpe}
                step={1}
                min={1}
                max={10}
                blankStart={form.simple.rpe ?? 7}
                disabled={isDone}
                onChange={(v) => onPerSet(i, "rpe", v)}
              />
            </div>
          ))}
        </div>
      )}

      <div className="log-card-foot">
        <button
          className="log-expand-toggle"
          type="button"
          onClick={onToggleExpand}
          disabled={isDone || form.rounds <= 1}
        >
          {form.rounds <= 1
            ? "1 set"
            : form.mode === "simple"
            ? `Sets: ${form.rounds} (same for all) ▼`
            : `Sets: per-set ▲`}
        </button>
        {form.status === "error" && form.error && (
          <div className="log-error">{form.error}</div>
        )}
        <button
          className="log-save"
          type="button"
          onClick={onSave}
          disabled={isDone || form.status === "saving"}
          aria-label={`Log ${exercise.name}`}
        >
          {isDone
            ? "Logged ✓"
            : form.status === "saving"
            ? "Saving…"
            : logButtonLabel(form, useReps, w.isBodyweight)}
        </button>
      </div>
    </div>
  );
}

function logButtonLabel(form: ExerciseFormState, useReps: boolean, isBw: boolean): string {
  const { weight, reps, rpe } = form.simple;
  const parts: string[] = [];
  if (form.rounds > 1) parts.push(`${form.rounds} ×`);
  if (!isBw && useReps && weight != null) parts.push(`${prettyN(weight)}lb`);
  if (reps != null) parts.push(useReps ? `${reps} reps` : `${reps}s`);
  if (rpe != null) parts.push(`@RPE ${prettyN(rpe)}`);
  return parts.length > 0 ? `Log ${parts.join(" ")}` : "Log";
}

function prettyN(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}

function CardioCard({
  blockType,
  form,
  elapsed_sec,
  onField,
  onSave,
}: {
  blockType: string | undefined;
  form: CardioFormState;
  elapsed_sec: number;
  onField: (field: keyof Omit<CardioFormState, "status" | "error" | "last">, value: number | null) => void;
  onSave: () => void;
}) {
  const isDone = form.status === "ok";
  const elapsedDisplay = Math.round(elapsed_sec);
  return (
    <div className={`log-card${isDone ? " log-card--done" : ""}`}>
      <div className="log-card-head">
        <div className="log-card-name">Cardio block{isDone && <span className="log-check"> ✓</span>}</div>
        <div className="log-card-target tv-mono">{blockType ?? "cardio"}</div>
      </div>
      <div className="log-steppers">
        <Stepper
          label="Duration"
          unit="sec"
          value={form.duration_sec}
          step={60}
          min={0}
          blankStart={elapsedDisplay}
          disabled={isDone}
          onChange={(v) => onField("duration_sec", v)}
        />
        <Stepper
          label="Distance"
          unit="m"
          value={form.distance_m}
          step={100}
          min={0}
          blankStart={0}
          disabled={isDone}
          onChange={(v) => onField("distance_m", v)}
        />
        <Stepper
          label="HR avg"
          value={form.hr_avg}
          step={1}
          min={0}
          max={250}
          blankStart={130}
          disabled={isDone}
          onChange={(v) => onField("hr_avg", v)}
        />
        <Stepper
          label="HR peak"
          value={form.hr_peak}
          step={1}
          min={0}
          max={250}
          blankStart={150}
          disabled={isDone}
          onChange={(v) => onField("hr_peak", v)}
        />
        <Stepper
          label="RPE"
          value={form.rpe}
          step={1}
          min={1}
          max={10}
          blankStart={6}
          disabled={isDone}
          onChange={(v) => onField("rpe", v)}
        />
      </div>
      <div className="log-card-foot">
        <span />
        {form.status === "error" && form.error && (
          <div className="log-error">{form.error}</div>
        )}
        <button
          className="log-save"
          type="button"
          onClick={onSave}
          disabled={isDone || form.status === "saving"}
          aria-label="Log cardio"
        >
          {isDone ? "Logged ✓" : form.status === "saving" ? "Saving…" : "Log cardio"}
        </button>
      </div>
    </div>
  );
}

function SummaryCard({
  state,
  onRpe,
  onNotes,
  onFinish,
}: {
  state: State;
  onRpe: (v: number | null) => void;
  onNotes: (v: string) => void;
  onFinish: () => void;
}) {
  const s = state.summary;
  const isDone = s.status === "ok" || state.hasSummary;
  return (
    <div className={`log-card log-summary${isDone ? " log-card--done" : ""}`}>
      <div className="log-card-head">
        <div className="log-card-name">Session summary{isDone && <span className="log-check"> ✓</span>}</div>
      </div>
      <div className="log-steppers">
        <Stepper
          label="Overall RPE"
          value={s.rpe}
          step={1}
          min={1}
          max={10}
          blankStart={7}
          disabled={isDone}
          onChange={onRpe}
        />
      </div>
      <textarea
        className="log-notes"
        placeholder="Notes (optional)"
        value={s.notes}
        onChange={(e) => onNotes(e.target.value)}
        disabled={isDone}
      />
      <div className="log-card-foot">
        <span />
        {s.status === "error" && s.error && (
          <div className="log-error">{s.error}</div>
        )}
        <button
          className="log-save log-finish"
          type="button"
          onClick={onFinish}
          disabled={isDone || s.status === "saving"}
          aria-label="Finish workout"
        >
          {isDone
            ? "Workout finished ✓"
            : s.status === "saving"
            ? "Saving…"
            : "Finish workout"}
        </button>
      </div>
    </div>
  );
}
