import { describe, expect, it } from "vitest";
import { shouldRedirectTodayToStatus } from "../src/lib/routing";
import { perExerciseDeltas, bestStrengthSetsByExercise } from "../src/lib/status-analysis";
import type { LoggedSession } from "../src/lib/types";

describe("shouldRedirectTodayToStatus", () => {
  const base = { exists: true, is_skipped: false, is_logged: false, session_type: "strength_a" as string | null };

  it("redirects when no plan exists for today", () => {
    expect(shouldRedirectTodayToStatus({ ...base, exists: false })).toBe(true);
  });

  it("redirects when today is skipped", () => {
    expect(shouldRedirectTodayToStatus({ ...base, is_skipped: true })).toBe(true);
  });

  it("redirects when today is a rest_mobility day", () => {
    expect(shouldRedirectTodayToStatus({ ...base, session_type: "rest_mobility" })).toBe(true);
  });

  it("redirects when today has already been logged", () => {
    expect(shouldRedirectTodayToStatus({ ...base, is_logged: true })).toBe(true);
  });

  it("does NOT redirect when today is a normal unlogged session", () => {
    expect(shouldRedirectTodayToStatus(base)).toBe(false);
  });
});

function mkSession(
  session_type: LoggedSession["session_type"],
  plan_date: string,
  exercises: LoggedSession["exercises"]
): LoggedSession {
  return {
    plan_id: Math.floor(Math.random() * 100000),
    plan_date,
    session_type,
    phase: 1,
    week_num: 1,
    rpe_actual: 7,
    logged_at: `${plan_date}T19:00:00Z`,
    notes: null,
    exercises,
  };
}

describe("bestStrengthSetsByExercise", () => {
  it("returns the heaviest set per exercise", () => {
    const s = mkSession("strength_a", "2026-05-06", [
      { log_type: "strength_set", exercise: "Goblet squat", set_num: 1, reps_done: 10, weight_lbs: 30, duration_sec: null, distance_m: null, hr_avg: null, hr_peak: null, rpe_actual: null, notes: null },
      { log_type: "strength_set", exercise: "Goblet squat", set_num: 2, reps_done: 8,  weight_lbs: 35, duration_sec: null, distance_m: null, hr_avg: null, hr_peak: null, rpe_actual: null, notes: null },
      { log_type: "strength_set", exercise: "DB RDL",       set_num: 1, reps_done: 10, weight_lbs: 30, duration_sec: null, distance_m: null, hr_avg: null, hr_peak: null, rpe_actual: null, notes: null },
    ]);
    const bests = bestStrengthSetsByExercise(s);
    expect(bests.get("Goblet squat")?.weight_lbs).toBe(35);
    expect(bests.get("Goblet squat")?.reps_done).toBe(8);
    expect(bests.get("DB RDL")?.weight_lbs).toBe(30);
  });
});

describe("perExerciseDeltas", () => {
  it("computes weight + reps delta vs history average", () => {
    const current = mkSession("strength_a", "2026-05-12", [
      { log_type: "strength_set", exercise: "Goblet squat", set_num: 1, reps_done: 10, weight_lbs: 35, duration_sec: null, distance_m: null, hr_avg: null, hr_peak: null, rpe_actual: null, notes: null },
    ]);
    const h1 = mkSession("strength_a", "2026-05-05", [
      { log_type: "strength_set", exercise: "Goblet squat", set_num: 1, reps_done: 10, weight_lbs: 30, duration_sec: null, distance_m: null, hr_avg: null, hr_peak: null, rpe_actual: null, notes: null },
    ]);
    const h2 = mkSession("strength_a", "2026-04-28", [
      { log_type: "strength_set", exercise: "Goblet squat", set_num: 1, reps_done: 8,  weight_lbs: 30, duration_sec: null, distance_m: null, hr_avg: null, hr_peak: null, rpe_actual: null, notes: null },
    ]);
    const deltas = perExerciseDeltas(current, [h1, h2]);
    const g = deltas.find((d) => d.exercise === "Goblet squat");
    expect(g).toBeDefined();
    expect(g!.history_avg_weight).toBe(30);
    expect(g!.history_avg_reps).toBe(9);
    expect(g!.weight_delta).toBe(5);
    expect(g!.reps_delta).toBe(1);
    expect(g!.n_history).toBe(2);
  });

  it("returns null deltas when no history for that exercise", () => {
    const current = mkSession("strength_a", "2026-05-12", [
      { log_type: "strength_set", exercise: "Brand new lift", set_num: 1, reps_done: 10, weight_lbs: 25, duration_sec: null, distance_m: null, hr_avg: null, hr_peak: null, rpe_actual: null, notes: null },
    ]);
    const deltas = perExerciseDeltas(current, []);
    const d = deltas[0];
    expect(d.weight_delta).toBeNull();
    expect(d.reps_delta).toBeNull();
    expect(d.n_history).toBe(0);
  });
});
