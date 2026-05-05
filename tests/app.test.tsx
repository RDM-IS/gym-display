import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import App from "../src/App";
import type { Plan } from "../src/lib/types";

const PLAN: Plan = {
  plan_id: 42,
  plan_date: "2026-05-06",
  phase: 1,
  week_num: 1,
  session_type: "strength_a",
  target_rpe: 6.5,
  est_duration_min: 40,
  is_skipped: false,
  blocks: {
    type: "circuit",
    warmup: "5 min bike easy",
    rounds: 2,
    rest_between_rounds_sec: 120,
    exercises: [
      { name: "Goblet squat", format: "reps", target_reps: 10, target_load_lbs: 30, rest_after_sec: 60 },
    ],
    cooldown: "8 min bike easy",
    equipment: ["Powerblocks 25-35lb", "TRX"],
    setup_notes: ["TRX at mid-anchor"],
  },
};

describe("App", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(PLAN), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders setup screen with session name and START button after fetch", async () => {
    render(<App />);
    expect(await screen.findByText("Strength A")).toBeDefined();
    expect(await screen.findByText("Goblet squat", { exact: false })).toBeDefined();
    expect(await screen.findByRole("button", { name: /start workout/i })).toBeDefined();
  });
});
