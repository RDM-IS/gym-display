import { describe, expect, it } from "vitest";
import {
  nextExerciseFor,
  flattenBlocksToSteps,
  INITIAL_CURSOR,
  nextCursor,
  prevCursor,
  type Cursor,
  type Step,
} from "../src/lib/steps";
import {
  buildSession,
  initTimer,
  selectCurrentStep,
  selectElapsedSec,
  selectIsHolding,
  selectNextStep,
  selectRemainingSec,
  selectStepAfterNext,
  selectStepElapsedSec,
  timerReducer,
} from "../src/lib/timer";
import type {
  CircuitBlocks,
  IntervalsBlocks,
  MobilityBlocks,
  SteadyBlocks,
  WalkBlocks,
} from "../src/lib/types";

const circuit: CircuitBlocks = {
  type: "circuit",
  warmup: "5 min bike easy",
  rounds: 3,
  rest_between_rounds_sec: 120,
  exercises: [
    { name: "Goblet squat", format: "reps", target_reps: 10, target_load_lbs: 30, rest_after_sec: 60 },
    { name: "Plank", format: "duration", duration_sec: 30, rest_after_sec: 60 },
  ],
  cooldown: "8 min bike easy",
};

const cardio: IntervalsBlocks = {
  type: "intervals",
  warmup_sec: 300,
  intervals_template: { work_sec: 60, rest_sec: 60 },
  rounds: 3,
  cooldown_sec: 300,
};

const walk: WalkBlocks = { type: "walk", duration_min: 45 };

// ---------------------------------------------------------------------------
// flattenBlocksToSteps
// ---------------------------------------------------------------------------

describe("flattenBlocksToSteps — circuit (single-pass, NOT unrolled)", () => {
  const session = flattenBlocksToSteps(circuit);

  it("produces ONE pass: warmup + (ex + rest) per exercise + round-break rest + cooldown", () => {
    const kinds = session.steps.map((s) => s.kind);
    expect(kinds).toEqual([
      "warmup",
      "exercise", "rest",     // goblet squat, inter-exercise rest
      "exercise", "rest",     // plank, this rest = round_break
      "cooldown",
    ]);
  });

  it("marks the last in-circuit rest as isRoundBreak with rest_between_rounds_sec duration", () => {
    const rb = session.steps[4];
    expect(rb.kind).toBe("rest");
    expect(rb.isRoundBreak).toBe(true);
    expect(rb.duration_sec).toBe(120);
    expect(rb.circuitId).toBe("main");
  });

  it("attaches totalRounds + circuitId on every in-circuit step", () => {
    for (const s of session.steps.slice(1, 5)) {
      expect(s.totalRounds).toBe(3);
      expect(s.circuitId).toBe("main");
    }
  });

  it("rest steps carry precedingExerciseRef", () => {
    expect(session.steps[2].precedingExerciseRef?.name).toBe("Goblet squat");
    expect(session.steps[4].precedingExerciseRef?.name).toBe("Plank");
  });

  it("exposes sections for the map: warmup / circuit / cooldown", () => {
    expect(session.sections.map((s) => s.kind)).toEqual(["warmup", "circuit", "cooldown"]);
    const circuitSec = session.sections.find((s) => s.kind === "circuit");
    expect(circuitSec?.totalRounds).toBe(3);
    expect(circuitSec?.title).toContain("3 ×");
  });
});

describe("flattenBlocksToSteps — cardio intervals", () => {
  const session = flattenBlocksToSteps(cardio);

  it("produces warmup + work + (round-break) rest + cooldown — one pass", () => {
    expect(session.steps.map((s) => s.kind)).toEqual([
      "warmup",
      "exercise", "rest", // work + round-break (3 rounds → wrap twice)
      "cooldown",
    ]);
    expect(session.steps[2].isRoundBreak).toBe(true);
  });
});

describe("flattenBlocksToSteps — steady / mobility / walk single block", () => {
  it("steady: warmup + 1 exercise + cooldown", () => {
    const steady: SteadyBlocks = {
      type: "steady",
      display_name: "Long Z2 Bike",
      warmup_sec: 300,
      duration_min: 45,
      cooldown_sec: 300,
      intensity: "Z2",
    };
    const kinds = flattenBlocksToSteps(steady).steps.map((s) => s.kind);
    expect(kinds).toEqual(["warmup", "exercise", "cooldown"]);
  });

  it("mobility: one exercise step", () => {
    const m: MobilityBlocks = { type: "mobility", duration_min: 20, notes: "foam roll" };
    expect(flattenBlocksToSteps(m).steps).toHaveLength(1);
  });

  it("walk: one exercise step", () => {
    expect(flattenBlocksToSteps(walk).steps).toHaveLength(1);
  });
});

describe("flattenBlocksToSteps — finisher appended as own circuit section", () => {
  const c: CircuitBlocks = {
    ...circuit,
    finisher: {
      type: "core_circuit",
      rounds: 2,
      exercises: [
        { name: "Dead bug", format: "reps", target_reps: 10 },
        { name: "Hollow hold", format: "duration", duration_sec: 20 },
      ],
    },
  };
  const session = flattenBlocksToSteps(c);

  it("adds a finisher section after cooldown with circuitId='finisher'", () => {
    const finSec = session.sections.find((s) => s.kind === "finisher");
    expect(finSec).toBeDefined();
    expect(finSec?.totalRounds).toBe(2);
    const finSteps = session.steps.slice(finSec!.startIndex, finSec!.endIndex + 1);
    expect(finSteps.every((s) => s.circuitId === "finisher")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cursor — round wrap, round-break skip, prev clamp
// ---------------------------------------------------------------------------

describe("cursor — round wrap on round-break (non-last round)", () => {
  const session = flattenBlocksToSteps(circuit);
  // Steps: [0]warmup [1]gob-ex [2]rest [3]plank-ex [4]round-break-rest [5]cooldown
  it("advancing from round_break on round 1 wraps to first circuit step with round=2", () => {
    const cur: Cursor = { stepIndex: 4, currentRound: 1 };
    const next = nextCursor(session.steps, cur)!;
    expect(next.stepIndex).toBe(1); // goblet squat (start of circuit)
    expect(next.currentRound).toBe(2);
  });

  it("advancing from round_break on round 2 wraps to start with round=3", () => {
    const cur: Cursor = { stepIndex: 4, currentRound: 2 };
    const next = nextCursor(session.steps, cur)!;
    expect(next.stepIndex).toBe(1);
    expect(next.currentRound).toBe(3);
  });
});

describe("cursor — round-break is skipped on the last round", () => {
  const session = flattenBlocksToSteps(circuit);
  it("on round 3 (== totalRounds), advancing from the last exercise skips the round-break and lands on cooldown", () => {
    const cur: Cursor = { stepIndex: 3, currentRound: 3 }; // last exercise of last round
    const next = nextCursor(session.steps, cur)!;
    expect(next.stepIndex).toBe(5); // cooldown
    expect(next.currentRound).toBe(1); // reset (out of circuit)
  });
});

describe("cursor — linear advance + reset round on circuit exit", () => {
  const session = flattenBlocksToSteps(circuit);
  it("warmup → first exercise → currentRound=1", () => {
    const cur: Cursor = { stepIndex: 0, currentRound: 1 };
    const next = nextCursor(session.steps, cur)!;
    expect(next.stepIndex).toBe(1);
    expect(next.currentRound).toBe(1);
  });

  it("reaching past cooldown returns null (done)", () => {
    const session2 = flattenBlocksToSteps(walk);
    const cur: Cursor = { stepIndex: 0, currentRound: 1 };
    expect(nextCursor(session2.steps, cur)).toBeNull();
  });
});

describe("cursor — prev clamps at 0", () => {
  const session = flattenBlocksToSteps(circuit);
  it("at index 0, prev stays at 0", () => {
    const cur: Cursor = INITIAL_CURSOR;
    expect(prevCursor(session.steps, cur).stepIndex).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// timerReducer — drives the cursor through 3 full rounds
// ---------------------------------------------------------------------------

describe("timerReducer — walks 3 full rounds end-to-end", () => {
  function totalDurationFor(steps: Step[]): number {
    // For circuit, each in-circuit non-round-break step plays totalRounds times;
    // round-break plays totalRounds-1 times.
    let total = 0;
    for (const s of steps) {
      if (s.circuitId && s.totalRounds && s.totalRounds > 1) {
        if (s.isRoundBreak) total += s.duration_sec * (s.totalRounds - 1);
        else total += s.duration_sec * s.totalRounds;
      } else {
        total += s.duration_sec;
      }
    }
    return total;
  }

  it("TICK runs a timed-only session (intervals) to 'done' after the full duration", () => {
    const session = buildSession(cardio);
    const totalMs = totalDurationFor(session.steps) * 1000;
    let s = initTimer(session);
    s = timerReducer(s, { type: "START", now_ms: 0 });
    s = timerReducer(s, { type: "TICK", now_ms: totalMs + 1 });
    expect(s.status).toBe("done");
  });

  it("strength set + its logging rest HOLD at 0; timed plank and its round-break auto-advance and wrap", () => {
    const session = buildSession(circuit);
    // [0]warmup [1]goblet(reps,hold) [2]rest(hold) [3]plank(duration) [4]round-break(no hold) [5]cooldown
    expect(session.steps.map((st) => !!st.holdAtEnd)).toEqual([false, true, true, false, false, false]);
    let s = initTimer(session);
    s = timerReducer(s, { type: "START", now_ms: 0 });
    // warmup 300s auto-advances; goblet (40s) holds well past its duration.
    s = timerReducer(s, { type: "TICK", now_ms: 1_000_000 });
    expect(s.cursor.stepIndex).toBe(1);
    expect(s.status).toBe("running");
    expect(selectRemainingSec(s, 1_000_000)).toBe(0);
    expect(selectIsHolding(s, 1_000_000)).toBe(true);
    // "Set done" → logging rest, which also holds.
    s = timerReducer(s, { type: "NEXT_STEP", now_ms: 1_000_000 });
    s = timerReducer(s, { type: "TICK", now_ms: 1_200_000 });
    expect(s.cursor.stepIndex).toBe(2);
    // Advance → plank (30s) → round-break (120s) → wraps to goblet round 2 on its own.
    s = timerReducer(s, { type: "NEXT_STEP", now_ms: 1_200_000 });
    s = timerReducer(s, { type: "TICK", now_ms: 1_200_000 + 150_001 });
    expect(s.cursor.stepIndex).toBe(1);
    expect(s.cursor.currentRound).toBe(2);
    expect(selectStepElapsedSec(s, 1_200_000 + 150_001)).toBeCloseTo(0.001, 2);
  });

  it("PAUSE freezes remaining; RESUME offsets so paused time is excluded from elapsed", () => {
    const session = buildSession(circuit);
    let s = initTimer(session);
    s = timerReducer(s, { type: "START", now_ms: 0 });
    expect(selectRemainingSec(s, 100_000)).toBe(200);
    s = timerReducer(s, { type: "PAUSE", now_ms: 100_000 });
    expect(selectRemainingSec(s, 500_000)).toBe(200);
    s = timerReducer(s, { type: "RESUME", now_ms: 160_000 });
    expect(selectElapsedSec(s, 190_000)).toBe(130);
  });

  it("NEXT_STEP / PREV_STEP move the cursor; PREV at 0 clamps", () => {
    const session = buildSession(circuit);
    let s = initTimer(session);
    s = timerReducer(s, { type: "START", now_ms: 0 });
    s = timerReducer(s, { type: "NEXT_STEP", now_ms: 1 });
    expect(s.cursor.stepIndex).toBe(1);
    s = timerReducer(s, { type: "PREV_STEP", now_ms: 2 });
    expect(s.cursor.stepIndex).toBe(0);
    s = timerReducer(s, { type: "PREV_STEP", now_ms: 3 });
    expect(s.cursor.stepIndex).toBe(0);
  });

  it("selectNextStep / selectStepAfterNext give the footer 'Next' and 'Followed by'", () => {
    const session = buildSession(circuit);
    let s = initTimer(session);
    s = timerReducer(s, { type: "START", now_ms: 0 });
    // cursor at warmup, next = goblet squat, after = rest
    expect(selectCurrentStep(s)?.label).toBe("5 min bike easy");
    expect(selectNextStep(s)?.label).toBe("Goblet squat");
    expect(selectStepAfterNext(s)?.label).toBe("Rest");
  });
});

// ── GD-REST-TILES: what a rest leads into (Ryan, 2026-09-23) ───────────────
describe("the exercise a rest leads into", () => {
  const BLOCKS = {
    type: "circuit", rounds: 2, rest_between_rounds_sec: 90,
    exercises: [
      { name: "Leg press", format: "reps", target_reps: 12, rest_after_sec: 60 },
      { name: "DB bench press", format: "reps", target_reps: 12, rest_after_sec: 60 },
    ],
  };
  const steps = flattenBlocksToSteps(BLOCKS as never).steps;
  const restAfter = (name: string) =>
    steps.findIndex((s) => s.kind === "rest" && s.precedingExerciseRef?.name === name);
  const roundBreak = steps.findIndex((s) => s.isRoundBreak);

  it("a plain rest leads to the exercise that follows it", () => {
    expect(nextExerciseFor(steps, restAfter("Leg press"), 1)?.name).toBe("DB bench press");
  });

  it("a round break leads to the circuit's first exercise, next round", () => {
    expect(nextExerciseFor(steps, roundBreak, 1)?.name).toBe("Leg press");
  });

  it("the FINAL rest leads nowhere — the tiles hide rather than go stale", () => {
    expect(nextExerciseFor(steps, roundBreak, 2)).toBeNull();
  });

  it("is null for a step that is not a rest", () => {
    const ex = steps.findIndex((s) => s.kind === "exercise");
    expect(nextExerciseFor(steps, ex, 1)).toBeNull();
    expect(nextExerciseFor(steps, 999, 1)).toBeNull();
  });

  it("the last rest of a body leads into the next body (a finisher)", () => {
    const withFinisher = {
      ...BLOCKS,
      finisher: { rounds: 1, exercises: [{ name: "Plank", format: "hold", duration_sec: 45 }] },
    } as never;
    const s2 = flattenBlocksToSteps(withFinisher).steps;
    const rb = s2.findIndex((s) => s.isRoundBreak);
    expect(nextExerciseFor(s2, rb, 2)?.name).toBe("Plank");
  });
});
