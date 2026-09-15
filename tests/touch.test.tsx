import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import Stepper, { clampRound } from "../src/components/Stepper";
import { detectSwipe } from "../src/lib/use-swipe";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("detectSwipe", () => {
  it("quick horizontal drags of ≥60px", () => {
    expect(detectSwipe(-120, 10, 200)).toBe("left");
    expect(detectSwipe(90, -20, 300)).toBe("right");
  });

  it("ignores short, slow, or mostly-vertical drags", () => {
    expect(detectSwipe(-40, 0, 100)).toBeNull();
    expect(detectSwipe(-200, 0, 900)).toBeNull();
    expect(detectSwipe(-80, 70, 200)).toBeNull();
  });
});

describe("clampRound", () => {
  it("clamps and rounds to one decimal", () => {
    expect(clampRound(-5, 0, 100)).toBe(0);
    expect(clampRound(105, 0, 100)).toBe(100);
    expect(clampRound(2.5 + 2.5 + 0.1 + 0.2, 0)).toBe(5.3);
  });
});

function Harness({ start }: { start: number | null }) {
  const [v, setV] = useState<number | null>(start);
  return <Stepper label="Weight" unit="lb" value={v} step={10} min={0} max={300} blankStart={50} onChange={setV} />;
}

describe("Stepper press-and-hold", () => {
  it("bumps once on press, then repeats with acceleration until release", () => {
    vi.useFakeTimers();
    render(<Harness start={100} />);
    const plus = screen.getByRole("button", { name: "Increase Weight" });

    fireEvent.pointerDown(plus, { button: 0, pointerId: 1 });
    expect(screen.getByRole("button", { name: /^Weight 110 lb/ })).toBeDefined();

    act(() => { vi.advanceTimersByTime(399); });
    expect(screen.getByRole("button", { name: /^Weight 110 lb/ })).toBeDefined();

    // 400 ms hold delay, then ticks at 180 → 153 → 130 ms …
    act(() => { vi.advanceTimersByTime(1 + 180 + 153); });
    expect(screen.getByRole("button", { name: /^Weight 140 lb/ })).toBeDefined();

    fireEvent.pointerUp(plus, { pointerId: 1 });
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByRole("button", { name: /^Weight 140 lb/ })).toBeDefined();
  });

  it("a pointer tap doesn't double-bump from the follow-up click", () => {
    render(<Harness start={100} />);
    const plus = screen.getByRole("button", { name: "Increase Weight" });
    fireEvent.pointerDown(plus, { button: 0, pointerId: 1 });
    fireEvent.pointerUp(plus, { pointerId: 1 });
    fireEvent.click(plus, { detail: 1 });
    expect(screen.getByRole("button", { name: /^Weight 110 lb/ })).toBeDefined();
  });

  it("first tap on an empty value reveals the suggested start", () => {
    render(<Harness start={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase Weight" }));
    expect(screen.getByRole("button", { name: /^Weight 50 lb/ })).toBeDefined();
  });

  it("the value opens the keypad and Done clamps to max", () => {
    render(<Harness start={100} />);
    fireEvent.click(screen.getByRole("button", { name: /^Weight 100 lb, tap to enter$/ }));
    for (const d of ["9", "9", "9"]) {
      fireEvent.click(screen.getByRole("button", { name: `Digit ${d}` }));
    }
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByRole("button", { name: /^Weight 300 lb/ })).toBeDefined();
  });
});
