import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import StrengthTiles from "../src/components/StrengthTiles";
import type { LastLoggedEntry } from "../src/lib/types";

// GD-DISTANCE — the three tiles on the active-set screen. Physical sizing and
// layout stability are measured in WebKit (e2e/distance.e2e.ts); these pin the
// values, and the structure that stability depends on.

afterEach(cleanup);

const LAST: LastLoggedEntry = {
  exercise: "Leg press", plan_date: "2026-09-18", weight_lbs: 175, reps_done: 12,
  rpe_actual: 7, duration_sec: null, distance_m: null, hr_avg: null, hr_peak: null,
  notes: null,
};

const text = (id: string) => screen.getByTestId(id).textContent;
const num = (id: string) => screen.getByTestId(id).querySelector(".stile-num") as HTMLElement;

describe("the three tiles", () => {
  it("REPS, RPE and LAST, with the values Ryan specified", () => {
    render(<StrengthTiles reps={12} cap={6} last={LAST} />);
    expect(text("tile-reps")).toBe("Reps12 ");
    expect(text("tile-rpe")).toBe("RPE6stop with ~4 reps left");
    expect(num("tile-last").textContent).toBe("175lb");
    expect(text("tile-last-sub")).toBe("×12 · RPE 7");
  });

  it("labels are the small-caps words, in order", () => {
    render(<StrengthTiles reps={12} cap={6} last={LAST} />);
    const labels = [...screen.getByTestId("strength-tiles").querySelectorAll(".stile-label")]
      .map((l) => l.textContent);
    expect(labels).toEqual(["Reps", "RPE", "Last"]);
  });

  it("says which round of today the LAST value came from", () => {
    render(<StrengthTiles reps={12} cap={6} last={LAST} lastRound={1} />);
    expect(text("tile-last-label")).toBe("Last — round 1");
    expect(screen.getByTestId("tile-last").getAttribute("aria-label"))
      .toContain("round 1 today");
  });

  it("stays plain 'Last' when the value is an earlier day's", () => {
    render(<StrengthTiles reps={12} cap={6} last={LAST} />);
    expect(text("tile-last-label")).toBe("Last");
  });

  it("the reps-left line follows the cap", () => {
    render(<StrengthTiles reps={10} cap={7.5} last={LAST} />);
    expect(text("tile-rpe-sub")).toBe("~2–3 reps left");
  });

  it("LAST is the single most recent set, verbatim — not an average", () => {
    // Whatever the session history averages to, LAST shows exactly the set it
    // is given. The averaging lives in strength-cues and is spoken only.
    render(<StrengthTiles reps={12} cap={6} last={{ ...LAST, weight_lbs: 172.5 }} />);
    expect(num("tile-last").textContent).toBe("172.5lb");
  });
});

describe("the edges", () => {
  it("no history reads as first time", () => {
    render(<StrengthTiles reps={12} cap={6} last={null} />);
    expect(num("tile-last").textContent).toBe("—");
    expect(text("tile-last-sub")).toBe("first time");
  });

  it("a bodyweight last set shows BW, not a blank weight", () => {
    render(<StrengthTiles reps={12} cap={6} last={{ ...LAST, weight_lbs: null }} />);
    expect(num("tile-last").textContent).toBe("BW");
    expect(text("tile-last-sub")).toBe("×12 · RPE 7");
  });

  it("a last set with no RPE drops only that part", () => {
    render(<StrengthTiles reps={12} cap={6} last={{ ...LAST, rpe_actual: null }} />);
    expect(text("tile-last-sub")).toBe("×12");
  });

  it("no cap reads as a dash, with no reps-left line invented", () => {
    render(<StrengthTiles reps={12} cap={null} last={LAST} />);
    expect(num("tile-rpe").textContent).toBe("—");
    expect(text("tile-rpe-sub")).toBe(" ");
  });
});

describe("what keeps the screen from jumping", () => {
  it("all three tiles render even with nothing to show", () => {
    render(<StrengthTiles reps={null} cap={null} last={null} />);
    for (const id of ["tile-reps", "tile-rpe", "tile-last"]) {
      expect(screen.getByTestId(id)).toBeDefined();
    }
  });

  it("every tile always has all three lines, so late data can't reflow it", () => {
    for (const last of [null, LAST]) {
      cleanup();
      render(<StrengthTiles reps={12} cap={null} last={last} />);
      for (const id of ["tile-reps", "tile-rpe", "tile-last"]) {
        const t = screen.getByTestId(id);
        expect(t.querySelector(".stile-label"), id).not.toBeNull();
        expect(t.querySelector(".stile-num"), id).not.toBeNull();
        const sub = t.querySelector(".stile-sub")!;
        expect(sub.textContent!.length, `${id} sub is empty`).toBeGreaterThan(0);
      }
    }
  });

  it("a one-digit number is sized like a two-digit one", () => {
    // "6" beside "12" should look the same size, not twice as big.
    render(<StrengthTiles reps={12} cap={6} last={LAST} />);
    expect(num("tile-rpe").style.getPropertyValue("--chars")).toBe("2");
    expect(num("tile-reps").style.getPropertyValue("--chars")).toBe("2");
  });

  it("the size depends on character count, not the value: 9 and 10 reps size the same way", () => {
    render(<StrengthTiles reps={9} cap={6} last={LAST} />);
    const nine = num("tile-reps").style.getPropertyValue("--chars");
    cleanup();
    render(<StrengthTiles reps={10} cap={6} last={LAST} />);
    expect(num("tile-reps").style.getPropertyValue("--chars")).toBe(nine);
  });

  it("LAST budgets width for its unit", () => {
    render(<StrengthTiles reps={12} cap={6} last={LAST} />);
    expect(Number(num("tile-last").style.getPropertyValue("--chars"))).toBeCloseTo(3.9, 5);
  });
});

describe("colour", () => {
  it("the tiles use no yellow — that stays for the current set and Busy", () => {
    render(<StrengthTiles reps={12} cap={6} last={LAST} />);
    const html = screen.getByTestId("strength-tiles").outerHTML;
    expect(html).not.toMatch(/accent|ffd166|yellow/i);
  });
});
