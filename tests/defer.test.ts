import { describe, expect, it } from "vitest";
import { buildSession, initTimer, selectCanDeferCurrent, selectCanDeferNext, selectNextStep,
         timerReducer, type TimerState } from "../src/lib/timer";
import type { CircuitBlocks, PlannedExercise } from "../src/lib/types";

// GD-DEFER — "Busy — later" swaps an exercise with the next one in this round.

const ex = (name: string, over: Partial<PlannedExercise> = {}): PlannedExercise =>
  ({ name, format: "reps", target_reps: 12, rest_after_sec: 60, notes: "2×10-12", ...over });

// Monday Strength C: four machine / cable stations.
const C: CircuitBlocks = {
  type: "circuit", display_name: "Office Strength C", rounds: 2, rest_between_rounds_sec: 90,
  warmup: "5 min elliptical, easy", cooldown: "5 min Stretch Trainer",
  exercises: [
    ex("DB Romanian deadlift"), ex("Pec fly"), ex("Single-arm cable row"),
    ex("Seated DB shoulder press"), ex("Calf press"), ex("Ab machine crunch"),
  ],
};

function start(blocks = C): TimerState {
  return timerReducer(initTimer(buildSession(blocks)), { type: "START", now_ms: 0 });
}
const next = (s: TimerState) => timerReducer(s, { type: "NEXT_STEP", now_ms: 1 });
const cur = (s: TimerState) => s.steps[s.cursor.stepIndex];
const label = (s: TimerState) => cur(s).label;

/** Advance to the next EXERCISE (through rests); stops when the workout is
 * done. Bounded so a cursor bug fails the test instead of hanging it. */
function toNextExercise(s: TimerState): TimerState {
  let t = next(s);
  for (let i = 0; i < 200 && t.status !== "done" && cur(t)?.kind !== "exercise"; i++) t = next(t);
  return t;
}
function toExercise(s: TimerState, name: string): TimerState {
  let t = s;
  for (let i = 0; i < 200 && t.status !== "done" && label(t) !== name; i++) t = next(t);
  if (label(t) !== name) throw new Error(`never reached ${name}`);
  return t;
}
/** The exercise order the cursor visits for the rest of the round. */
function roundOrder(s: TimerState): string[] {
  const out = [label(s)];
  const round = s.cursor.currentRound;
  let t = s;
  for (let i = 0; i < 50; i++) {
    t = toNextExercise(t);
    if (t.status === "done" || cur(t)?.kind !== "exercise" || t.cursor.currentRound !== round) return out;
    out.push(label(t));
  }
  throw new Error("roundOrder did not terminate");
}

describe("DEFER_CURRENT — swap with the next exercise", () => {
  it("pec fly busy: cable row now, pec fly one slot later, then the plan resumes", () => {
    let s = toExercise(start(), "Pec fly");
    const idx = s.cursor.stepIndex;
    s = timerReducer(s, { type: "DEFER_CURRENT", now_ms: 5 });
    expect(label(s)).toBe("Single-arm cable row");
    expect(s.cursor.stepIndex).toBe(idx);           // takes the busy one's slot
    expect(s.cursor.currentRound).toBe(1);
    expect(s.step_started_at_ms).toBe(5);           // its timer starts fresh
    expect(s.deferred).toEqual(["Pec fly"]);
    expect(roundOrder(s)).toEqual(["Single-arm cable row", "Pec fly", "Seated DB shoulder press",
                                   "Calf press", "Ab machine crunch"]);
  });

  it("every exercise keeps its own logging rest", () => {
    let s = toExercise(start(), "Pec fly");
    s = timerReducer(s, { type: "DEFER_CURRENT", now_ms: 5 });
    const rest = s.steps[s.cursor.stepIndex + 1];
    expect(rest.kind).toBe("rest");
    expect(rest.precedingExerciseRef?.name).toBe("Single-arm cable row");
    s = toNextExercise(s);                             // back to pec fly
    expect(label(s)).toBe("Pec fly");
    expect(s.steps[s.cursor.stepIndex + 1].precedingExerciseRef?.name).toBe("Pec fly");
  });

  it("still busy: defer again swaps with the one after", () => {
    let s = toExercise(start(), "Pec fly");
    s = timerReducer(s, { type: "DEFER_CURRENT", now_ms: 5 });
    s = toNextExercise(s);
    expect(label(s)).toBe("Pec fly");
    s = timerReducer(s, { type: "DEFER_CURRENT", now_ms: 9 });
    expect(label(s)).toBe("Seated DB shoulder press");
    expect(roundOrder(s)).toEqual(["Seated DB shoulder press", "Pec fly", "Calf press",
                                   "Ab machine crunch"]);
  });

  it("the last exercise in the round has nothing to swap with", () => {
    let s = toExercise(start(), "Ab machine crunch");
    expect(selectCanDeferCurrent(s)).toBe("last");
    const after = timerReducer(s, { type: "DEFER_CURRENT", now_ms: 5 });
    expect(after).toBe(s);
  });

  it("deferring the last-but-one moves the round break to the busy one", () => {
    let s = toExercise(start(), "Calf press");
    s = timerReducer(s, { type: "DEFER_CURRENT", now_ms: 5 });
    expect(label(s)).toBe("Ab machine crunch");
    const rb = s.steps.find((x) => x.isRoundBreak)!;
    expect(rb.precedingExerciseRef?.name).toBe("Calf press");   // calf press is now last
    expect(s.steps.length).toBe(start().steps.length);
  });

  it("the next round goes back to the plan order", () => {
    let s = toExercise(start(), "Pec fly");
    s = timerReducer(s, { type: "DEFER_CURRENT", now_ms: 5 });
    for (let i = 0; i < 100 && s.cursor.currentRound === 1; i++) s = next(s);
    expect(s.cursor.currentRound).toBe(2);
    expect(s.deferred).toEqual([]);
    expect(s.steps).toBe(s.planSteps);
    expect(roundOrder(s)).toEqual(["DB Romanian deadlift", "Pec fly", "Single-arm cable row",
                                   "Seated DB shoulder press", "Calf press", "Ab machine crunch"]);
  });

  it("skips an exercise that doesn't run this round (fewer sets)", () => {
    const adj: CircuitBlocks = { ...C, exercises: C.exercises!.map((e) =>
      e.name === "Single-arm cable row" ? { ...e, sets: 1 } : e) };
    let s = start(adj);
    for (let i = 0; i < 100 && s.cursor.currentRound === 1; i++) s = next(s);   // round 2
    s = toExercise(s, "Pec fly");
    s = timerReducer(s, { type: "DEFER_CURRENT", now_ms: 5 });
    expect(label(s)).toBe("Seated DB shoulder press");
  });

  it("only strength exercises in the main circuit can be deferred", () => {
    const timed: CircuitBlocks = { ...C, exercises: [ex("Plank", { format: "duration", duration_sec: 30 }),
                                                     ex("Pec fly")] };
    const s = start(timed);
    const plank = toExercise(s, "Plank");
    expect(selectCanDeferCurrent(plank)).toBe("no");
    const warm = start();
    expect(cur(warm).kind).toBe("warmup");
    expect(selectCanDeferCurrent(warm)).toBe("no");
  });
});

describe("DEFER_NEXT — from the rest before a busy machine", () => {
  it("swaps what's next and stays on the rest", () => {
    let s = toExercise(start(), "DB Romanian deadlift");
    s = next(s);                                        // RDL's logging rest
    expect(cur(s).kind).toBe("rest");
    expect(selectNextStep(s)?.label).toBe("Pec fly");
    expect(selectCanDeferNext(s)).toBe("yes");
    const idx = s.cursor.stepIndex;
    s = timerReducer(s, { type: "DEFER_NEXT" });
    expect(s.cursor.stepIndex).toBe(idx);
    expect(cur(s).precedingExerciseRef?.name).toBe("DB Romanian deadlift");
    expect(selectNextStep(s)?.label).toBe("Single-arm cable row");
    expect(s.deferred).toEqual(["Pec fly"]);
  });

  it("isn't offered on the round break (the next round hasn't started)", () => {
    let s = toExercise(start(), "Ab machine crunch");
    s = next(s);
    expect(cur(s).isRoundBreak).toBe(true);
    expect(selectCanDeferNext(s)).toBe("no");
  });
});

describe("restart", () => {
  it("restart workout restores the plan order", () => {
    let s = toExercise(start(), "Pec fly");
    s = timerReducer(s, { type: "DEFER_CURRENT", now_ms: 5 });
    s = timerReducer(s, { type: "RESTART_WORKOUT", now_ms: 9 });
    expect(s.steps).toBe(s.planSteps);
    expect(s.deferred).toEqual([]);
  });
});
