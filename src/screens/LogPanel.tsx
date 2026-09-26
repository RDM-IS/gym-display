import { useReducer } from "react";
import Stepper from "../components/Stepper";
import RpeChips from "../components/RpeChips";
import NotesField from "../components/NotesField";
import InlineExerciseLogger from "../components/InlineExerciseLogger";
import CardioFinishCard from "../components/CardioFinishCard";
import { cardioExerciseName, isCardioPlan } from "../lib/cardio-finish";
import { submitLog } from "../lib/log-queue";
import { displayTitle, formatPlanDate } from "../lib/format";
import {
  computePrefill,
  isFullyLogged,
  loggedCountFor,
  nextSetNumFor,
  totalSetsFor,
  type ServerLoggedCount,
  type SessionSets,
  type SetEntry,
} from "../lib/log-state";
import type {
  Blocks,
  Finisher,
  LastLoggedEntry,
  LogExerciseIn,
  Plan,
  PlannedExercise,
} from "../lib/types";

// ---------------------------------------------------------------------------
// Per-set LogPanel (full-screen overlay, opened from "⋯ More → All sets").
//
// Each exercise renders a SINGLE InlineExerciseLogger card showing the next
// unlogged set. The rest-step logger and this overlay write through the same
// queue with the same set_num computation, so writes stay consistent.
// ---------------------------------------------------------------------------

type Status = "idle" | "saving" | "ok" | "error";

interface CardioFormState {
  duration_sec: number | null;
  distance_m: number | null;
  hr_avg: number | null;
  hr_peak: number | null;
  rpe: number | null;
  status: Status;
  error: string | null;
}

interface SummaryFormState {
  rpe: number | null;
  notes: string;
  status: Status;
  error: string | null;
}

interface State {
  cardio: CardioFormState | null;
  summary: SummaryFormState;
}

type Action =
  | { type: "set_cardio_field"; field: keyof Omit<CardioFormState, "status" | "error">; value: number | null }
  | { type: "cardio_save_start" }
  | { type: "cardio_save_ok" }
  | { type: "cardio_save_err"; message: string }
  | { type: "set_summary_rpe"; value: number | null }
  | { type: "set_summary_notes"; value: string }
  | { type: "summary_save_start" }
  | { type: "summary_save_ok" }
  | { type: "summary_save_err"; message: string };

function buildInitial(plan: Plan): State {
  const t = plan.blocks?.type;
  const cardio: CardioFormState | null =
    t === "steady" || t === "intervals" || t === "walk"
      ? { duration_sec: null, distance_m: null, hr_avg: null, hr_peak: null, rpe: null, status: "idle", error: null }
      : null;
  return {
    cardio,
    summary: { rpe: null, notes: "", status: "idle", error: null },
  };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "set_cardio_field":
      if (!state.cardio) return state;
      return { ...state, cardio: { ...state.cardio, [action.field]: action.value, status: "idle", error: null } };
    case "cardio_save_start":
      return state.cardio ? { ...state, cardio: { ...state.cardio, status: "saving", error: null } } : state;
    case "cardio_save_ok":
      return state.cardio ? { ...state, cardio: { ...state.cardio, status: "ok", error: null } } : state;
    case "cardio_save_err":
      return state.cardio ? { ...state, cardio: { ...state.cardio, status: "error", error: action.message } } : state;
    case "set_summary_rpe":
      return { ...state, summary: { ...state.summary, rpe: action.value, status: "idle", error: null } };
    case "set_summary_notes":
      return { ...state, summary: { ...state.summary, notes: action.value, status: "idle", error: null } };
    case "summary_save_start":
      return { ...state, summary: { ...state.summary, status: "saving", error: null } };
    case "summary_save_ok":
      return { ...state, summary: { ...state.summary, status: "ok", error: null } };
    case "summary_save_err":
      return { ...state, summary: { ...state.summary, status: "error", error: action.message } };
  }
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

interface Props {
  plan: Plan;
  elapsed_sec: number;
  sessionSets: SessionSets;
  serverLoggedCount: ServerLoggedCount;
  lastLogged: Record<string, LastLoggedEntry>;
  hasSummary: boolean;
  onLoggedSet: (exerciseName: string, set: SetEntry) => void;
  onSummaryLogged: () => void;
  onBackToTimer: () => void;
  onFinish: () => void;
}

export default function LogPanel({
  plan,
  elapsed_sec,
  sessionSets,
  serverLoggedCount,
  lastLogged,
  hasSummary,
  onLoggedSet,
  onSummaryLogged,
  onBackToTimer,
  onFinish,
}: Props) {
  const [state, dispatch] = useReducer(reducer, plan, buildInitial);

  async function saveCardio() {
    if (!state.cardio) return;
    dispatch({ type: "cardio_save_start" });
    const c = state.cardio;
    // CARDIO-LOC: the log records WHAT IT WAS DONE ON, from the row's resolved
    // cardio. Without this the modality is only a display name, and rowing
    // cannot be told from a substitute when the baseline is computed.
    const resolved = plan.blocks?.type === "steady" ? plan.blocks.cardio ?? null : null;
    const body: LogExerciseIn = {
      plan_id: plan.plan_id,
      exercise: plan.blocks?.display_name ?? displayTitle(plan),
      modality: resolved?.modality ?? null,
      device: resolved?.device ?? null,
      log_type: "cardio_block",
      sets: [{
        duration_sec: c.duration_sec ?? Math.round(elapsed_sec),
        distance_m: c.distance_m ?? null,
        hr_avg: c.hr_avg ?? null,
        hr_peak: c.hr_peak ?? null,
        rpe_actual: c.rpe ?? null,
      }],
    };
    const r = await submitLog(body);
    if (r.status === "error") dispatch({ type: "cardio_save_err", message: r.message });
    else dispatch({ type: "cardio_save_ok" });
  }

  async function saveSummary() {
    dispatch({ type: "summary_save_start" });
    const body: LogExerciseIn = {
      plan_id: plan.plan_id,
      log_type: "session_summary",
      sets: [{ rpe_actual: state.summary.rpe ?? null }],
      notes: state.summary.notes.trim() || null,
    };
    const r = await submitLog(body);
    if (r.status === "error") {
      dispatch({ type: "summary_save_err", message: r.message });
      return;
    }
    dispatch({ type: "summary_save_ok" });
    onSummaryLogged();
    onFinish();
  }

  const mains = mainExercises(plan.blocks);
  // CARDIO-REQUIRED: a cardio row with no block yet can only finish with one.
  const cardioOwed = isCardioPlan(plan)
    && loggedCountFor(cardioExerciseName(plan), sessionSets, serverLoggedCount) === 0;
  const fins = finisherExercises(plan.blocks?.finisher);
  const blockType = plan.blocks?.type;

  return (
    <div className="log-panel" role="dialog" aria-modal="true" aria-label="Log sets">
      <div className="log-top">
        <button type="button" className="btn" onClick={onBackToTimer} aria-label="Back to timer">
          ◀ Timer
        </button>
        <div className="log-title">{displayTitle(plan)}</div>
        <div className="log-meta mono">{formatPlanDate(plan)}</div>
      </div>

      <div className="log-scroll">
        {state.cardio && !isCardioPlan(plan) && (
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
              <PerSetCard
                key={ex.name}
                exercise={ex}
                plan={plan}
                sessionSets={sessionSets}
                serverLoggedCount={serverLoggedCount}
                lastLogged={lastLogged}
                onLoggedSet={onLoggedSet}
              />
            ))}
          </Section>
        )}

        {fins.length > 0 && (
          <Section
            title={`Finisher${plan.blocks?.finisher?.rounds && plan.blocks.finisher.rounds > 1
              ? ` — ${plan.blocks.finisher.rounds} rounds` : ""}`}
          >
            {fins.map((ex) => (
              <PerSetCard
                key={`finisher:${ex.name}`}
                exercise={ex}
                plan={plan}
                sessionSets={sessionSets}
                serverLoggedCount={serverLoggedCount}
                lastLogged={lastLogged}
                isFinisher
                onLoggedSet={onLoggedSet}
              />
            ))}
          </Section>
        )}

        {cardioOwed ? (
          // CARDIO-REQUIRED: a cardio row finishes only with its block.
          <CardioFinishCard
            plan={plan}
            elapsed_sec={elapsed_sec}
            hasSummary={hasSummary}
            onLoggedSet={onLoggedSet}
            onSummaryLogged={onSummaryLogged}
            onFinished={onFinish}
          />
        ) : (
        <SummaryCard
          state={state}
          hasSummary={hasSummary}
          onRpe={(v) => dispatch({ type: "set_summary_rpe", value: v })}
          onNotes={(v) => dispatch({ type: "set_summary_notes", value: v })}
          onFinish={saveSummary}
        />
        )}
      </div>
    </div>
  );
}

function PerSetCard({
  exercise,
  plan,
  sessionSets,
  serverLoggedCount,
  lastLogged,
  isFinisher,
  onLoggedSet,
}: {
  exercise: PlannedExercise;
  plan: Plan;
  sessionSets: SessionSets;
  serverLoggedCount: ServerLoggedCount;
  lastLogged: Record<string, LastLoggedEntry>;
  isFinisher?: boolean;
  onLoggedSet: (exerciseName: string, set: SetEntry) => void;
}) {
  const total = totalSetsFor(plan, exercise.name);
  const setNum = nextSetNumFor(exercise.name, sessionSets, serverLoggedCount);
  const fullyLogged = isFullyLogged(exercise.name, plan, sessionSets, serverLoggedCount);
  const loggedSoFar = loggedCountFor(exercise.name, sessionSets, serverLoggedCount);
  const lastHint = lastLogged[exercise.name] ?? null;
  const prefill = computePrefill(
    exercise.name,
    exercise.format,
    exercise.target_load_lbs ?? null,
    exercise.target_reps ?? null,
    exercise.duration_sec ?? null,
    sessionSets,
    lastHint,
    exercise.load_from != null,
  );

  return (
    <div className="log-stack">
      {loggedSoFar > 0 && !fullyLogged && (
        <div className="log-progress" aria-label="partial completion">
          Logged so far: {loggedSoFar} of {total}
        </div>
      )}
      <InlineExerciseLogger
        // Remount when the next set comes up so state re-initialises from prefill.
        key={`${exercise.name}#${setNum}#${fullyLogged ? "done" : "open"}`}
        exercise={exercise}
        plan_id={plan.plan_id}
        loadConfig={plan.blocks?.load_config}
        week_num={plan.week_num}
        set_num={Math.min(setNum, total)}
        total_sets={total}
        prefill={prefill}
        lastHint={lastHint}
        alreadyFullyLogged={fullyLogged}
        isFinisher={isFinisher}
        onLoggedSet={onLoggedSet}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="log-section">
      <div className="log-section-title">{title}</div>
      {children}
    </div>
  );
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
  onField: (field: keyof Omit<CardioFormState, "status" | "error">, value: number | null) => void;
  onSave: () => void;
}) {
  const isDone = form.status === "ok";
  const elapsedDisplay = Math.round(elapsed_sec);
  return (
    <div className={`log-card${isDone ? " log-card--done" : ""}`}>
      <div className="log-card-head">
        <div className="log-card-name">Cardio block{isDone && <span className="log-check"> ✓</span>}</div>
        <div className="log-card-target mono">{blockType ?? "cardio"}</div>
      </div>
      <div className="log-steppers">
        <Stepper label="Duration" unit="sec" value={form.duration_sec} step={60} min={0}
          blankStart={elapsedDisplay} disabled={isDone}
          onChange={(v) => onField("duration_sec", v)} />
        <Stepper label="Distance" unit="m" value={form.distance_m} step={100} min={0}
          blankStart={0} disabled={isDone}
          onChange={(v) => onField("distance_m", v)} />
        <Stepper label="HR avg" value={form.hr_avg} step={1} min={0} max={250}
          blankStart={130} disabled={isDone}
          onChange={(v) => onField("hr_avg", v)} />
        <Stepper label="HR peak" value={form.hr_peak} step={1} min={0} max={250}
          blankStart={150} disabled={isDone}
          onChange={(v) => onField("hr_peak", v)} />
      </div>
      <RpeChips value={form.rpe} disabled={isDone} onChange={(v) => onField("rpe", v)} />
      {form.status === "error" && form.error && <div className="log-error">{form.error}</div>}
      <button className="log-save" type="button" onClick={onSave}
        disabled={isDone || form.status === "saving"} aria-label="Log cardio">
        {isDone ? "Logged ✓" : form.status === "saving" ? "Saving…" : "Log cardio"}
      </button>
    </div>
  );
}

function SummaryCard({
  state,
  hasSummary,
  onRpe,
  onNotes,
  onFinish,
}: {
  state: State;
  hasSummary: boolean;
  onRpe: (v: number | null) => void;
  onNotes: (v: string) => void;
  onFinish: () => void;
}) {
  const s = state.summary;
  const isDone = s.status === "ok" || hasSummary;
  return (
    <div className={`log-card log-summary${isDone ? " log-card--done" : ""}`}>
      <div className="log-card-head">
        <div className="log-card-name">
          Session summary{isDone && <span className="log-check"> ✓</span>}
        </div>
      </div>
      <RpeChips label="Overall RPE" value={s.rpe} disabled={isDone} onChange={onRpe} />
      <NotesField value={s.notes} onChange={onNotes} disabled={isDone} />
      {s.status === "error" && s.error && <div className="log-error">{s.error}</div>}
      <button className="log-save log-finish" type="button" onClick={onFinish}
        disabled={isDone || s.status === "saving"} aria-label="Finish workout">
        {isDone ? "Workout finished ✓" : s.status === "saving" ? "Saving…" : "Finish workout"}
      </button>
    </div>
  );
}
