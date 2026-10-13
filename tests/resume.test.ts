import { describe, expect, it } from "vitest";
import { flattenBlocksToSteps, nextCursor, INITIAL_CURSOR, type Cursor, type Step } from "../src/lib/steps";
import { resumeCursor, setForVisit, visitIndexAt } from "../src/lib/resume";
import { initTimer, timerReducer } from "../src/lib/timer";
import type { Plan } from "../src/lib/types";

// Synthetic plan — no real loads, reps or dates (PUBLIC-FIXTURES).
const PLAN: Plan = {
  plan_id: 1,
  plan_date: "2030-01-07",
  phase: 2,
  week_num: 8,
  session_type: "strength_c",
  target_rpe: 7,
  est_duration_min: 45,
  is_skipped: false,
  blocks: {
    type: "circuit",
    rounds: 3,
    rest_between_rounds_sec: 120,
    warmup: "5 min easy",
    exercises: [
      { name: "Alpha press", format: "reps", target_reps: 10, rest_after_sec: 60 },
      { name: "Bravo row", format: "reps", target_reps: 10, rest_after_sec: 60 },
      { name: "Charlie hold", format: "duration", duration_sec: 30, rest_after_sec: 60 },
    ],
  },
};
const NAMES = ["Alpha press", "Bravo row", "Charlie hold"];

const steps: Step[] = flattenBlocksToSteps(PLAN.blocks).steps;

/** Every cursor the session walks, in order. */
function walk(): Cursor[] {
  const out: Cursor[] = [];
  let c: Cursor | null = INITIAL_CURSOR;
  while (c) { out.push(c); c = nextCursor(steps, c); }
  return out;
}
function exerciseCursor(name: string, round: number): Cursor {
  const c = walk().find((x) => steps[x.stepIndex].kind === "exercise"
    && steps[x.stepIndex].exerciseRef?.name === name && x.currentRound === round);
  if (!c) throw new Error(`no ${name} in round ${round}`);
  return c;
}
function restAfter(name: string, round: number): Cursor {
  const c = walk().find((x) => steps[x.stepIndex].kind === "rest"
    && steps[x.stepIndex].precedingExerciseRef?.name === name && x.currentRound === round);
  if (!c) throw new Error(`no rest after ${name} in round ${round}`);
  return c;
}
const counts = (m: Record<string, number>) => (n: string) => m[n] ?? 0;

describe("visitIndexAt", () => {
  it("is the round, for a plain circuit — on the exercise and on its rest", () => {
    for (const r of [1, 2, 3]) {
      expect(visitIndexAt(steps, exerciseCursor("Alpha press", r), "Alpha press")).toBe(r);
      expect(visitIndexAt(steps, restAfter("Alpha press", r), "Alpha press")).toBe(r);
    }
  });
});

describe("setForVisit", () => {
  it("offers the next unlogged set when this visit's set isn't in", () => {
    expect(setForVisit(1, 0)).toEqual({ setNum: 1, done: false });
    // Round 1 skipped, now round 2: log set 1, not set 2 — no gap in set_num.
    expect(setForVisit(2, 0)).toEqual({ setNum: 1, done: false });
  });
  it("marks the visit done when the count already covers it", () => {
    expect(setForVisit(1, 2)).toEqual({ setNum: 1, done: true });
    expect(setForVisit(3, 3)).toEqual({ setNum: 3, done: true });
  });
});

describe("GD-RESUME — the reported sequence", () => {
  // Alpha press has 2 sets logged (from before a reload / restart), nothing else.
  const logged = counts({ "Alpha press": 2 });

  it("resumes at the first unlogged set — Bravo row, round 1", () => {
    expect(resumeCursor(steps, NAMES, logged)).toEqual(exerciseCursor("Bravo row", 1));
  });

  it("round 1 and 2 Alpha press read as done; round 3 still offers set 3", () => {
    expect(setForVisit(visitIndexAt(steps, restAfter("Alpha press", 1), "Alpha press"), 2).done).toBe(true);
    expect(setForVisit(visitIndexAt(steps, restAfter("Alpha press", 2), "Alpha press"), 2).done).toBe(true);
    expect(setForVisit(visitIndexAt(steps, restAfter("Alpha press", 3), "Alpha press"), 2))
      .toEqual({ setNum: 3, done: false });
  });

  it("mid round 2 reload: resumes on the first unlogged exercise of round 2", () => {
    const l = counts({ "Alpha press": 2, "Bravo row": 1, "Charlie hold": 1 });
    expect(resumeCursor(steps, NAMES, l)).toEqual(exerciseCursor("Bravo row", 2));
  });

  it("nothing logged → no jump (warmup runs as normal)", () => {
    expect(resumeCursor(steps, NAMES, counts({}))).toBeNull();
  });

  it("everything logged → no jump", () => {
    expect(resumeCursor(steps, NAMES, counts({ "Alpha press": 3, "Bravo row": 3, "Charlie hold": 3 })))
      .toBeNull();
  });
});

describe("timer JUMP", () => {
  it("moves a running timer to the cursor and restarts the step clock", () => {
    let s = timerReducer(initTimer(flattenBlocksToSteps(PLAN.blocks)), { type: "START", now_ms: 0 });
    const to = exerciseCursor("Bravo row", 2);
    s = timerReducer(s, { type: "JUMP", cursor: to, now_ms: 500 });
    expect(s.cursor).toEqual(to);
    expect(s.step_started_at_ms).toBe(500);
    expect(s.status).toBe("running");
  });
  it("is ignored before START", () => {
    const s0 = initTimer(flattenBlocksToSteps(PLAN.blocks));
    expect(timerReducer(s0, { type: "JUMP", cursor: { stepIndex: 2, currentRound: 2 }, now_ms: 1 })).toBe(s0);
  });
});
