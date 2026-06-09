import { describe, expect, it } from "vitest";
import {
  buildCompletionMap,
  computePrefill,
  isFullyLogged,
  loggedCountFor,
  nextSetNumFor,
  previousSetFor,
  totalSetsFor,
  type SessionSets,
  type ServerLoggedCount,
} from "../src/lib/log-state";
import type { Plan } from "../src/lib/types";

const CIRCUIT: Plan = {
  plan_id: 1,
  plan_date: "2026-06-08",
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
    exercises: [
      { name: "Goblet squat", format: "reps", target_reps: 10, target_load_lbs: 35, rest_after_sec: 60 },
      { name: "Plank", format: "duration", duration_sec: 30, rest_after_sec: 60 },
    ],
    finisher: {
      rounds: 2,
      exercises: [
        { name: "Plank", format: "duration", duration_sec: 20 },
        { name: "Dead bug", format: "reps", target_reps: 10 },
      ],
    },
  },
};

const STRAIGHT_SETS_HYPOTHETICAL: Plan = {
  ...CIRCUIT,
  blocks: {
    type: "circuit",
    rounds: 1,
    rest_between_rounds_sec: 60,
    exercises: [
      // Same name appearing 3 times — current plans never do this, but the
      // helper is supposed to handle it.
      { name: "Bench press", format: "reps", target_reps: 5 },
      { name: "Bench press", format: "reps", target_reps: 5 },
      { name: "Bench press", format: "reps", target_reps: 5 },
    ],
  },
};

describe("totalSetsFor", () => {
  it("circuit with rounds=3 and one occurrence → 3 sets", () => {
    expect(totalSetsFor(CIRCUIT, "Goblet squat")).toBe(3);
  });

  it("exercise present in main AND finisher → sums both (main rounds × occ + finisher rounds × occ)", () => {
    // Plank: main rounds=3 × occ=1 + finisher rounds=2 × occ=1 = 5
    expect(totalSetsFor(CIRCUIT, "Plank")).toBe(5);
  });

  it("straight-sets (same name × N in exercises[]) → N × rounds", () => {
    expect(totalSetsFor(STRAIGHT_SETS_HYPOTHETICAL, "Bench press")).toBe(3);
  });

  it("unknown name falls back to 1 (not 0)", () => {
    expect(totalSetsFor(CIRCUIT, "Unknown")).toBe(1);
  });
});

describe("loggedCountFor / nextSetNumFor", () => {
  it("starts at 0 / next=1 with no state", () => {
    expect(loggedCountFor("Goblet squat", {}, {})).toBe(0);
    expect(nextSetNumFor("Goblet squat", {}, {})).toBe(1);
  });

  it("counts sessionSets entries", () => {
    const sess: SessionSets = {
      "Goblet squat": [
        { set_num: 1, weight_lbs: 35, reps_done: 10, rpe_actual: 7 },
        { set_num: 2, weight_lbs: 35, reps_done: 10, rpe_actual: 8 },
      ],
    };
    expect(loggedCountFor("Goblet squat", sess, {})).toBe(2);
    expect(nextSetNumFor("Goblet squat", sess, {})).toBe(3);
  });

  it("uses serverLoggedCount when sessionSets is empty (mid-workout reload)", () => {
    const server: ServerLoggedCount = { "Goblet squat": 2 };
    expect(loggedCountFor("Goblet squat", {}, server)).toBe(2);
    expect(nextSetNumFor("Goblet squat", {}, server)).toBe(3);
  });

  it("takes max(sessionSets, serverLoggedCount)", () => {
    const sess: SessionSets = {
      "Goblet squat": [{ set_num: 1, weight_lbs: 35, reps_done: 10, rpe_actual: 7 }],
    };
    const server: ServerLoggedCount = { "Goblet squat": 2 };
    expect(loggedCountFor("Goblet squat", sess, server)).toBe(2);
  });
});

describe("previousSetFor", () => {
  it("returns the most-recent session entry, or null", () => {
    expect(previousSetFor("Goblet squat", {})).toBeNull();
    const sess: SessionSets = {
      "Goblet squat": [
        { set_num: 1, weight_lbs: 35, reps_done: 10, rpe_actual: 7 },
        { set_num: 2, weight_lbs: 40, reps_done: 10, rpe_actual: 8 },
      ],
    };
    const prev = previousSetFor("Goblet squat", sess);
    expect(prev?.set_num).toBe(2);
    expect(prev?.weight_lbs).toBe(40);
  });
});

describe("isFullyLogged", () => {
  it("3-set circuit becomes fully logged after 3 sessionSets entries", () => {
    const sess: SessionSets = {
      "Goblet squat": [
        { set_num: 1, weight_lbs: 35, reps_done: 10, rpe_actual: 7 },
        { set_num: 2, weight_lbs: 40, reps_done: 10, rpe_actual: 8 },
      ],
    };
    expect(isFullyLogged("Goblet squat", CIRCUIT, sess, {})).toBe(false);
    sess["Goblet squat"].push({ set_num: 3, weight_lbs: 45, reps_done: 8, rpe_actual: 10 });
    expect(isFullyLogged("Goblet squat", CIRCUIT, sess, {})).toBe(true);
  });

  it("Plank (3 main + 2 finisher = 5 total) needs 5 entries", () => {
    const partial: SessionSets = { Plank: Array.from({ length: 4 }, (_, i) => ({
      set_num: i + 1, weight_lbs: null, reps_done: null, rpe_actual: 6,
    }))};
    expect(isFullyLogged("Plank", CIRCUIT, partial, {})).toBe(false);
    partial.Plank.push({ set_num: 5, weight_lbs: null, reps_done: null, rpe_actual: 7 });
    expect(isFullyLogged("Plank", CIRCUIT, partial, {})).toBe(true);
  });
});

describe("computePrefill — divergence-friendly priority", () => {
  it("starts from plan target when nothing logged", () => {
    const p = computePrefill("Goblet squat", "reps", 35, 10, null, {}, null);
    expect(p.weight).toBe(35);
    expect(p.reps).toBe(10);
    expect(p.rpe).toBeNull();
  });

  it("falls back to last-session entry when no this-session set", () => {
    const last = { weight_lbs: 40, reps_done: 9 };
    const p = computePrefill("Goblet squat", "reps", 35, 10, null, {}, last);
    expect(p.weight).toBe(40);
    expect(p.reps).toBe(9);
  });

  it("PRIORITISES the previous set THIS session over last-session and over target", () => {
    const sess: SessionSets = {
      "Goblet squat": [{ set_num: 1, weight_lbs: 30, reps_done: 12, rpe_actual: 8 }],
    };
    const last = { weight_lbs: 40, reps_done: 9 };
    const p = computePrefill("Goblet squat", "reps", 35, 10, null, sess, last);
    // From previous-set-this-session: 30 lb / 12 reps / RPE 8
    expect(p.weight).toBe(30);
    expect(p.reps).toBe(12);
    expect(p.rpe).toBe(8);
  });

  it("set 3 prefills from set 2's actual values (surfacing divergence)", () => {
    const sess: SessionSets = {
      "DB RDL": [
        { set_num: 1, weight_lbs: 30, reps_done: 12, rpe_actual: 7 },
        { set_num: 2, weight_lbs: 30, reps_done: 12, rpe_actual: 8 },
      ],
    };
    const p = computePrefill("DB RDL", "reps", 30, 12, null, sess, null);
    expect(p.weight).toBe(30);
    expect(p.reps).toBe(12);
    expect(p.rpe).toBe(8);
    // Then user actively bumps to 40 + RPE 10 — the spec scenario.
  });
});

describe("buildCompletionMap", () => {
  it("returns logged + total for each exercise name", () => {
    const sess: SessionSets = {
      "Goblet squat": [
        { set_num: 1, weight_lbs: 35, reps_done: 10, rpe_actual: 7 },
      ],
    };
    const names = new Set(["Goblet squat", "Plank"]);
    const m = buildCompletionMap(CIRCUIT, names, sess, {});
    expect(m.get("Goblet squat")).toEqual({ logged: 1, total: 3 });
    expect(m.get("Plank")).toEqual({ logged: 0, total: 5 });
  });
});
