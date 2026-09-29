import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import BottomBar from "../src/components/BottomBar";
import Nav from "../src/components/Nav";
import { barShowsStart, barTargets } from "../src/lib/bottom-bar";
import { dateLineStatus } from "../src/components/PlanDayDetail";
import { statusIcon } from "../src/lib/week";

afterEach(cleanup);

describe("bottom bar contents per view", () => {
  it("keeps Today → Tomorrow → Week order and leaves out the current view", () => {
    expect(barTargets("today")).toEqual(["tomorrow", "week"]);
    expect(barTargets("tomorrow")).toEqual(["today", "week"]);
    expect(barTargets("week")).toEqual(["today", "tomorrow"]);
    expect(barTargets("day")).toEqual(["today", "week"]);
  });

  it("offers Start on Today only", () => {
    expect(barShowsStart("today")).toBe(true);
    for (const v of ["tomorrow", "week", "day"] as const) expect(barShowsStart(v)).toBe(false);
  });

  const cases = [
    ["today", ["Start Workout", "Tomorrow", "Week"]],
    ["tomorrow", ["Today", "Week"]],
    ["week", ["Today", "Tomorrow"]],
    ["day", ["Today", "Week"]],
  ] as const;
  for (const [view, labels] of cases) {
    it(`renders ${view}`, () => {
      const onNavigate = vi.fn();
      const onStart = vi.fn();
      render(<BottomBar view={view} onNavigate={onNavigate} start={{ label: "Start Workout", onStart }} />);
      const bar = screen.getByTestId("bottom-bar");
      const buttons = within(bar).getAllByRole("button");
      expect(buttons.map((b) => b.textContent)).toEqual([...labels]);
      fireEvent.click(buttons.at(-1)!);
      expect(onNavigate).toHaveBeenCalledWith(labels.at(-1)!.toLowerCase());
      if (view === "today") {
        fireEvent.click(buttons[0]);
        expect(onStart).toHaveBeenCalled();
      }
    });
  }

  it("Today without a Start action (rest day) keeps the slot empty", () => {
    render(<BottomBar view="today" onNavigate={() => {}} />);
    expect(within(screen.getByTestId("bottom-bar")).getAllByRole("button").map((b) => b.textContent))
      .toEqual(["Tomorrow", "Week"]);
  });
});

describe("top tabs", () => {
  it("say Workout, Status, Sessions and Prep — no second 'Today'", () => {
    render(<Nav route="today" onNavigate={() => {}} />);
    expect(screen.getAllByRole("link").map((l) => l.textContent))
      .toEqual(["Workout", "Status", "Sessions", "Prep"]);
  });

  it("marks only the active route", () => {
    // PREP-1 added a fourth tab. The exact-list assertion above is what caught
    // it, which is the point of asserting the whole list rather than a subset:
    // a tab added by accident, or one lost in a refactor, both fail here.
    render(<Nav route="prep" onNavigate={() => {}} />);
    const active = screen.getAllByRole("link").filter((l) => l.className === "active");
    expect(active.map((l) => l.textContent)).toEqual(["Prep"]);
  });
});

describe("date line", () => {
  it("has a single separator", () => {
    expect(dateLineStatus(statusIcon("upcoming"))).toBe("Upcoming");
    expect(dateLineStatus(statusIcon("today"))).toBe("Today");
    expect(dateLineStatus(statusIcon("done"))).toBe("✓ Done");
    expect(dateLineStatus(statusIcon("missed"))).toBe("✕ Missed");
  });
});
