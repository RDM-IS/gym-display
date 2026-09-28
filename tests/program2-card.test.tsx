import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import PlanDayDetail from "../src/components/PlanDayDetail";
import { targetZoneLabel } from "../src/lib/hr-zone";
import type { PlanDay } from "../src/lib/types";

// PROGRAM-2 zones ride ON THE ROW: artemis resolves them in knowledge/zones.py
// and the card renders what it is given. It never derives a range, which is why
// these tests assert the rendered text against the fixture's own numbers.

const Z2 = { zone: "Z2", low_bpm: 105, high_bpm: 122, source: "estimate, Tanaka HRmax 174, age 49; ZONE-1 replaces" };
const Z4 = { zone: "Z4", low_bpm: 139, high_bpm: 157, source: "estimate, Tanaka HRmax 174, age 49; ZONE-1 replaces" };

function day(over: Partial<PlanDay> = {}): PlanDay {
  return {
    plan_id: 1,
    plan_date: "2026-10-06",
    session_type: "cardio_z2",
    display_name: "Zone 2 — Bike",
    phase: 1,
    week_num: 5,
    target_rpe: null,
    est_duration_min: 40,
    location: "office",
    is_skipped: false,
    adjusted: false,
    status: "planned",
    blocks: {
      type: "steady",
      display_name: "Zone 2 — Bike",
      duration_min: 40,
      intensity: "easy",
      zones: { work: Z2 },
      suggested_extra: null,
    },
    logged: [],
    summary_notes: null,
    ...over,
  } as PlanDay;
}

describe("the zone range on the card", () => {
  it("shows the row's own range on a steady session", () => {
    render(<PlanDayDetail day={day()} today="2026-10-06" />);
    expect(screen.getByTestId("plan-zone").textContent).toBe("Z2 105–122 bpm");
  });

  it("shows the WORK zone on an interval session, with reps and both sides", () => {
    render(<PlanDayDetail day={day({
      session_type: "cardio_intervals",
      display_name: "Intervals — Row",
      blocks: {
        type: "intervals",
        display_name: "Intervals — Row",
        intervals: { reps: 6, work_sec: 60, easy_sec: 120 },
        zones: { work: Z4, easy: Z2 },
        suggested_extra: null,
      },
    })} today="2026-10-06" />);
    expect(screen.getByTestId("plan-zone").textContent).toBe("Z4 139–157 bpm");
    expect(screen.getByText(/6×\s*60s hard \/ 120s easy/)).toBeTruthy();
  });

  it("renders no zone line at all on a row that carries no zones", () => {
    const d = day();
    delete (d.blocks as unknown as Record<string, unknown>).zones;
    render(<PlanDayDetail day={d} today="2026-10-06" />);
    expect(screen.queryByTestId("plan-zone")).toBeNull();
  });

  // The card must not fall back to deriving a range from a constant in this
  // repo. hr-zone.ts still carries MAX_HR_BPM = 172 (220 − 48) while the rows
  // carry Tanaka HRmax 174 at age 49, so the two disagree by ~2 bpm. ZONE-1
  // reconciles them with a measured figure; until then this test fails loudly
  // if anyone wires the card to the local constant.
  it("does not render the locally-derived range", () => {
    render(<PlanDayDetail day={day()} today="2026-10-06" />);
    const shown = screen.getByTestId("plan-zone").textContent ?? "";
    expect(targetZoneLabel(2)).not.toContain("105–122");
    expect(shown).not.toBe(targetZoneLabel(2));
  });
});

describe("the suggested extra", () => {
  it("is offered as an optional line, not a second session", () => {
    render(<PlanDayDetail day={day({
      session_type: "strength_a",
      blocks: { type: "circuit", display_name: "Strength A", rounds: 3, exercises: [], suggested_extra: "core" },
    })} today="2026-10-06" />);
    const line = screen.getByTestId("plan-suggested-extra");
    expect(line.textContent).toContain("Core");
    expect(line.textContent).toContain("optional");
    // Display only: it seeds no row, so it must not be a control.
    expect(line.querySelector("button")).toBeNull();
  });

  it("names the rest-day extras the template offers", () => {
    render(<PlanDayDetail day={day({
      session_type: "rest",
      blocks: { type: "rest", display_name: "Rest", suggested_extra: "yoga_strength" },
    })} today="2026-10-06" />);
    expect(screen.getByTestId("plan-suggested-extra").textContent).toContain("Yoga — Strength & Balance");
  });

  it("shows nothing when the day offers no extra", () => {
    render(<PlanDayDetail day={day()} today="2026-10-06" />);
    expect(screen.queryByTestId("plan-suggested-extra")).toBeNull();
  });
});
