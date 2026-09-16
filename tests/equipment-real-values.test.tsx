import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import InlineExerciseLogger, {
  MACHINE_SETUP_HELP,
  machineSetupOpenByDefault,
} from "../src/components/InlineExerciseLogger";
import Stepper, { snapTo, stepThrough } from "../src/components/Stepper";
import {
  LOAD_CONFIG,
  PLATES_PER_SIDE,
  plateBreakdown,
  reachablePerSide,
  reachableTotals,
} from "../src/lib/equipment";
import { plateLabel, weightStepFor } from "../src/lib/weight-step";
import type { PlannedExercise } from "../src/lib/types";

// Office equipment, as surveyed:
//   hex dumbbells 5–45 in 5s · plates one each per side of 45/35/25/10/5 (no 2.5s)
//   bar/Smith step 10 lb total · Olympic bar 45 (TODO confirm) · Smith bar TODO

describe("reachable loads", () => {
  it("per side = every subset sum of 45/35/25/10/5", () => {
    expect(PLATES_PER_SIDE).toEqual([45, 35, 25, 10, 5]);
    expect(reachablePerSide()).toEqual([
      0, 5, 10, 15, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 105,
      110, 115, 120,
    ]);
  });

  it("20 and 100 per side are impossible; 120 is the most", () => {
    const sides = reachablePerSide();
    expect(sides).not.toContain(20);
    expect(sides).not.toContain(100);
    expect(Math.max(...sides)).toBe(120);
  });

  it("totals are bar + 2 × per side, in 10 lb total steps", () => {
    const totals = reachableTotals(45);
    expect(totals.slice(0, 6)).toEqual([45, 55, 65, 75, 95, 105]);
    expect(totals).not.toContain(85);        // 20/side
    expect(totals).not.toContain(245);       // 100/side
    expect(totals[totals.length - 1]).toBe(285);
    for (const t of totals) expect((t - 45) % 10).toBe(0);
  });

  it("barbell and Smith only offer reachable totals", () => {
    const bb = weightStepFor({ name: "Barbell back squat", format: "reps" });
    expect(bb.values).toEqual(reachableTotals(45));
    expect(LOAD_CONFIG.barbell).toMatchObject({ step: 10, barLbs: 45, max: 285 });
    const sm = weightStepFor({ name: "Smith squat", format: "reps" });
    expect(sm.values).toEqual(reachableTotals(LOAD_CONFIG.smith.barLbs ?? 0));
    expect(sm.step).toBe(10);
  });

  it("the stepper walks the reachable list and snaps keypad entries", () => {
    const totals = reachableTotals(45);
    expect(stepThrough(75, +10, totals)).toBe(95);   // skips unreachable 85
    expect(stepThrough(95, -10, totals)).toBe(75);
    expect(stepThrough(285, +10, totals)).toBe(285);
    expect(snapTo(85, totals)).toBe(75);              // tie → lower
    expect(snapTo(88, totals)).toBe(95);
  });

  it("a Stepper with values moves between reachable totals", () => {
    const onChange = vi.fn();
    render(<Stepper label="Weight" unit="lb" value={75} step={10} values={reachableTotals(45)} onChange={onChange} />);
    fireEvent.pointerDown(screen.getByLabelText("Increase Weight"), { button: 0 });
    fireEvent.pointerUp(screen.getByLabelText("Increase Weight"));
    expect(onChange).toHaveBeenCalledWith(95);
  });
});

describe("plate breakdown", () => {
  it("65 per side = 35 + 25 + 5, largest first", () => {
    expect(plateBreakdown(65)).toEqual([35, 25, 5]);
    expect(plateLabel(45 + 2 * 65, 45)).toBe("65 lb/side: 35 + 25 + 5");
  });

  it("prefers fewer plates, then larger ones", () => {
    expect(plateBreakdown(40)).toEqual([35, 5]);       // not 25 + 10 + 5
    expect(plateBreakdown(45)).toEqual([45]);
    expect(plateBreakdown(120)).toEqual([45, 35, 25, 10, 5]);
    expect(plateBreakdown(20)).toBeNull();
    expect(plateBreakdown(100)).toBeNull();
  });

  it("labels the empty bar and loads below it", () => {
    expect(plateLabel(45, 45)).toBe("bar only");
    expect(plateLabel(35, 45)).toBe("below bar weight");
  });
});

describe("dumbbell range", () => {
  it("hex dumbbells are 5–45 in 5s", () => {
    expect(weightStepFor({ name: "DB bench press", format: "reps" })).toMatchObject({
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
  };

  function renderLogger(week_num: number, set_num: number) {
    return render(
      <InlineExerciseLogger
        exercise={LEG_PRESS}
        plan_id={1}
        set_num={set_num}
        total_sets={2}
        week_num={week_num}
        prefill={{ weight: null, reps: null, rpe: null, setting: null }}
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
      "The numbered seat/pad position you used, e.g. seat 4, pad 2. Next time it's pre-filled.",
    );
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
        exercise={{ name: "DB bench press", format: "reps", target_reps: 12 }}
        plan_id={1} set_num={1} total_sets={2} week_num={1}
        prefill={{ weight: null, reps: null, rpe: null, setting: null }}
        lastHint={null} alreadyFullyLogged={false} onLoggedSet={() => {}}
      />,
    );
    expect(screen.queryByTestId("machine-setup")).toBeNull();
    expect(screen.queryByTestId("machine-setup-toggle")).toBeNull();
  });
});
