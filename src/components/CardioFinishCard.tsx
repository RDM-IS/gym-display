import { useReducer } from "react";
import Stepper from "./Stepper";
import RpeChips from "./RpeChips";
import NotesField from "./NotesField";
import { submitLog } from "../lib/log-queue";
import {
  cardioExerciseName,
  cardioFinishBody,
  finishBlocker,
  prefillMinutes,
  rowCardio,
  type CardioFinishInput,
} from "../lib/cardio-finish";
import type { Plan } from "../lib/types";
import type { SetEntry } from "../lib/log-state";

// CARDIO-REQUIRED: the only way to finish a cardio row. See lib/cardio-finish.

type Field = keyof Omit<CardioFinishInput, "notes">;

interface S extends CardioFinishInput {
  status: "idle" | "saving" | "ok" | "error";
  error: string | null;
}

type A =
  | { type: "field"; field: Field; value: number | null }
  | { type: "notes"; value: string }
  | { type: "start" }
  | { type: "ok" }
  | { type: "err"; message: string };

function reducer(s: S, a: A): S {
  switch (a.type) {
    case "field": return { ...s, [a.field]: a.value, status: "idle", error: null };
    case "notes": return { ...s, notes: a.value, status: "idle", error: null };
    case "start": return { ...s, status: "saving", error: null };
    case "ok":    return { ...s, status: "ok", error: null };
    case "err":   return { ...s, status: "error", error: a.message };
  }
}

interface Props {
  plan: Plan;
  elapsed_sec: number;
  /** A summary already exists for the row. The block is still owed — an
   * older finish recorded the summary alone — but no second summary is sent. */
  hasSummary: boolean;
  onLoggedSet: (exerciseName: string, set: SetEntry) => void;
  onSummaryLogged: () => void;
  onFinished?: () => void;
}

export default function CardioFinishCard({
  plan, elapsed_sec, hasSummary, onLoggedSet, onSummaryLogged, onFinished,
}: Props) {
  const [s, dispatch] = useReducer(reducer, undefined, (): S => ({
    duration_min: prefillMinutes(elapsed_sec),
    distance_m: null, hr_avg: null, hr_peak: null, rpe: null, notes: "",
    status: "idle", error: null,
  }));
  const isDone = s.status === "ok";
  const blocker = finishBlocker(s);
  const { modality, device } = rowCardio(plan);
  const on = modality ? `${modality}${device ? ` · ${device}` : ""}` : "not set on this row";

  async function finish() {
    if (blocker) return;
    dispatch({ type: "start" });
    const r = await submitLog(cardioFinishBody(plan, s, { withSummary: !hasSummary }));
    if (r.status === "error") {
      dispatch({ type: "err", message: r.message });
      return;
    }
    dispatch({ type: "ok" });
    // Count the block locally so no other screen offers a second one.
    onLoggedSet(cardioExerciseName(plan), {
      set_num: 1, weight_lbs: null, reps_done: null, rpe_actual: s.rpe,
    });
    if (!hasSummary) onSummaryLogged();
    onFinished?.();
  }

  return (
    <div className={`log-card log-summary${isDone ? " log-card--done" : ""}`}>
      <div className="log-card-head">
        <div className="log-card-name">
          Finish cardio{isDone && <span className="log-check"> ✓</span>}
        </div>
        <div className="log-card-target mono" aria-label="Cardio machine">{on}</div>
      </div>
      <div className="log-steppers">
        <Stepper label="Minutes" unit="min" value={s.duration_min} step={1} min={0} max={240}
          blankStart={prefillMinutes(elapsed_sec) ?? 30} disabled={isDone}
          onChange={(v) => dispatch({ type: "field", field: "duration_min", value: v })} />
        <Stepper label="Distance" unit="m" value={s.distance_m} step={100} min={0}
          blankStart={0} disabled={isDone}
          onChange={(v) => dispatch({ type: "field", field: "distance_m", value: v })} />
        <Stepper label="HR avg" value={s.hr_avg} step={1} min={0} max={250}
          blankStart={130} disabled={isDone}
          onChange={(v) => dispatch({ type: "field", field: "hr_avg", value: v })} />
        <Stepper label="HR peak" value={s.hr_peak} step={1} min={0} max={250}
          blankStart={150} disabled={isDone}
          onChange={(v) => dispatch({ type: "field", field: "hr_peak", value: v })} />
      </div>
      <RpeChips label="Effort" value={s.rpe} disabled={isDone}
        onChange={(v) => dispatch({ type: "field", field: "rpe", value: v })} />
      <NotesField value={s.notes} onChange={(v) => dispatch({ type: "notes", value: v })} disabled={isDone} />
      {!isDone && blocker && s.status !== "saving" && <div className="log-hint">{blocker}</div>}
      {s.status === "error" && s.error && <div className="log-error">{s.error}</div>}
      <button type="button" className="log-save log-finish" onClick={finish}
        disabled={isDone || !!blocker || s.status === "saving"} aria-label="Finish cardio">
        {isDone ? "Cardio logged ✓" : s.status === "saving" ? "Saving…" : "Finish cardio"}
      </button>
    </div>
  );
}
