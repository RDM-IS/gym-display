import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import InlineExerciseLogger, {
  MACHINE_SETUP_HELP,
  machineSetupOpenByDefault,
} from "../src/components/InlineExerciseLogger";
import Stepper, { snapTo, stepThrough } from "../src/components/Stepper";
import {
  plateBreakdown,
  reachablePerSide,
  reachableTotals,
} from "../src/lib/equipment";
import { plateLabel, weightStepFor } from "../src/lib/weight-step";
import type { LoadConfigByClass, PlannedExercise } from "../src/lib/types";

// Office equipment, as surveyed:
//   hex dumbbells 5–45 in 5s · plates one each per side of 45/35/25/10/5 (no 2.5s)
//   bar/Smith step 10 lb total · Olympic bar 45 (TODO confirm) · Smith bar TODO
//
// LOCATION-1 (2026-09-25): these numbers are no longer a table in this repo.
// They live in artemis (knowledge/load_config.py) and travel on the plan row,
// so the fixture below is exactly what the API sends for an office day. It is
// a FIXTURE, not configuration — nothing in src/ may import it.
const OFFICE: LoadConfigByClass = {
  dumbbell: { mode: "numeric", step: 5, min: 5, max: 45 },
  machine: { mode: "numeric", step: 10, min: 0, max: 300 },
  cable: { mode: "numeric", step: 10, min: 0, max: 200 },
  smith: { mode: "numeric", step: 10, min: 0, max: 240, bar: 0, plates: [45, 35, 25, 10, 5] },
  barbell: { mode: "numeric", step: 10, min: 45, max: 285, bar: 45, plates: [45, 35, 25, 10, 5] },
  bodyweight: { mode: "none" },
  cardio: { mode: "none" },
};
const PLATES = [45, 35, 25, 10, 5] as const;

describe("reachable loads", () => {
  it("per side = every subset sum of 45/35/25/10/5", () => {
    expect(reachablePerSide(PLATES)).toEqual([
      0, 5, 10, 15, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 105,
      110, 115, 120,
    ]);
  });

  it("20 and 100 per side are impossible; 120 is the most", () => {
    const sides = reachablePerSide(PLATES);
    expect(sides).not.toContain(20);
    expect(sides).not.toContain(100);
    expect(Math.max(...sides)).toBe(120);
  });

  it("totals are bar + 2 × per side, in 10 lb total steps", () => {
    const totals = reachableTotals(45, PLATES);
    expect(totals.slice(0, 6)).toEqual([45, 55, 65, 75, 95, 105]);
    expect(totals).not.toContain(85);        // 20/side
    expect(totals).not.toContain(245);       // 100/side
    expect(totals[totals.length - 1]).toBe(285);
    for (const t of totals) expect((t - 45) % 10).toBe(0);
  });

  it("barbell and Smith only offer reachable totals", () => {
    const bb = weightStepFor(
      { name: "Barbell back squat", format: "reps", equipment_class: "barbell" }, OFFICE);
    expect(bb.values).toEqual(reachableTotals(45, PLATES));
    expect(bb).toMatchObject({ step: 10, barLbs: 45, max: 285, loadMode: "numeric" });
    const sm = weightStepFor(
      { name: "Smith squat", format: "reps", equipment_class: "smith" }, OFFICE);
    expect(sm.values).toEqual(reachableTotals(0, PLATES));
    expect(sm.step).toBe(10);
  });

  it("the stepper walks the reachable list and snaps keypad entries", () => {
    const totals = reachableTotals(45, PLATES);
    expect(stepThrough(75, +10, totals)).toBe(95);   // skips unreachable 85
    expect(stepThrough(95, -10, totals)).toBe(75);
    expect(stepThrough(285, +10, totals)).toBe(285);
    expect(snapTo(85, totals)).toBe(75);              // tie → lower
    expect(snapTo(88, totals)).toBe(95);
  });

  it("a Stepper with values moves between reachable totals", () => {
    const onChange = vi.fn();
    render(<Stepper label="Weight" unit="lb" value={75} step={10} values={reachableTotals(45, PLATES)} onChange={onChange} />);
    fireEvent.pointerDown(screen.getByLabelText("Increase Weight"), { button: 0 });
    fireEvent.pointerUp(screen.getByLabelText("Increase Weight"));
    expect(onChange).toHaveBeenCalledWith(95);
  });
});

describe("plate breakdown", () => {
  it("65 per side = 35 + 25 + 5, largest first", () => {
    expect(plateBreakdown(65, PLATES)).toEqual([35, 25, 5]);
    expect(plateLabel(45 + 2 * 65, 45, PLATES)).toBe("65 lb/side: 35 + 25 + 5");
  });

  it("prefers fewer plates, then larger ones", () => {
    expect(plateBreakdown(40, PLATES)).toEqual([35, 5]);       // not 25 + 10 + 5
    expect(plateBreakdown(45, PLATES)).toEqual([45]);
    expect(plateBreakdown(120, PLATES)).toEqual([45, 35, 25, 10, 5]);
    expect(plateBreakdown(20, PLATES)).toBeNull();
    expect(plateBreakdown(100, PLATES)).toBeNull();
  });

  it("labels the empty bar and loads below it", () => {
    expect(plateLabel(45, 45, PLATES)).toBe("bar only");
    expect(plateLabel(35, 45, PLATES)).toBe("below bar weight");
  });
});

describe("dumbbell range", () => {
  it("hex dumbbells are 5–45 in 5s", () => {
    expect(weightStepFor(
      { name: "DB bench press", format: "reps", equipment_class: "dumbbell" }, OFFICE,
    )).toMatchObject({
      cls: "dumbbell", step: 5, min: 5, max: 45, values: null,
    });
  });

  it("the stepper stays within 5–45", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Stepper label="Weight" value={45} step={5} min={5} max={45} onChange={onChange} />,
    );
    fireEvent.pointerDown(screen.getByLabelText("Increase Weight"), { button: 0 });
    fireEvent.pointerUp(screen.getByLabelText("Increase Weight"));
    expect(onChange).toHaveBeenLastCalledWith(45);
    rerender(<Stepper label="Weight" value={5} step={5} min={5} max={45} onChange={onChange} />);
    fireEvent.pointerDown(screen.getByLabelText("Decrease Weight"), { button: 0 });
    fireEvent.pointerUp(screen.getByLabelText("Decrease Weight"));
    expect(onChange).toHaveBeenLastCalledWith(5);
  });
});

describe("Machine setup field", () => {
  const LEG_PRESS: PlannedExercise = {
    name: "Leg press", format: "reps", target_reps: 12, target_load_lbs: null,
    equipment_class: "machine",
};

  function renderLogger(week_num: number, set_num: number) {
    return render(
      <InlineExerciseLogger
        exercise={LEG_PRESS}
        loadConfig={OFFICE}
        plan_id={1}
        set_num={set_num}
        total_sets={2}
        week_num={week_num}
        prefill={{ weight: null, reps: null, rpe: null, setup: {} }}
        lastHint={null}
        alreadyFullyLogged={false}
        onLoggedSet={() => {}}
      />,
    );
  }

  it("default-open rule: week 1, set 1 only", () => {
    expect(machineSetupOpenByDefault(1, 1)).toBe(true);
    expect(machineSetupOpenByDefault(1, 2)).toBe(false);
    expect(machineSetupOpenByDefault(2, 1)).toBe(false);
    expect(machineSetupOpenByDefault(undefined, 1)).toBe(false);
  });

  it("is expanded with the helper text on set 1 in week 1", () => {
    renderLogger(1, 1);
    expect(screen.getByTestId("machine-setup")).toBeTruthy();
    expect(screen.getByText("Machine setup ▾")).toBeTruthy();
    expect(screen.getByText(MACHINE_SETUP_HELP)).toBeTruthy();
    expect(MACHINE_SETUP_HELP).toBe(
      "The numbered positions you used — seat, pad, range. Next time they're pre-filled.",
    );
    // One field per named position.
    for (const f of ["seat", "pad", "range"]) expect(screen.getByTestId(`setup-${f}`)).toBeTruthy();
  });

  it("is collapsed (but one tap away) otherwise", () => {
    renderLogger(2, 1);
    expect(screen.queryByTestId("machine-setup")).toBeNull();
    fireEvent.click(screen.getByTestId("machine-setup-toggle"));
    expect(screen.getByTestId("machine-setup")).toBeTruthy();
  });

  it("is not shown for dumbbell work", () => {
    render(
      <InlineExerciseLogger
        exercise={{ name: "DB bench press", format: "reps", target_reps: 12,
                    equipment_class: "dumbbell" }}
        loadConfig={OFFICE}
        plan_id={1} set_num={1} total_sets={2} week_num={1}
        prefill={{ weight: null, reps: null, rpe: null, setup: {} }}
        lastHint={null} alreadyFullyLogged={false} onLoggedSet={() => {}}
      />,
    );
    expect(screen.queryByTestId("machine-setup")).toBeNull();
    expect(screen.queryByTestId("machine-setup-toggle")).toBeNull();
  });
});
