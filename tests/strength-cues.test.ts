import { describe, expect, it } from "vitest";
import {
  REPS_LEFT_BY_CAP,
  exercisePrompt,
  fitsInRest,
  lastSessionAverage,
  lastSetsSentence,
  repsLeftHint,
  utteranceMs,
} from "../src/lib/strength-cues";
import { promptTarget } from "../src/lib/strength-cues";
import { flattenBlocksToSteps } from "../src/lib/steps";
import type { SessionDayRow, SessionSetRow } from "../src/lib/types";
import type { CircuitBlocks } from "../src/lib/types";

// GD-STRENGTH-CUES — the spoken "last sets averaged" is the MEAN across that
// exercise's sets in the most recent earlier session. Not the top set: that
// stays what /last_logged returns and what the stepper prefills against.

function set(p: Partial<SessionSetRow> & { exercise: string }): SessionSetRow {
  return {
    log_id: Math.random(), log_type: "strength_set", exercise: p.exercise,
    set_num: p.set_num ?? 1, reps_done: p.reps_done ?? 12, weight_lbs: p.weight_lbs ?? null,
    duration_sec: null, distance_m: null, hr_avg: null, hr_peak: null,
    rpe_actual: p.rpe_actual ?? null, notes: null, is_skipped: p.is_skipped ?? false,
    logged_at: "2026-09-16T12:00:00Z", logged_via: p.logged_via ?? "ipad",
  } as SessionSetRow;
}

function day(plan_date: string, sets: SessionSetRow[]): SessionDayRow {
  return { plan_date, sets } as SessionDayRow;
}

describe("the reps-left line", () => {
  it("translates each cap Ryan listed", () => {
    expect(repsLeftHint(6)).toBe("stop with ~4 reps left");
    expect(repsLeftHint(7)).toBe("~3 reps left");
    expect(repsLeftHint(7.5)).toBe("~2–3 reps left");
    expect(repsLeftHint(8)).toBe("~2 reps left");
    // (key order is JS's business — integer-like keys sort first)
    expect(new Set(Object.keys(REPS_LEFT_BY_CAP))).toEqual(new Set(["6", "7", "7.5", "8"]));
  });

  it("6.0 and 6 are the same cap", () => {
    expect(repsLeftHint(6.0)).toBe(repsLeftHint(6));
  });

  it("a cap with no entry says nothing rather than guessing", () => {
    expect(repsLeftHint(9)).toBeNull();
    expect(repsLeftHint(null)).toBeNull();
    expect(repsLeftHint(undefined)).toBeNull();
    expect(repsLeftHint(NaN)).toBeNull();
  });
});

describe("the last-session average", () => {
  const TODAY = "2026-09-21";

  it("Ryan's example: 140 @ 5, 150 @ 6, 160 @ 7 → RPE 6 at 150 for 12", () => {
    const days = [day("2026-09-18", [
      set({ exercise: "Leg press", weight_lbs: 140, rpe_actual: 5, reps_done: 12 }),
      set({ exercise: "Leg press", weight_lbs: 150, rpe_actual: 6, reps_done: 12 }),
      set({ exercise: "Leg press", weight_lbs: 160, rpe_actual: 7, reps_done: 12 }),
    ])];
    const avg = lastSessionAverage(days, "Leg press", TODAY)!;
    expect(avg).toMatchObject({ weight_lbs: 150, reps: 12, rpe: 6, sets: 3 });
    expect(lastSetsSentence(avg)).toBe("Your last sets averaged RPE 6 at 150 pounds for 12 reps.");
  });

  it("is the average, not the top set", () => {
    const days = [day("2026-09-18", [
      set({ exercise: "Row", weight_lbs: 100, rpe_actual: 6 }),
      set({ exercise: "Row", weight_lbs: 200, rpe_actual: 8 }),
    ])];
    const avg = lastSessionAverage(days, "Row", TODAY)!;
    expect(avg.weight_lbs).toBe(150);        // not 200
    expect(avg.rpe).toBe(7);                 // not 8
  });

  it("a skipped set is excluded from the average", () => {
    const days = [day("2026-09-18", [
      set({ exercise: "Row", weight_lbs: 100, rpe_actual: 6 }),
      set({ exercise: "Row", weight_lbs: 200, rpe_actual: 8 }),
      // Ryan pressed Skip on this one: a decision about the slot, not a set.
      set({ exercise: "Row", weight_lbs: 999, rpe_actual: 10, is_skipped: true }),
    ])];
    const avg = lastSessionAverage(days, "Row", TODAY)!;
    expect(avg.sets).toBe(2);
    expect(avg.weight_lbs).toBe(150);
    expect(avg.rpe).toBe(7);
  });

  it("rounds weight to the pound, reps to a whole rep, RPE to the nearest 0.5", () => {
    const days = [day("2026-09-18", [
      set({ exercise: "X", weight_lbs: 100, reps_done: 10, rpe_actual: 6 }),
      set({ exercise: "X", weight_lbs: 105, reps_done: 11, rpe_actual: 6.4 }),
      set({ exercise: "X", weight_lbs: 108, reps_done: 12, rpe_actual: 7 }),
    ])];
    const avg = lastSessionAverage(days, "X", TODAY)!;
    expect(avg.weight_lbs).toBe(104);      // 104.33 → 104
    expect(avg.reps).toBe(11);             // 11.0
    expect(avg.rpe).toBe(6.5);             // 6.466… → 6.5
  });

  it("takes the most recent EARLIER session, never today's own sets", () => {
    const days = [
      day("2026-09-14", [set({ exercise: "Row", weight_lbs: 100 })]),
      day("2026-09-18", [set({ exercise: "Row", weight_lbs: 200 })]),
      day(TODAY, [set({ exercise: "Row", weight_lbs: 999 })]),
    ];
    expect(lastSessionAverage(days, "Row", TODAY)!.weight_lbs).toBe(200);
  });

  it("skips a session that has no sets of that exercise", () => {
    const days = [
      day("2026-09-14", [set({ exercise: "Row", weight_lbs: 100 })]),
      day("2026-09-18", [set({ exercise: "Bench", weight_lbs: 200 })]),
    ];
    expect(lastSessionAverage(days, "Row", TODAY)!.date).toBe("2026-09-14");
  });

  it("ignores inferred rows — those are not something Ryan logged", () => {
    const days = [day("2026-09-18", [
      set({ exercise: "Row", weight_lbs: 500, logged_via: "inferred" }),
    ])];
    expect(lastSessionAverage(days, "Row", TODAY)).toBeNull();
  });

  it("no history at all → null", () => {
    expect(lastSessionAverage([], "Row", TODAY)).toBeNull();
    expect(lastSetsSentence(null)).toBeNull();
  });
});

describe("the sentence", () => {
  const avg = { weight_lbs: 150, reps: 12, rpe: 6, date: "2026-09-18", sets: 3 };

  it("bodyweight omits the weight", () => {
    expect(lastSetsSentence(avg, true)).toBe("Your last sets averaged RPE 6 for 12 reps.");
  });

  it("no RPE on any set omits that clause", () => {
    expect(lastSetsSentence({ ...avg, rpe: null }))
      .toBe("Your last sets averaged at 150 pounds for 12 reps.");
  });

  it("one rep reads as a rep", () => {
    expect(lastSetsSentence({ ...avg, reps: 1 }))
      .toBe("Your last sets averaged RPE 6 at 150 pounds for 1 rep.");
  });

  it("a half-step RPE keeps its half", () => {
    expect(lastSetsSentence({ ...avg, rpe: 6.5 })).toContain("RPE 6.5");
  });
});

describe("the whole prompt", () => {
  const avg = { weight_lbs: 150, reps: 12, rpe: 6, date: "2026-09-18", sets: 3 };

  it("reads as Ryan wrote it", () => {
    expect(exercisePrompt({ name: "Leg press", reps: 12, cap: 6, average: avg })).toBe(
      "Next exercise is leg press. 12 reps at RPE 6. " +
      "Your last sets averaged RPE 6 at 150 pounds for 12 reps.",
    );
  });

  it("no history says so plainly", () => {
    expect(exercisePrompt({ name: "Leg press", reps: 12, cap: 6, average: null })).toBe(
      "Next exercise is leg press. 12 reps at RPE 6. First time logging this one.",
    );
  });

  it("a bodyweight exercise leaves the weight out", () => {
    expect(exercisePrompt({ name: "Hollow hold", reps: 12, cap: 6, average: avg, bodyweight: true }))
      .toContain("averaged RPE 6 for 12 reps");
  });

  it("a cardio-ish entry with no reps still announces the exercise", () => {
    expect(exercisePrompt({ name: "Plank", average: null }))
      .toBe("Next exercise is plank. First time logging this one.");
  });
});

describe("skipping a prompt that wouldn't finish", () => {
  const text = "Next exercise is leg press. 12 reps at RPE 6. " +
    "Your last sets averaged RPE 6 at 150 pounds for 12 reps.";

  it("a normal rest is long enough", () => {
    expect(fitsInRest(text, 60)).toBe(true);
    expect(fitsInRest(text, 90)).toBe(true);
  });

  it("a short rest skips it rather than talking over the next set", () => {
    expect(fitsInRest(text, 5)).toBe(false);
    expect(fitsInRest(text, 3)).toBe(false);
  });

  it("a slower rate needs more room", () => {
    const fast = utteranceMs(text, 1.0);
    const slow = utteranceMs(text, 0.7);
    expect(slow).toBeGreaterThan(fast);
  });

  it("the estimate is generous — the cost of over-running is talking over a set", () => {
    // ~19 words at 0.85 ≈ 9.3 s. It should not claim to fit in 8.
    expect(fitsInRest(text, 8)).toBe(false);
    expect(fitsInRest(text, 15)).toBe(true);
  });
});


describe("when the prompt fires", () => {
  // Two rounds of three exercises, each with a rest after it — the real shape.
  const BLOCKS = {
    type: "circuit", rounds: 2, rest_between_rounds_sec: 90,
    exercises: [
      { name: "Leg press", format: "reps", target_reps: 12, rest_after_sec: 60 },
      { name: "DB bench press", format: "reps", target_reps: 12, rest_after_sec: 60 },
      { name: "Lat pulldown", format: "reps", target_reps: 12, rest_after_sec: 60 },
    ],
  } as unknown as CircuitBlocks;
  const steps = flattenBlocksToSteps(BLOCKS).steps;

  /** Walk the whole session the way the screen does: the circuit body once per
   * round, because steps are not unrolled — the cursor wraps and counts. */
  function walk(rounds = 2) {
    const spoken = new Set<string>();
    const fired: Array<{ index: number; round: number; name: string }> = [];
    for (let round = 1; round <= rounds; round++) {
      for (let i = 0; i < steps.length; i++) {
        const t = promptTarget(steps, i, spoken, round);
        if (!t) continue;
        spoken.add(t.key);
        // the key carries the round it ANNOUNCES, which for a round break is
        // the next one, not the one being walked
        fired.push({ index: i, round: Number(t.key.split(":")[0]), name: t.exercise.name });
      }
    }
    return fired;
  }

  it("once per exercise PER ROUND — round 2 is prompted again", () => {
    // GD-ROUND-CUES (Ryan, at the gym 2026-09-23). Round 1 announces the two
    // exercises that have a rest ahead of them, then the round break announces
    // round 2's first; round 2 announces its own two.
    expect(walk().map((f) => `${f.round}:${f.name}`)).toEqual([
      "1:DB bench press", "1:Lat pulldown", "2:Leg press",
      "2:DB bench press", "2:Lat pulldown",
    ]);
  });

  it("every exercise is announced exactly once in each round", () => {
    const fired = walk();
    for (const round of [1, 2]) {
      const names = fired.filter((f) => f.round === round).map((f) => f.name);
      expect(new Set(names).size).toBe(names.length);
    }
    expect(fired.filter((f) => f.round === 2).length).toBe(3);   // all three
  });

  it("never before the FIRST exercise of round 1 — nothing rests ahead of it", () => {
    expect(walk().some((f) => f.round === 1 && f.name === "Leg press")).toBe(false);
  });

  it("the round break announces the next round's first exercise", () => {
    const rb = steps.findIndex((st) => st.isRoundBreak);
    const t = promptTarget(steps, rb, new Set(), 1);
    expect(t?.exercise.name).toBe("Leg press");
    expect(t?.key).toBe("2:Leg press");
  });

  it("the FINAL round break says nothing — the cooldown is next, not a round", () => {
    const rb = steps.findIndex((st) => st.isRoundBreak);
    expect(promptTarget(steps, rb, new Set(), 2)).toBeNull();
  });

  it("fires on a REST step, and the exercise it names is the one that follows", () => {
    for (const f of walk()) {
      const step = steps[f.index];
      expect(step.kind).toBe("rest");
      if (step.isRoundBreak) {
        // the cursor wraps: the circuit's first exercise, in the next round
        const first = steps.find((st) => st.kind === "exercise"
                                 && st.circuitId === step.circuitId);
        expect(first!.exerciseRef!.name).toBe(f.name);
      } else {
        expect(steps[f.index + 1].kind).toBe("exercise");
        expect(steps[f.index + 1].exerciseRef!.name).toBe(f.name);
      }
    }
  });

  it("never between sets of the same exercise", () => {
    // A rest whose preceding exercise is also the one coming up.
    const interSet = steps.findIndex(
      (st, i) => st.kind === "rest"
        && st.precedingExerciseRef?.name === steps[i + 1]?.exerciseRef?.name,
    );
    if (interSet >= 0) expect(promptTarget(steps, interSet, new Set(), 1)).toBeNull();
  });

  it("carries the rest length, so a short rest can be skipped", () => {
    const first = steps.findIndex((_, i) => promptTarget(steps, i, new Set()) !== null);
    expect(promptTarget(steps, first, new Set())!.restSec).toBe(60);
  });
});
