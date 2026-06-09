import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import JourneyMap from "../src/components/JourneyMap";
import { flattenBlocksToSteps } from "../src/lib/steps";
import type { CircuitBlocks } from "../src/lib/types";

const CIRCUIT: CircuitBlocks = {
  type: "circuit",
  warmup: "5 min bike easy",
  rounds: 3,
  rest_between_rounds_sec: 120,
  exercises: [
    { name: "Goblet squat", format: "reps", target_reps: 10, target_load_lbs: 30, rest_after_sec: 60 },
    { name: "Plank", format: "duration", duration_sec: 30, rest_after_sec: 60 },
  ],
  cooldown: "8 min bike easy",
};

afterEach(() => cleanup());

describe("JourneyMap", () => {
  const { steps, sections } = flattenBlocksToSteps(CIRCUIT);

  it("renders one row per step (single circuit pass, NOT unrolled)", () => {
    render(<JourneyMap steps={steps} sections={sections} cursor={{ stepIndex: 0, currentRound: 1 }} />);
    expect(screen.getByText("Goblet squat")).toBeDefined();
    expect(screen.getByText("Plank")).toBeDefined();
    // "Between rounds" label appears once (the round-break rest in the single pass).
    expect(screen.getAllByText("Between rounds")).toHaveLength(1);
  });

  it("renders section headers from sections metadata", () => {
    render(<JourneyMap steps={steps} sections={sections} cursor={{ stepIndex: 0, currentRound: 1 }} />);
    expect(screen.getByText(/3 × Circuit/i)).toBeDefined();
  });

  it("round counter follows the cursor — round 2 of 3 shows (2/3) on in-circuit steps", () => {
    // cursor at goblet squat, round 2
    render(<JourneyMap steps={steps} sections={sections} cursor={{ stepIndex: 1, currentRound: 2 }} />);
    expect(screen.getAllByText("(2/3)").length).toBeGreaterThan(0);
  });

  it("current step gets the current marker — only one current row at a time", () => {
    const { container, rerender } = render(
      <JourneyMap steps={steps} sections={sections} cursor={{ stepIndex: 1, currentRound: 1 }} />
    );
    const currentRows = container.querySelectorAll(".jmap-row--current");
    expect(currentRows).toHaveLength(1);
    // Advancing the cursor moves the highlight.
    rerender(<JourneyMap steps={steps} sections={sections} cursor={{ stepIndex: 3, currentRound: 1 }} />);
    const after = container.querySelectorAll(".jmap-row--current");
    expect(after).toHaveLength(1);
    expect((after[0] as HTMLElement).textContent).toContain("Plank");
  });

  it("shows ✓ on exercises in loggedExercises", () => {
    const { container } = render(
      <JourneyMap
        steps={steps}
        sections={sections}
        cursor={{ stepIndex: 0, currentRound: 1 }}
        loggedExercises={new Set(["Goblet squat"])}
      />
    );
    const gobletRow = Array.from(container.querySelectorAll(".jmap-row"))
      .find((el) => el.textContent?.includes("Goblet squat")) as HTMLElement;
    expect(gobletRow.textContent).toContain("✓");
  });
});
