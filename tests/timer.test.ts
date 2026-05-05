import { describe, expect, it } from "vitest";
import {
  buildIntervals,
  initTimer,
  selectCurrent,
  selectRemainingSec,
  timerReducer,
} from "../src/lib/timer";
import type { CircuitBlocks, IntervalsBlocks, WalkBlocks } from "../src/lib/types";

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
