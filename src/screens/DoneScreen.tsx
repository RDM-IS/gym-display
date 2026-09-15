import { useMemo, useReducer } from "react";
import InlineExerciseLogger from "../components/InlineExerciseLogger";
import RpeChips from "../components/RpeChips";
import NotesField from "../components/NotesField";
import { submitLog } from "../lib/log-queue";
import { formatMMSS } from "../lib/timer";
import {
  computePrefill,
  loggedCountFor,
  totalSetsFor,
  type ServerLoggedCount,
  type SessionSets,
  type SetEntry,
} from "../lib/log-state";
import type {
  LastLoggedEntry,
  LogExerciseIn,
  Plan,
  PlannedExercise,
} from "../lib/types";

interface Props {
  plan: Plan;
  total_elapsed_sec: number;
  sessionSets: SessionSets;
  serverLoggedCount: ServerLoggedCount;
  lastLogged: Record<string, LastLoggedEntry>;
  hasSummary: boolean;
  onLoggedSet: (exerciseName: string, set: SetEntry) => void;
  onSummaryLogged: () => void;
  onBack: () => void;
}

interface UnloggedSlot {
  exercise: PlannedExercise;
  set_num: number;
  total_sets: number;
  is_finisher: boolean;
}

/** Walk the plan and return every planned set that has no logged entry yet. */
function collectUnloggedSlots(
  plan: Plan,
  sessionSets: SessionSets,
  serverLoggedCount: ServerLoggedCount,
): UnloggedSlot[] {
  const out: UnloggedSlot[] = [];
  const b = plan.blocks;
  const pushFor = (ex: PlannedExercise, is_finisher: boolean) => {
    const total = totalSetsFor(plan, ex.name);
    const logged = loggedCountFor(ex.name, sessionSets, serverLoggedCount);
    for (let n = logged + 1; n <= total; n++) {
      out.push({ exercise: ex, set_num: n, total_sets: total, is_finisher });
    }
  };
  if (b?.type === "circuit") {
    for (const ex of Array.isArray(b.exercises) ? b.exercises : []) pushFor(ex, false);
  }
  const fin = b?.finisher;
  if (fin && Array.isArray(fin.exercises)) {
    for (const ex of fin.exercises) pushFor(ex, true);
  }
  return out;
}

export default function DoneScreen({
  plan,
  total_elapsed_sec,
  sessionSets,
  serverLoggedCount,
  lastLogged,
  hasSummary,
  onLoggedSet,
  onSummaryLogged,
  onBack,
}: Props) {
  const unlogged = useMemo(
    () => collectUnloggedSlots(plan, sessionSets, serverLoggedCount),
    [plan, sessionSets, serverLoggedCount],
  );

  const allLogged = unlogged.length === 0;
  const fullyComplete = allLogged && hasSummary;

  return (
    <div className="screen screen--scroll done-screen">
      <header className="done-header">
        <div className="h1">{fullyComplete ? "Workout Complete" : "Almost done"}</div>
        <div className="done-elapsed mono">{formatMMSS(total_elapsed_sec)}</div>
        <div className="done-meta">
          {allLogged
            ? hasSummary
              ? "All sets logged. Session summary recorded."
              : "All sets logged. Add an overall RPE below to finish."
            : unlogged.length === 1
            ? "1 set still needs to be logged."
            : `${unlogged.length} sets still need to be logged.`}
        </div>
      </header>

      {!allLogged && (
        <section className="done-section">
          <h2 className="section-title">Unlogged sets ({unlogged.length})</h2>
          <div className="done-unlogged-grid">
            {unlogged.map((slot) => (
              <UnloggedSlotCard
                key={`${slot.exercise.name}#${slot.set_num}`}
                slot={slot}
                plan_id={plan.plan_id}
                sessionSets={sessionSets}
                lastLogged={lastLogged[slot.exercise.name] ?? null}
                onLoggedSet={onLoggedSet}
              />
            ))}
          </div>
        </section>
      )}

      <section className="done-section">
        <h2 className="section-title">Session summary</h2>
        <SummaryCard plan_id={plan.plan_id} hasSummary={hasSummary} onSummaryLogged={onSummaryLogged} />
      </section>

      <footer className="done-footer">
        <button type="button" className="btn btn--ghost btn--block" onClick={onBack}>
          Back to start
        </button>
      </footer>
    </div>
  );
}

// One card per unlogged set: a logger + a Skip-set button. Skip writes a
// session_log row with is_skipped=true (no fake metrics).
function UnloggedSlotCard({
  slot,
  plan_id,
  sessionSets,
  lastLogged,
  onLoggedSet,
}: {
  slot: UnloggedSlot;
  plan_id: number;
  sessionSets: SessionSets;
  lastLogged: LastLoggedEntry | null;
  onLoggedSet: (exerciseName: string, set: SetEntry) => void;
}) {
  const prefill = computePrefill(
    slot.exercise.name,
    slot.exercise.format,
    slot.exercise.target_load_lbs ?? null,
    slot.exercise.target_reps ?? null,
    slot.exercise.duration_sec ?? null,
    sessionSets,
    lastLogged,
  );

  async function skip() {
    const body: LogExerciseIn = {
      plan_id,
      exercise: slot.exercise.name,
      log_type: "strength_set",
      sets: [{
        set_num: slot.set_num,
        reps_done: null,
        weight_lbs: null,
        rpe_actual: null,
        is_skipped: true,
      }],
      notes: slot.is_finisher ? "finisher · skipped on Done screen" : "skipped on Done screen",
    };
    const r = await submitLog(body);
    if (r.status !== "error") {
      onLoggedSet(slot.exercise.name, {
        set_num: slot.set_num,
        weight_lbs: null,
        reps_done: null,
        rpe_actual: null,
      });
    }
  }

  return (
    <div className="done-unlogged-cell">
      <InlineExerciseLogger
        key={`${slot.exercise.name}#${slot.set_num}`}
        exercise={slot.exercise}
        plan_id={plan_id}
        set_num={slot.set_num}
        total_sets={slot.total_sets}
        prefill={prefill}
        lastHint={lastLogged}
        alreadyFullyLogged={false}
        isFinisher={slot.is_finisher}
        onLoggedSet={onLoggedSet}
      />
      <button
        type="button"
        className="btn btn--ghost"
        onClick={skip}
        aria-label={`Mark ${slot.exercise.name} set ${slot.set_num} as skipped`}
      >
        Skip set {slot.set_num}
      </button>
    </div>
  );
}

interface SummaryState {
  rpe: number | null;
  notes: string;
  status: "idle" | "saving" | "ok" | "error";
  error: string | null;
}

type SummaryAction =
  | { type: "set_rpe"; v: number | null }
  | { type: "set_notes"; v: string }
  | { type: "save_start" }
  | { type: "save_ok" }
  | { type: "save_err"; message: string };

function summaryReducer(s: SummaryState, a: SummaryAction): SummaryState {
  switch (a.type) {
    case "set_rpe":    return { ...s, rpe: a.v, status: "idle", error: null };
    case "set_notes":  return { ...s, notes: a.v, status: "idle", error: null };
    case "save_start": return { ...s, status: "saving", error: null };
    case "save_ok":    return { ...s, status: "ok", error: null };
    case "save_err":   return { ...s, status: "error", error: a.message };
  }
}

function SummaryCard({
  plan_id,
  hasSummary,
  onSummaryLogged,
}: {
  plan_id: number;
  hasSummary: boolean;
  onSummaryLogged: () => void;
}) {
  const [s, dispatch] = useReducer(summaryReducer, { rpe: null, notes: "", status: "idle", error: null });
  const isDone = hasSummary || s.status === "ok";

  async function save() {
    dispatch({ type: "save_start" });
    const body: LogExerciseIn = {
      plan_id,
      log_type: "session_summary",
      sets: [{ rpe_actual: s.rpe ?? null }],
      notes: s.notes.trim() || null,
    };
    const r = await submitLog(body);
    if (r.status === "error") {
      dispatch({ type: "save_err", message: r.message });
      return;
    }
    dispatch({ type: "save_ok" });
    onSummaryLogged();
  }

  return (
    <div className={`log-card log-summary${isDone ? " log-card--done" : ""}`}>
      <div className="log-card-head">
        <div className="log-card-name">
          Overall RPE{isDone && <span className="log-check"> ✓</span>}
        </div>
      </div>
      <RpeChips
        label="Overall RPE"
        value={s.rpe}
        disabled={isDone}
        onChange={(v) => dispatch({ type: "set_rpe", v })}
      />
      <NotesField value={s.notes} onChange={(v) => dispatch({ type: "set_notes", v })} disabled={isDone} />
      {s.status === "error" && s.error && <div className="log-error">{s.error}</div>}
      <button
        type="button"
        className="log-save log-finish"
        onClick={save}
        disabled={isDone || s.status === "saving"}
        aria-label="Save session summary"
      >
        {isDone ? "Summary recorded ✓" : s.status === "saving" ? "Saving…" : "Save summary"}
      </button>
    </div>
  );
}
