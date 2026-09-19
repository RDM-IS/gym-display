import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PlanDayDetail from "../src/components/PlanDayDetail";
import { formatEstimate } from "../src/lib/format";
import type { PlanDay } from "../src/lib/types";

// TIME-CAP (2026-09-19): 45 min is a target, not a limit. The estimate reads
// "~52 min" once it's over 45; no warnings, no apologies.

function day(est: number | null): PlanDay {
  return {
    plan_id: 1, plan_date: "2026-10-02", session_type: "strength_b", display_name: "Office Strength B",
    phase: 1, week_num: 3, target_rpe: 7, est_duration_min: est, location: "office gym",
    is_skipped: false, adjusted: false, status: "upcoming", logged: [], summary_notes: null,
    blocks: { type: "circuit", display_name: "Office Strength B", rounds: 3,
              exercises: [{ name: "DB goblet squat", format: "reps", target_reps: 12, notes: "3×8-12" }] },
  } as PlanDay;
}

describe("formatEstimate", () => {
  it("plain at or under 45, ~ over it", () => {
    expect(formatEstimate(44)).toBe("44 min");
    expect(formatEstimate(45)).toBe("45 min");
    expect(formatEstimate(52)).toBe("~52 min");
    expect(formatEstimate(62)).toBe("~62 min");
    expect(formatEstimate(null)).toBe("");
  });
});

describe("Tomorrow / day detail", () => {
  it.each([[44, "44 min"], [52, "~52 min"], [62, "~62 min"]])("est %i → %s, no warning", (est, want) => {
    const { container } = render(<PlanDayDetail day={day(est)} today="2026-10-01" />);
    const text = container.textContent ?? "";
    expect(text).toContain(want);
    if (est <= 45) expect(text).not.toContain("~");
    for (const w of ["over", "too long", "sorry", "warning", "target", "limit"]) {
      expect(text.toLowerCase()).not.toContain(w);
    }
    screen.getByText(/Office Strength B/);
  });
});
