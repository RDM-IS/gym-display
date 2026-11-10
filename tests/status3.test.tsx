import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

afterEach(cleanup);
import fixture from "./fixtures/overview-status3.json";
import type { OverviewResponse, PlanDay } from "../src/lib/types";
import {
  cellFor,
  checkinBanner,
  checkinStreak,
  gridColumns,
  goalLines,
  localHm,
  milestones,
  newBests,
  recFor,
  recentSessions,
} from "../src/lib/status3";
import StatusGrid from "../src/components/StatusGrid";
import TrendTiles from "../src/components/TrendTiles";

// STATUS-3 phase 1 — the grid model, the check-in banner and the folds.
// Fixture values are synthetic (PUBLIC-FIXTURES).

const data = fixture as unknown as OverviewResponse;
const TODAY = data.date;                                   // Sat 2026-11-14
const rows = data.grid!.days;
const byDate = (d: string) => rows.filter((r) => r.plan_date === d);

describe("grid columns", () => {
  const cols = gridColumns(data.grid!, TODAY, null);

  it("is yesterday, today and the next five, today marked", () => {
    expect(cols.map((c) => c.date)).toEqual([
      "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16",
      "2026-11-17", "2026-11-18", "2026-11-19"]);
    expect(cols.filter((c) => c.isToday).map((c) => c.date)).toEqual([TODAY]);
    expect(cols[0].isPast).toBe(true);
  });

  it("draws the week divider on Monday only — goal weeks are Mon–Sun", () => {
    expect(cols.filter((c) => c.weekBreak).map((c) => c.date)).toEqual(["2026-11-16"]);
  });

  it("never puts the divider on the first column", () => {
    const fromMonday = gridColumns({ ...data.grid!, start: "2026-11-16", end: "2026-11-22" }, "2026-11-16", null);
    expect(fromMonday.some((c) => c.weekBreak)).toBe(false);
  });

  it("splits morning and evening rows; the Evening row shows mandatory items only", () => {
    const sat = cols[1];
    expect(sat.morning?.name).toBe("Adjusting ladder");
    // Phase 2, amendment 1: Recovery Flow never fills the Evening row.
    expect(sat.evening).toBeNull();
    expect(cols[3].evening).toBeNull();
    expect(cols[4].evening).toBeNull();
  });

  it("a day with no plan row has empty cells and no recommendation", () => {
    const last = cols[6];
    expect(last.morning).toBeNull();
    expect(last.rec).toBeNull();
  });
});

describe("cell colour and burn (phase 1: green, yellow, neutral, muted only)", () => {
  it("done is green with the Watch kcal", () => {
    const c = cellFor(byDate("2026-11-13")[0], TODAY, data.grid!.burn);
    expect(c.tone).toBe("green");
    expect(c.kcal).toBe(321);
    expect(c.state).toBe("Done");
  });

  it("a past miss is muted — red and orange wait for phase 2's feasibility math", () => {
    const c = cellFor(byDate("2026-11-13")[1], TODAY, data.grid!.burn);
    expect(c.tone).toBe("muted");
    expect(c.state).toBe("Not done");
    expect(c.kcal).toBeNull();                   // no evening workout that day
  });

  it("an adjusted future session is yellow; an upcoming one is green", () => {
    const mon = byDate("2026-11-16");
    expect(cellFor(mon[0], TODAY, []).tone).toBe("yellow");
    expect(cellFor(mon[1], TODAY, []).tone).toBe("green");
  });

  it("a future cell carries no kcal even if burn were present", () => {
    const fut = byDate("2026-11-16")[0];
    expect(cellFor(fut, TODAY, [{ date: fut.plan_date, slot: "morning", kcal: 99, workouts: 1 }]).kcal).toBeNull();
  });

  it("rest is neutral and named Rest", () => {
    const c = cellFor(byDate("2026-11-15")[0], TODAY, []);
    expect(c).toMatchObject({ tone: "neutral", name: "Rest", state: null });
  });

  it("no tone is ever orange or red in phase 1", () => {
    // The Tone type already excludes them; this checks the runtime values too.
    const tones: string[] = gridColumns(data.grid!, TODAY, null).flatMap((c) =>
      [c.morning?.tone, c.evening?.tone, c.rec?.tone]).filter((t): t is NonNullable<typeof t> => !!t);
    expect(tones.filter((t) => t === "orange" || t === "red")).toEqual([]);
  });
});

describe("recommended row", () => {
  it("past days have none", () => {
    expect(recFor("2026-11-13", TODAY, byDate("2026-11-13"), null)).toBeNull();
  });

  it("today: /recommend's answer while planned work is open", () => {
    const r = recFor(TODAY, TODAY, byDate(TODAY), { available: true, label: "Row ladder", reason: "no row in 2 days" });
    expect(r).toMatchObject({ label: "Row ladder", why: "no row in 2 days", kind: "recommend" });
  });

  it("today: an extra once every planned row is done", () => {
    const done = byDate(TODAY).map((r) => ({ ...r, status: "done" as const }));
    expect(recFor(TODAY, TODAY, done, { available: true, label: "Row ladder" })?.kind).toBe("extra");
  });

  it("future: the day's next planned session", () => {
    expect(recFor("2026-11-16", TODAY, byDate("2026-11-16"), null))
      .toMatchObject({ label: "Full body B", tone: "yellow", kind: "plan" });
  });

  it("today without /recommend falls back to the next open row", () => {
    expect(recFor(TODAY, TODAY, byDate(TODAY), { available: false })?.label).toBe("Recovery flow");
  });
});

describe("check-in banner", () => {
  it("is in the ACTIVE timezone, not the device's", () => {
    // 10:20 UTC is 04:20 in Chicago (CST) but 05:20 in Bogotá.
    const t = new Date("2026-11-14T10:20:00Z");
    expect(localHm(t, "America/Chicago")).toBe("04:20");
    expect(checkinBanner(data, t)).toBe("amber");
    expect(checkinBanner({ ...data, timezone: "America/Bogota" }, t)).toBe("red");
  });

  it("turns red at 04:30 and disappears once checked in", () => {
    expect(checkinBanner(data, new Date("2026-11-14T10:30:00Z"))).toBe("red");
    const checked = { ...data, today: { ...data.today, checkin: data.checkins_14d[0] as never } };
    expect(checkinBanner(checked, new Date("2026-11-14T10:30:00Z"))).toBeNull();
  });
});

describe("folds", () => {
  it("milestones: a real new best, the check-in streak, never a first session", () => {
    expect(newBests(data.strength_progress).map((r) => r.exercise)).toEqual(["Goblet squat"]);
    const first = { ...data.strength_progress[0], previous: null };
    expect(newBests([first])).toEqual([]);
    expect(milestones(data).map((m) => m.text)).toEqual([
      "New best: Goblet squat 40 lb × 15", "3-day check-in streak"]);
  });

  it("streak counts back from yesterday when today has none", () => {
    expect(checkinStreak(data.checkins_14d, TODAY)).toBe(3);
    expect(checkinStreak([], TODAY)).toBe(0);
  });

  it("goals are framed as progress and never invent a target", () => {
    const lines = goalLines(data).map((l) => l.text);
    expect(lines[0]).toBe("3.5 lb down since the program started");
    expect(lines).toContain("1 of 3 strength days done this week");
    expect(lines).toContain("70 of 120 planned cardio minutes in the last 7 days");
    expect(lines.join(" ")).toContain("against a 1,650 plan");
    expect(lines.join(" ")).not.toMatch(/to go|target/);
  });

  it("recent sessions: wins first, nothing upcoming, rest excluded", () => {
    const r = recentSessions(data);
    expect(r.map((x) => [x.row.plan_date, x.name, x.kcal])).toEqual([
      ["2026-11-14", "Adjusting ladder", 222],
      ["2026-11-13", "Full body A", 321],
    ]);
  });
});

describe("StatusGrid component", () => {
  it("renders 7 heads and opens a tapped day", () => {
    const opened: PlanDay[] = [];
    let sessions = 0;
    render(<StatusGrid columns={gridColumns(data.grid!, TODAY, { available: true, label: "Row ladder" })}
                       onOpenDay={(d) => opened.push(d)} onOpenSessions={() => { sessions += 1; }} />);
    const grid = screen.getByTestId("status-grid");
    expect(within(grid).getAllByText(/\d+\/\d+/)).toHaveLength(7);
    expect(screen.getByTestId(`sg-head-${TODAY}`).getAttribute("aria-current")).toBe("date");
    expect(screen.getByTestId("sg-morning-2026-11-13").textContent).toContain("321 kcal");
    fireEvent.click(screen.getByTestId("sg-morning-2026-11-16"));
    expect(opened.map((d) => d.display_name)).toEqual(["Full body B"]);
    fireEvent.click(screen.getByTestId(`sg-rec-${TODAY}`));
    expect(sessions).toBe(1);
    expect(screen.getByTestId("sg-head-2026-11-16").className).toContain("sg-col--week");
  });
});

describe("TrendTiles", () => {
  it("shows four values, the cardio fallback, and the nutrition PLAN label", () => {
    render(<TrendTiles goals={data.goals} />);
    expect(screen.getByTestId("tt-weight-value").textContent).toContain("180.2");
    expect(screen.getByTestId("tt-cardio").textContent).toContain("70 / 120 min");
    expect(screen.getByTestId("tt-cardio").textContent).toContain("total, not zone");
    expect(screen.getByTestId("tt-strength-value").textContent).toContain("6.4k");
    expect(screen.getByTestId("tt-nutrition").textContent).toContain("1,650 plan");
    expect(screen.getByTestId("tt-nutrition").textContent).not.toMatch(/target/i);
    for (const t of ["tt-weight", "tt-cardio", "tt-strength", "tt-nutrition"]) {
      expect(screen.getByTestId(`${t}-spark`).tagName.toLowerCase()).toBe("svg");
    }
  });

  it("an unreadable section shows its reason and no number", () => {
    const goals = { ...data.goals!, cardio: { ...data.goals!.cardio, section: { ok: false, reason: "couldn't read cardio" } } };
    render(<TrendTiles goals={goals} />);
    const tile = screen.getByTestId("tt-cardio");
    expect(tile.textContent).toContain("couldn't read cardio");
    expect(within(tile).queryByTestId("tt-cardio-value")).toBeNull();
  });

  it("an older Lambda without strength_volume says so rather than showing 0", () => {
    const { strength_volume: _omit, ...older } = data.goals!;
    render(<TrendTiles goals={older} />);
    expect(screen.getByTestId("tt-strength").getAttribute("data-ok")).toBe("0");
  });
});
