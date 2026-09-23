import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import UpNextTiles from "../src/components/UpNextTiles";
import type { LastLoggedEntry, Plan, PlannedExercise } from "../src/lib/types";

// GD-REST-TILES (Ryan, 2026-09-23) — the same three tiles, scaled down, in the
// rest screen's upper right, for the exercise the rest leads into.

afterEach(cleanup);

const PLAN = {
  plan_id: 1, plan_date: "2026-09-23", session_type: "strength_a", target_rpe: 6,
  blocks: { type: "circuit", rounds: 2, rpe_cap: 6, exercises: [] },
} as unknown as Plan;

const EX: PlannedExercise = {
  name: "DB bench press", format: "reps", target_reps: 12,
} as unknown as PlannedExercise;

const PRIOR: LastLoggedEntry = {
  exercise: "DB bench press", plan_date: "2026-09-18", weight_lbs: 55, reps_done: 12,
  rpe_actual: 6, duration_sec: null, distance_m: null, hr_avg: null, hr_peak: null,
};

const sub = () => screen.getByTestId("tile-last-sub").textContent;

describe("the rest screen's up-next tiles", () => {
  it("shows the next exercise's name, reps and RPE cap", () => {
    render(<UpNextTiles plan={PLAN} exercise={EX} sessionSets={{}} lastLogged={{}} />);
    expect(screen.getByTestId("upnext-name").textContent).toBe("Next: DB bench press");
    expect(screen.getByTestId("tile-reps").textContent).toContain("12");
    expect(screen.getByTestId("tile-rpe").textContent).toContain("6");
  });

  it("carries the reps-left sub-line, like the set screen", () => {
    render(<UpNextTiles plan={PLAN} exercise={EX} sessionSets={{}} lastLogged={{}} />);
    expect(screen.getByTestId("tile-rpe-sub").textContent).toBe("stop with ~4 reps left");
  });

  it("a first-time exercise says so", () => {
    render(<UpNextTiles plan={PLAN} exercise={EX} sessionSets={{}} lastLogged={{}} />);
    expect(sub()).toBe("first time");
  });

  it("LAST follows the shipped rule: today's round beats the previous session", () => {
    const sets = { "DB bench press": [{ set_num: 1, weight_lbs: 60, reps_done: 12, rpe_actual: 6 }] };
    render(<UpNextTiles plan={PLAN} exercise={EX} sessionSets={sets}
                        lastLogged={{ "DB bench press": PRIOR }} />);
    expect(screen.getByTestId("tile-last").textContent).toContain("60");
    expect(screen.getByTestId("tile-last-label").textContent).toBe("Last — round 1");
  });

  it("falls back to the previous session before anything is logged", () => {
    render(<UpNextTiles plan={PLAN} exercise={EX} sessionSets={{}}
                        lastLogged={{ "DB bench press": PRIOR }} />);
    expect(screen.getByTestId("tile-last").textContent).toContain("55");
    expect(screen.getByTestId("tile-last-label").textContent).toBe("Last");
  });

  it("renders NOTHING when the rest leads nowhere — the final rest", () => {
    const { container } = render(
      <UpNextTiles plan={PLAN} exercise={null} sessionSets={{}} lastLogged={{}} />);
    expect(container.innerHTML).toBe("");
    expect(screen.queryByTestId("upnext-tiles")).toBeNull();
  });

  it("uses the compact tiles, not the full-size set-screen ones", () => {
    render(<UpNextTiles plan={PLAN} exercise={EX} sessionSets={{}} lastLogged={{}} />);
    expect(screen.getByTestId("strength-tiles-compact")).toBeTruthy();
    expect(screen.queryByTestId("strength-tiles")).toBeNull();
    // same DOM as the set screen — three tiles, every line present
    expect(screen.getByTestId("strength-tiles-compact").querySelectorAll(".stile").length).toBe(3);
  });
});
