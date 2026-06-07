import { describe, expect, it } from "vitest";
import {
  buildIntervals,
  initTimer,
  selectCurrent,
  selectElapsedSec,
  selectRemainingSec,
  timerReducer,
} from "../src/lib/timer";
import type {
  Blocks,
  CircuitBlocks,
  IntervalsBlocks,
  MobilityBlocks,
  SteadyBlocks,
  WalkBlocks,
} from "../src/lib/types";

const circuit: CircuitBlocks = {
  type: "circuit",
  warmup: "5 min bike easy",
  rounds: 2,
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

describe("buildIntervals — circuit", () => {
  const intervals = buildIntervals(circuit);

  it("produces warmup, work, rest, work, round_break, ..., cooldown", () => {
    const kinds = intervals.map((i) => i.kind);
    expect(kinds).toEqual([
      "warmup",
      "work", "rest",            // round 1, ex 0
      "work", "round_break",     // round 1, ex 1 (last) → round break
      "work", "rest",            // round 2, ex 0
      "work",                    // round 2, ex 1 (last, last round → no rest, no round_break)
      "cooldown",
    ]);
  });

  it("parses warmup duration from leading minutes", () => {
    expect(intervals[0].kind).toBe("warmup");
    expect(intervals[0].duration_sec).toBe(300);
  });

  it("parses cooldown duration from leading minutes", () => {
    const last = intervals[intervals.length - 1];
    expect(last.kind).toBe("cooldown");
    expect(last.duration_sec).toBe(480);
  });

  it("computes work duration for reps as max(30, reps*4)", () => {
    const goblet = intervals[1];
    expect(goblet.kind).toBe("work");
    expect(goblet.name).toBe("Goblet squat");
    expect(goblet.duration_sec).toBe(40); // 10 * 4
    expect(goblet.reps).toBe(10);
    expect(goblet.load_lbs).toBe(30);
  });

  it("uses duration_sec for duration-format exercises", () => {
    const plank = intervals[3];
    expect(plank.name).toBe("Plank");
    expect(plank.duration_sec).toBe(30);
  });

  it("tags rounds on work intervals", () => {
    const round1 = intervals[1];
    const round2 = intervals[5];
    expect(round1.round).toBe(1);
    expect(round1.total_rounds).toBe(2);
    expect(round2.round).toBe(2);
  });
});

describe("buildIntervals — cardio", () => {
  const intervals = buildIntervals(cardio);

  it("produces warmup, work/rest x rounds (no rest after last), cooldown", () => {
    const kinds = intervals.map((i) => i.kind);
    expect(kinds).toEqual([
      "warmup",
      "work", "rest",
      "work", "rest",
      "work",
      "cooldown",
    ]);
  });
});

describe("buildIntervals — walk", () => {
  it("produces a single work interval of duration_min minutes", () => {
    const intervals = buildIntervals(walk);
    expect(intervals).toHaveLength(1);
    expect(intervals[0].kind).toBe("work");
    expect(intervals[0].duration_sec).toBe(45 * 60);
  });
});

describe("buildIntervals — steady (cardio steady — no top-level exercises)", () => {
  const steady: SteadyBlocks = {
    type: "steady",
    display_name: "Long Z2 Bike",
    warmup_sec: 300,
    duration_min: 45,
    cooldown_sec: 300,
    intensity: "Z2 — conversational",
    target_range_min: [40, 50],
  };

  it("does NOT crash on missing exercises array — produces warmup + main + cooldown", () => {
    const intervals = buildIntervals(steady);
    expect(intervals.map((i) => i.kind)).toEqual(["warmup", "work", "cooldown"]);
  });

  it("uses display_name as the main interval name", () => {
    const intervals = buildIntervals(steady);
    expect(intervals[1].name).toBe("Long Z2 Bike");
    expect(intervals[1].duration_sec).toBe(45 * 60);
  });

  it("falls back to 'Steady cardio' when display_name is absent", () => {
    const noName: SteadyBlocks = { ...steady, display_name: undefined };
    const intervals = buildIntervals(noName);
    expect(intervals[1].name).toBe("Steady cardio");
  });

  it("renders target_range_min as N–M min when intensity is absent", () => {
    const noIntensity: SteadyBlocks = { ...steady, intensity: undefined };
    const intervals = buildIntervals(noIntensity);
    expect(intervals[1].description).toBe("40–50 min");
  });
});

describe("buildIntervals — mobility (rest day)", () => {
  const mob: MobilityBlocks = {
    type: "mobility",
    notes: "20 min of T-spine + hip mobility",
    duration_min: 20,
  };

  it("produces a single work interval and does not crash", () => {
    const intervals = buildIntervals(mob);
    expect(intervals).toHaveLength(1);
    expect(intervals[0].kind).toBe("work");
    expect(intervals[0].duration_sec).toBe(20 * 60);
    expect(intervals[0].description).toBe("20 min of T-spine + hip mobility");
  });
});

describe("buildIntervals — defensive guards", () => {
  it("does not crash when a circuit block has no exercises field at all", () => {
    const broken = {
      type: "circuit",
      warmup: "5 min easy",
      cooldown: "5 min easy",
    } as unknown as CircuitBlocks;
    const intervals = buildIntervals(broken);
    // warmup + cooldown only — no exercises to add
    expect(intervals.map((i) => i.kind)).toEqual(["warmup", "cooldown"]);
  });

  it("does not crash when a circuit block has exercises = null", () => {
    const broken = {
      type: "circuit",
      exercises: null,
    } as unknown as CircuitBlocks;
    const intervals = buildIntervals(broken);
    expect(intervals).toEqual([]);
  });

  it("does not crash when an intervals block lacks intervals_template", () => {
    const broken = {
      type: "intervals",
      warmup_sec: 300,
      rounds: 5,
      cooldown_sec: 300,
    } as unknown as IntervalsBlocks;
    const intervals = buildIntervals(broken);
    // warmup + cooldown only; template missing → no work/rest blocks
    expect(intervals.map((i) => i.kind)).toEqual(["warmup", "cooldown"]);
  });
});

describe("buildIntervals — finisher", () => {
  const cardioWithFinisher: IntervalsBlocks = {
    type: "intervals",
    warmup_sec: 0,
    intervals_template: { work_sec: 60, rest_sec: 60 },
    rounds: 2,
    cooldown_sec: 0,
    finisher: {
      type: "core_circuit",
      rounds: 2,
      rest_after_sec: 60,
      exercises: [
        { name: "Dead bug", format: "reps", target_reps: 10 },
        { name: "Hollow hold", format: "duration", duration_sec: 20 },
      ],
    },
  };

  it("appends finisher exercises after the main block", () => {
    const intervals = buildIntervals(cardioWithFinisher);
    const names = intervals.map((i) => i.name);
    // 2 rounds × (work + rest), last rest skipped → work, rest, work
    // Then finisher: dead bug, rest, hollow hold, round_break, dead bug, rest, hollow hold
    expect(names).toContain("Dead bug");
    expect(names).toContain("Hollow hold");
    // round_break between finisher rounds present
    expect(intervals.some((i) => i.kind === "round_break")).toBe(true);
  });

  it("treats an empty finisher.exercises as no-op", () => {
    const noEx = {
      ...cardioWithFinisher,
      finisher: { type: "x", rounds: 2, exercises: [] },
    } satisfies Blocks;
    const intervals = buildIntervals(noEx);
    expect(intervals.every((i) => i.name !== "Dead bug")).toBe(true);
  });
});

describe("timerReducer", () => {
  it("starts and runs through warmup → work transition", () => {
    const intervals = buildIntervals(circuit);
    let s = initTimer(intervals);
    s = timerReducer(s, { type: "START", now_ms: 0 });
    expect(s.status).toBe("running");
    expect(selectCurrent(s)?.kind).toBe("warmup");
    expect(selectRemainingSec(s, 0)).toBe(300);

    // halfway through warmup
    expect(selectRemainingSec(s, 150_000)).toBe(150);

    // tick at end of warmup
    s = timerReducer(s, { type: "TICK", now_ms: 300_000 });
    expect(selectCurrent(s)?.kind).toBe("work");
    expect(selectCurrent(s)?.name).toBe("Goblet squat");
  });

  it("transitions work → rest", () => {
    const intervals = buildIntervals(circuit);
    let s = initTimer(intervals);
    s = timerReducer(s, { type: "START", now_ms: 0 });
    // skip past warmup (300s) + first work (40s) → 340s
    s = timerReducer(s, { type: "TICK", now_ms: 340_001 });
    expect(selectCurrent(s)?.kind).toBe("rest");
  });

  it("reaches round_break after last exercise of non-final round", () => {
    const intervals = buildIntervals(circuit);
    let s = initTimer(intervals);
    s = timerReducer(s, { type: "START", now_ms: 0 });
    // warmup 300 + work 40 + rest 60 + work 30 = 430s → round_break starts at 430s
    s = timerReducer(s, { type: "TICK", now_ms: 430_001 });
    expect(selectCurrent(s)?.kind).toBe("round_break");
  });

  it("transitions to next round after round_break", () => {
    const intervals = buildIntervals(circuit);
    let s = initTimer(intervals);
    s = timerReducer(s, { type: "START", now_ms: 0 });
    // ... + round_break 120 = 550s → round 2 ex 0 work begins
    s = timerReducer(s, { type: "TICK", now_ms: 550_001 });
    const cur = selectCurrent(s);
    expect(cur?.kind).toBe("work");
    expect(cur?.round).toBe(2);
  });

  it("reaches done after the final interval", () => {
    const intervals = buildIntervals(circuit);
    const total_ms = intervals.reduce((acc, iv) => acc + iv.duration_sec * 1000, 0);
    let s = initTimer(intervals);
    s = timerReducer(s, { type: "START", now_ms: 0 });
    s = timerReducer(s, { type: "TICK", now_ms: total_ms + 1 });
    expect(s.status).toBe("done");
  });

  it("RESET returns to idle", () => {
    const intervals = buildIntervals(circuit);
    let s = initTimer(intervals);
    s = timerReducer(s, { type: "START", now_ms: 0 });
    s = timerReducer(s, { type: "TICK", now_ms: 500_000 });
    s = timerReducer(s, { type: "RESET" });
    expect(s.status).toBe("idle");
    expect(s.current_index).toBe(0);
  });
});

describe("timerReducer — controls", () => {
  function start() {
    return timerReducer(initTimer(buildIntervals(circuit)), { type: "START", now_ms: 0 });
  }

  it("PAUSE freezes remaining_sec; later ticks don't advance it", () => {
    let s = start(); // warmup, 300s
    // 100s in
    expect(selectRemainingSec(s, 100_000)).toBe(200);
    s = timerReducer(s, { type: "PAUSE", now_ms: 100_000 });
    expect(s.status).toBe("paused");
    // even with now_ms much later, remaining still 200s
    expect(selectRemainingSec(s, 500_000)).toBe(200);
    expect(selectElapsedSec(s, 500_000)).toBe(100);
  });

  it("RESUME shifts anchors so the pause gap doesn't count toward elapsed", () => {
    let s = start();
    s = timerReducer(s, { type: "PAUSE", now_ms: 100_000 });
    // 60 seconds pass while paused
    s = timerReducer(s, { type: "RESUME", now_ms: 160_000 });
    expect(s.status).toBe("running");
    // 30 more seconds tick in running state → elapsed = 130, remaining = 170
    expect(selectElapsedSec(s, 190_000)).toBe(130);
    expect(selectRemainingSec(s, 190_000)).toBe(170);
  });

  it("RESTART_INTERVAL resets the current interval's remaining without resetting total elapsed", () => {
    let s = start();
    // advance into warmup
    s = timerReducer(s, { type: "TICK", now_ms: 200_000 });
    expect(selectRemainingSec(s, 200_000)).toBe(100);
    s = timerReducer(s, { type: "RESTART_INTERVAL", now_ms: 200_000 });
    expect(selectRemainingSec(s, 200_000)).toBe(300);
    // total elapsed since workout start is still 200s
    expect(selectElapsedSec(s, 200_000)).toBe(200);
  });

  it("PREV_INTERVAL goes back one and clamps at zero", () => {
    let s = start();
    s = timerReducer(s, { type: "TICK", now_ms: 340_001 }); // into goblet squat rest? past warmup+work
    expect(s.current_index).toBeGreaterThan(0);
    const before = s.current_index;
    s = timerReducer(s, { type: "PREV_INTERVAL", now_ms: 340_001 });
    expect(s.current_index).toBe(before - 1);
    // calling PREV at index 0 stays at 0
    s = timerReducer(s, { type: "PREV_INTERVAL", now_ms: 340_001 });
    s = timerReducer(s, { type: "PREV_INTERVAL", now_ms: 340_001 });
    s = timerReducer(s, { type: "PREV_INTERVAL", now_ms: 340_001 });
    expect(s.current_index).toBe(0);
  });

  it("NEXT_INTERVAL advances; past last interval transitions to done", () => {
    const intervals = buildIntervals(walk);
    let s = timerReducer(initTimer(intervals), { type: "START", now_ms: 0 });
    expect(s.current_index).toBe(0);
    s = timerReducer(s, { type: "NEXT_INTERVAL", now_ms: 1_000 });
    expect(s.status).toBe("done");
  });

  it("RESTART_WORKOUT returns to index 0 and resets elapsed", () => {
    let s = start();
    s = timerReducer(s, { type: "TICK", now_ms: 500_000 });
    expect(s.current_index).toBeGreaterThan(0);
    s = timerReducer(s, { type: "RESTART_WORKOUT", now_ms: 600_000 });
    expect(s.status).toBe("running");
    expect(s.current_index).toBe(0);
    expect(selectElapsedSec(s, 600_000)).toBe(0);
  });

  it("END_WORKOUT immediately sets status=done", () => {
    let s = start();
    s = timerReducer(s, { type: "TICK", now_ms: 100_000 });
    s = timerReducer(s, { type: "END_WORKOUT" });
    expect(s.status).toBe("done");
  });

});
