import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import MoveFigure from "../src/assets/circuit/MoveFigure";
import { MOVES, moveFor } from "../src/assets/circuit/moves";

describe("BW-CIRCUIT movement figures", () => {
  it("every movement has exactly two key frames", () => {
    // Two frames read as the movement at a glance. An in-between frame of a
    // push-up looks like a different, worse exercise.
    for (const [name, move] of Object.entries(MOVES)) {
      expect(move.frames.length, name).toBe(2);
      expect(move.cycle, name).toBeGreaterThan(0);
    }
  });

  it("resolves every movement the session actually uses", () => {
    for (const name of ["Push-up", "Incline push-up (hands on bench or counter)",
                        "TRX row", "Band row", "Table row or towel row",
                        "Reverse lunge", "Tempo squat", "Slow mountain climber",
                        "Dead bug", "Fast step-ups", "Skater steps",
                        "March in place", "Jog in place"]) {
      expect(moveFor(name), name).not.toBeNull();
    }
  });

  it("returns null for a movement with no figure rather than a blank box", () => {
    expect(moveFor("something nobody has drawn")).toBeNull();
    const { container } = render(<MoveFigure name="something nobody has drawn" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders both frames into the DOM so CSS can alternate them", () => {
    render(<MoveFigure name="Push-up" />);
    const svg = screen.getByTestId("move-figure");
    expect(svg.querySelectorAll(".move-frame").length).toBe(2);
    expect(svg.getAttribute("aria-label")).toBe("Push-up");
  });

  it("carries the cycle length as a CSS variable, not a JS timer", () => {
    // No JS timer means it cannot drift from the session clock or keep running
    // while the screen is hidden.
    render(<MoveFigure name="Jog in place" />);
    const svg = screen.getByTestId("move-figure");
    expect(svg.getAttribute("style")).toContain("--move-cycle");
  });

  it("the stylesheet pins frame 1 under prefers-reduced-motion", () => {
    const css = readFileSync("src/styles/circuit.css", "utf8");
    expect(css).toContain("prefers-reduced-motion");
    const block = css.slice(css.indexOf("prefers-reduced-motion"));
    expect(block).toContain("animation: none");
    expect(block).toMatch(/\.move-frame--0\s*\{\s*opacity:\s*1/);
  });
});

import { readFileSync } from "node:fs";

describe("ROW-CIRCUIT figures", () => {
  it("every floor move the circuit builds and the rower resolve to their OWN figure", async () => {
    const { ROW_CIRCUIT_MOVES } = await import("../src/assets/circuit/moves");
    const names = ["Rowing machine", "Push-up", "Dead bug", "Plank shoulder taps", "Russian twist",
                   "Side plank", "Bird dog", "Forearm plank", "Flutter kicks", "Glute bridge"];
    for (const n of names) expect(moveFor(n), n).not.toBeNull();
    // The rower must not borrow the TRX row, nor the dead bug the mountain climber.
    expect(moveFor("Rowing machine")).toBe(ROW_CIRCUIT_MOVES["rowing machine"]);
    expect(moveFor("Dead bug")).toBe(ROW_CIRCUIT_MOVES["dead bug"]);
    expect(moveFor("TRX row")).toBe(MOVES["row"]);
    expect(moveFor("Plank shoulder taps")).not.toBe(MOVES["push-up"]);
  });

  it("an alternating move's two frames differ; a still hold may repeat", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { ROW_CIRCUIT_MOVES } = await import("../src/assets/circuit/moves");
    for (const [name, m] of Object.entries(ROW_CIRCUIT_MOVES)) {
      const [a, b] = m.frames.map((f) => renderToStaticMarkup(f() as never));
      if (name === "forearm plank") expect(a).toBe(b);
      else expect(a, name).not.toBe(b);
    }
  });
});
