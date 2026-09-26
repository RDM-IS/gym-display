import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App, { PLAN_POLL_MS } from "../src/App";
import AdjustmentBanner from "../src/components/AdjustmentBanner";
import SetupScreen from "../src/screens/SetupScreen";
import {
  adjustmentHeadline,
  exerciseTags,
  planFingerprint,
} from "../src/lib/adjustment";
import { totalSetsFor } from "../src/lib/log-state";
import { INITIAL_CURSOR, flattenBlocksToSteps, nextCursor, type Cursor } from "../src/lib/steps";
import type { CircuitBlocks, Plan, PlannedExercise, StatusResponse } from "../src/lib/types";

// Friday 9/18 Session B, as Artemis seeds it, and two adjusted variants.
const B_EXERCISES: PlannedExercise[] = [
  { name: "DB goblet squat", format: "reps", target_reps: 12, rest_after_sec: 60, notes: "2×8-12", target_load_lbs: null },
  { name: "Seated cable row", format: "reps", target_reps: 12, rest_after_sec: 60, notes: "2×10-12; log seat + pin setting", target_load_lbs: null },
  { name: "Incline DB press", format: "reps", target_reps: 12, rest_after_sec: 60, notes: "2×8-12", target_load_lbs: null },
  { name: "Leg extension", format: "reps", target_reps: 12, rest_after_sec: 60, notes: "2×10-12; log seat + pin setting", target_load_lbs: null },
  { name: "Rear delt fly", format: "reps", target_reps: 15, rest_after_sec: 60, notes: "2×12-15; log seat + pin setting", target_load_lbs: null },
  { name: "Cable Pallof press", format: "reps", target_reps: 10, rest_after_sec: 60, notes: "2×10 each side", target_load_lbs: null },
  { name: "Seated back extension", format: "reps", target_reps: 12, rest_after_sec: 60, notes: "2×10-12", target_load_lbs: null },
];

function sessionB(blocks: Partial<CircuitBlocks> = {}): Plan {
  return {
    plan_id: 105,
    plan_date: "2026-09-18",
    phase: 1,
    week_num: 1,
    session_type: "strength_b",
    target_rpe: 6,
    est_duration_min: 45,
    is_skipped: false,
    blocks: {
      type: "circuit",
      display_name: "Office Strength B",
      rounds: 2,
      warmup: "5 min elliptical, easy",
      cooldown: "5 min Stretch Trainer",
      rest_between_rounds_sec: 90,
      exercises: B_EXERCISES,
      ...blocks,
    },
  };
}

// "legs sore 3": goblet squat + leg extension → 1 set, RPE ≤5.
const LEGS_EASED = sessionB({
  exercises: B_EXERCISES.map((e) =>
    e.name === "DB goblet squat" || e.name === "Leg extension"
      ? { ...e, sets: 1, rpe_cap: 5, notes: e.notes!.replace("2×", "1×") }
      : e,
  ),
  adjustment: {
    rules_fired: ["ease"],
    eased: ["DB goblet squat", "Leg extension"],
    summary: ["Legs 3/5 → DB goblet squat and leg extension: 1 set, RPE ≤5."],
  },
});

// "sore shoulder 4": four replaced.
const SHOULDER_REPLACED = sessionB({
  exercises: [
    { name: "Leg press", format: "reps", target_reps: 12, notes: "2×10-12", added_by: "checkin", replaces: "DB goblet squat" },
    { name: "Seated leg curl", format: "reps", target_reps: 12, notes: "2×10-12", added_by: "checkin", replaces: "Seated cable row" },
    { name: "Calf press", format: "reps", target_reps: 15, notes: "2×12-15", added_by: "checkin", replaces: "Incline DB press" },
    B_EXERCISES[3],
    { name: "Captain's chair knee raise", format: "reps", target_reps: 12, notes: "2×8-12", added_by: "checkin", replaces: "Rear delt fly" },
    B_EXERCISES[5],
    B_EXERCISES[6],
  ],
  adjustment: {
    rules_fired: ["replace"],
    removed: ["DB goblet squat", "Seated cable row", "Incline DB press", "Rear delt fly"],
    added: ["Leg press", "Seated leg curl", "Calf press", "Captain's chair knee raise"],
    summary: ["Shoulder 4/5 → removed DB goblet squat, seated cable row, incline DB press, rear delt fly. Added leg press, seated leg curl, calf press, captain's chair knee raise."],
  },
});

function walk(plan: Plan): Array<[string, number]> {
  const { steps } = flattenBlocksToSteps(plan.blocks);
  const out: Array<[string, number]> = [];
  let cur: Cursor | null = INITIAL_CURSOR;
  for (let guard = 0; cur && guard < 200; guard++) {
    const s = steps[cur.stepIndex];
    if (s.kind === "exercise") out.push([s.label, cur.currentRound]);
    cur = nextCursor(steps, cur);
  }
  return out;
}

describe("per-exercise sets in a circuit", () => {
  it("an unadjusted circuit runs every exercise in both rounds", () => {
    const seq = walk(sessionB());
    expect(seq).toHaveLength(14);
    expect(seq.filter(([, r]) => r === 2).map(([n]) => n)).toEqual(B_EXERCISES.map((e) => e.name));
  });

  it("a 1-set exercise is skipped in round 2 (and so is its rest)", () => {
    const seq = walk(LEGS_EASED);
    const round2 = seq.filter(([, r]) => r === 2).map(([n]) => n);
    expect(round2).toEqual(["Seated cable row", "Incline DB press", "Rear delt fly",
      "Cable Pallof press", "Seated back extension"]);
    expect(seq.filter(([, r]) => r === 1)).toHaveLength(7);
    const { steps } = flattenBlocksToSteps(LEGS_EASED.blocks);
    // After round 2 the cursor still reaches the cooldown.
    let cur: Cursor | null = INITIAL_CURSOR;
    let last = cur;
    while (cur) { last = cur; cur = nextCursor(steps, cur); }
    expect(steps[last.stepIndex].kind).toBe("cooldown");
  });

  it("a round with nothing left to do is skipped entirely", () => {
    const allOne = sessionB({ exercises: B_EXERCISES.map((e) => ({ ...e, sets: 1 })) });
    const seq = walk(allOne);
    expect(seq.every(([, r]) => r === 1)).toBe(true);
    expect(seq).toHaveLength(7);
  });

  it("set totals follow the per-exercise sets", () => {
    expect(totalSetsFor(LEGS_EASED, "DB goblet squat")).toBe(1);
    expect(totalSetsFor(LEGS_EASED, "Seated cable row")).toBe(2);
    expect(totalSetsFor(sessionB(), "DB goblet squat")).toBe(2);
  });

  it("adjustment mobility becomes a timed step after the cooldown", () => {
    const plan = sessionB({ mobility_min: 5, mobility_focus: ["shoulder"] });
    const { steps } = flattenBlocksToSteps(plan.blocks);
    const i = steps.findIndex((s) => s.label === "5 min mobility (shoulder)");
    expect(i).toBeGreaterThan(steps.findIndex((s) => s.kind === "cooldown"));
    expect(steps[i].duration_sec).toBe(300);
  });
});

describe("adjustment helpers", () => {
  it("headline", () => {
    expect(adjustmentHeadline(SHOULDER_REPLACED.blocks.adjustment!)).toBe("shoulder 4/5");
    expect(adjustmentHeadline(LEGS_EASED.blocks.adjustment!)).toBe("legs 3/5");
    expect(adjustmentHeadline({})).toBe("today's check-in");
  });

  it("tags", () => {
    expect(exerciseTags({ name: "x", format: "reps", rpe_cap: 5 })).toEqual(["RPE ≤5"]);
    expect(exerciseTags({ name: "x", format: "reps", load_pct: 80 })).toEqual(["load −20%"]);
    expect(exerciseTags({ name: "x", format: "reps", added_by: "checkin", replaces: "Rear delt fly" }))
      .toEqual(["added (for Rear delt fly)"]);
    expect(exerciseTags({ name: "x", format: "reps" })).toEqual([]);
    expect(exerciseTags({ name: "x", format: "reps" }, 5)).toEqual(["RPE ≤5"]);
  });

  it("fingerprint ignores key order but not content", () => {
    const a = sessionB();
    const b = { ...a, blocks: { ...a.blocks } };
    expect(planFingerprint(a)).toBe(planFingerprint(b));
    expect(planFingerprint(a)).not.toBe(planFingerprint(LEGS_EASED));
  });
});

describe("AdjustmentBanner", () => {
  afterEach(cleanup);

  it("shows the headline and expands to removed/added", () => {
    render(<AdjustmentBanner adjustment={SHOULDER_REPLACED.blocks.adjustment!} />);
    const head = screen.getByRole("button", { name: /Adjusted: shoulder 4\/5 — tap for details/ });
    expect(screen.queryByText(/Removed:/)).toBeNull();
    fireEvent.click(head);
    expect(screen.getByText("Removed:").parentElement!.textContent)
      .toBe("Removed: DB goblet squat, Seated cable row, Incline DB press, Rear delt fly");
    expect(screen.getByText("Added:").parentElement!.textContent)
      .toBe("Added: Leg press, Seated leg curl, Calf press, Captain's chair knee raise");
  });

  it("the Setup screen shows the banner, set counts and badges", () => {
    render(<SetupScreen plan={LEGS_EASED} interrupted={false} onStart={() => {}} />);
    expect(screen.getByTestId("adjustment-banner")).toBeTruthy();
    const goblet = screen.getByText("DB goblet squat").closest("li")!;
    expect(goblet.textContent).toContain("1 set × ");
    expect(goblet.textContent).toContain("RPE ≤5");
    const row = screen.getByText("Seated cable row").closest("li")!;
    expect(row.textContent).not.toContain("RPE");
  });

  it("no banner on an unadjusted plan", () => {
    render(<SetupScreen plan={sessionB()} interrupted={false} onStart={() => {}} />);
    expect(screen.queryByTestId("adjustment-banner")).toBeNull();
  });

  // LOCATION-1 (2026-09-26): the row used to carry the OFFICE warmup wherever the
  // session happened, so a Richfield lift told Ryan to use an elliptical and a
  // Stretch Trainer that are not in that room. The box now omits both and sets
  // `prep_unknown`; the screen has to say so rather than render nothing.
  it("says so when the location has no configured warmup or cooldown", () => {
    const atRichfield = sessionB({
      location_key: "richfield",
      warmup: null,
      cooldown: null,
      prep_unknown: true,
    });
    render(<SetupScreen plan={atRichfield} interrupted={false} onStart={() => {}} />);
    expect(screen.getByTestId("warmup-unknown").textContent)
      .toContain("Not configured for this location");
    expect(screen.getByTestId("cooldown-unknown")).toBeTruthy();
    // and NEITHER office string is anywhere on the screen
    expect(screen.queryByText(/elliptical/i)).toBeNull();
    expect(screen.queryByText(/Stretch Trainer/i)).toBeNull();
  });

  it("an office row still shows its real warmup and cooldown", () => {
    render(<SetupScreen plan={sessionB()} interrupted={false} onStart={() => {}} />);
    expect(screen.getByText("5 min elliptical, easy")).toBeTruthy();
    expect(screen.getByText("5 min Stretch Trainer")).toBeTruthy();
    expect(screen.queryByTestId("warmup-unknown")).toBeNull();
    expect(screen.queryByTestId("cooldown-unknown")).toBeNull();
  });

  it("a session that simply has no warmup stays silent, flag absent", () => {
    render(<SetupScreen plan={sessionB({ warmup: null, cooldown: null })}
                        interrupted={false} onStart={() => {}} />);
    expect(screen.queryByTestId("warmup-unknown")).toBeNull();
    expect(screen.queryByTestId("cooldown-unknown")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// App: refetch on focus/visibility, poll until the first set, hold mid-workout
// ---------------------------------------------------------------------------

function status(): StatusResponse {
  return {
    today: "2026-09-18", window_start: "2026-09-13", window_end: "2026-09-23",
    today_summary: { plan_id: 105, session_type: "strength_b", is_skipped: false, is_logged: false, exists: true },
    banner: { phase: 1, week_num: 1, phase_name: "Foundation", as_of_date: "2026-09-18" },
    day_strip: [], most_recent_session: null, same_type_history: [], rpe_trend: [], weight_trend: [],
  };
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("App keeps today's plan fresh", () => {
  let served: Plan;
  let setsLogged: number;
  let todayCalls: number;

  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, "", "/today");
    served = sessionB();
    setsLogged = 0;
    todayCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/health/today/logged")) {
        return json({ plan_id: 105, has_session_summary: false,
          exercises: setsLogged ? [{ exercise: "Seated cable row", set_count: setsLogged }] : [] });
      }
      if (url.includes("/api/health/today")) { todayCalls++; return json(served); }
      if (url.includes("/api/health/status")) return json(status());
      if (url.includes("/api/health/last_logged")) return json({ by_exercise: {} });
      return json({});
    }));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function flush() {
    for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
  }

  it("a visibility change picks up an adjustment made after load", async () => {
    render(<App />);
    expect(await screen.findByText("Office Strength B")).toBeTruthy();
    expect(screen.queryByTestId("adjustment-banner")).toBeNull();
    served = SHOULDER_REPLACED;
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(await screen.findByTestId("adjustment-banner")).toBeTruthy();
    expect(screen.getByText("Leg press")).toBeTruthy();
    expect(screen.queryByText("Rear delt fly")).toBeNull();
  });

  it("polls every 60 s until the first set is logged, then stops", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<App />);
    await flush();
    expect(screen.getByText("Office Strength B")).toBeTruthy();
    const base = todayCalls;

    served = LEGS_EASED;
    await act(async () => { vi.advanceTimersByTime(PLAN_POLL_MS); });
    await flush();
    expect(todayCalls).toBe(base + 1);
    expect(screen.getByTestId("adjustment-banner")).toBeTruthy();

    setsLogged = 1;                                   // first set lands
    await act(async () => { vi.advanceTimersByTime(PLAN_POLL_MS); });
    await flush();
    const afterStop = todayCalls;
    await act(async () => { vi.advanceTimersByTime(PLAN_POLL_MS * 3); });
    await flush();
    expect(todayCalls).toBe(afterStop);              // no more polling
  });

  it("mid-workout, a changed plan is held — then applied back on Setup", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /start workout/i }));
    await flush();
    const heading = () => document.body.textContent ?? "";
    expect(heading()).not.toContain("Leg press");

    served = SHOULDER_REPLACED;
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await flush();
    // Still on the original plan's steps: nothing shifted under Ryan.
    expect(heading()).not.toContain("Leg press");
    expect(screen.queryByTestId("adjustment-banner")).toBeNull();

    // Back on Setup, the held plan is applied.
    fireEvent.click(screen.getByRole("button", { name: /more/i }));
    fireEvent.click(screen.getByRole("button", { name: "Back to home" }));
    await flush();
    expect(screen.getByTestId("adjustment-banner")).toBeTruthy();
    expect(screen.getByText("Leg press")).toBeTruthy();
  });
});
