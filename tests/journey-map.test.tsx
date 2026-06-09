import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import JourneyMap from "../src/components/JourneyMap";
import { flattenBlocksToSteps } from "../src/lib/steps";
import type { ExerciseCompletion } from "../src/lib/log-state";
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
    expect(screen.getAllByText("Between rounds")).toHaveLength(1);
  });

  it("round counter follows the cursor — round 2 of 3 shows (2/3) on in-circuit steps", () => {
    render(<JourneyMap steps={steps} sections={sections} cursor={{ stepIndex: 1, currentRound: 2 }} />);
    expect(screen.getAllByText("(2/3)").length).toBeGreaterThan(0);
  });

  it("exactly one current row is highlighted, and Skip moves the highlight", () => {
    const { container, rerender } = render(
      <JourneyMap steps={steps} sections={sections} cursor={{ stepIndex: 1, currentRound: 1 }} />
    );
    expect(container.querySelectorAll(".jmap-row--current")).toHaveLength(1);
    rerender(<JourneyMap steps={steps} sections={sections} cursor={{ stepIndex: 3, currentRound: 1 }} />);
    const after = container.querySelectorAll(".jmap-row--current");
    expect(after).toHaveLength(1);
    expect((after[0] as HTMLElement).textContent).toContain("Plank");
  });

  it("renders full ✓ only when logged >= total", () => {
    const completion = new Map<string, ExerciseCompletion>([
      ["Goblet squat", { logged: 3, total: 3 }],
      ["Plank", { logged: 0, total: 3 }],
    ]);
    const { container } = render(
      <JourneyMap
        steps={steps}
        sections={sections}
        cursor={{ stepIndex: 0, currentRound: 1 }}
        completion={completion}
      />
    );
    const gobletRow = Array.from(container.querySelectorAll(".jmap-row"))
      .find((el) => el.textContent?.includes("Goblet squat")) as HTMLElement;
    const plankRow = Array.from(container.querySelectorAll(".jmap-row"))
      .find((el) => el.textContent?.includes("Plank")) as HTMLElement;
    expect(gobletRow.querySelector(".jmap-check")).toBeTruthy();
    expect(plankRow.querySelector(".jmap-check")).toBeFalsy();
  });

  it("renders subtle 'N/M ✓' partial badge when logged > 0 and < total", () => {
    const completion = new Map<string, ExerciseCompletion>([
      ["Goblet squat", { logged: 2, total: 3 }],
    ]);
    const { container } = render(
      <JourneyMap
        steps={steps}
        sections={sections}
        cursor={{ stepIndex: 0, currentRound: 1 }}
        completion={completion}
      />
    );
    const gobletRow = Array.from(container.querySelectorAll(".jmap-row"))
      .find((el) => el.textContent?.includes("Goblet squat")) as HTMLElement;
    expect(gobletRow.querySelector(".jmap-check")).toBeFalsy();
    expect(gobletRow.querySelector(".jmap-partial")?.textContent).toContain("2/3");
  });
});
