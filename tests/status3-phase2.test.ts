import { describe, expect, it } from "vitest";
import type { GridDay, GridInfo, PlanDay, StrengthQuota } from "../src/lib/types";
import { gridColumns, isMandatoryEvening, strengthFor } from "../src/lib/status3";

// STATUS-3 phase 2 — the Recommended row is driven by the weekly strength goal,
// whose placements and urgency the Lambda computes. Synthetic rows only
// (PUBLIC-FIXTURES): no loads, RPE or bodyweight anywhere in this file.
//
// The week is Ryan's own worked example (2026-11-10): goal week Mon 11/9 –
// Sun 11/15, 0 strength days done after Tuesday → Wed (red), Fri, Sun; the day
// before the red day is orange.

let nextId = 9000;
function row(date: string, session_type: string, display_name: string,
             extra: Partial<PlanDay> = {}): PlanDay {
  return {
    plan_id: nextId++, plan_date: date, slot: "morning", session_type,
    display_name, status: "planned", adjusted: false, blocks: { type: session_type },
    ...extra,
  } as unknown as PlanDay;
}

const D = (n: number) => `2026-11-${String(n).padStart(2, "0")}`;
const OFFICE = (n: number): GridDay => ({ date: D(n), day_type: "msp_work", location: "office", away: false });
const HOME = (n: number): GridDay => ({ date: D(n), day_type: "msp_home", location: "msp_home", away: false });

function quota(over: Partial<StrengthQuota> = {}): StrengthQuota {
  return {
    section: { ok: true, reason: null }, week_start: D(9), week_end: D(15),
    strength_days: [], count: 0, required: 3, needed: 3, days_left: 6, status: "tight",
    counted: true, away: false, capacity: 3,
    placements: [D(11), D(13), D(15)], last_chance: D(11),
    urgency: { [D(11)]: "red", [D(10)]: "orange" }, blocked_days: [],
    ...over,
  };
}

function grid(q: StrengthQuota | null, days?: PlanDay[], cycle?: GridDay[]): GridInfo {
  return {
    section: { ok: true, reason: null }, start: D(9), end: D(15), burn: [],
    days: days ?? [
      row(D(9), "cardio_z2", "Row ladder"),
      row(D(10), "strength_full", "Full Body"),
      row(D(11), "cardio_z2", "Row ladder"),
      row(D(12), "strength_full", "Full Body"),
      row(D(13), "cardio_z2", "Row ladder"),
      row(D(14), "cardio_z2", "Row ladder"),
      row(D(15), "rest", "Rest"),
      row(D(11), "recovery_flow", "Recovery Flow", { slot: "evening" }),
    ],
    cycle: cycle ?? [HOME(9), OFFICE(10), OFFICE(11), OFFICE(12), OFFICE(13), HOME(14), HOME(15)],
    cycle_section: { ok: true, reason: null },
    quotas: q ? [q] : [],
  } as GridInfo;
}

const byDate = (g: GridInfo, today = D(10)) =>
  Object.fromEntries(gridColumns(g, today, null).map((c) => [c.date, c]));

describe("Ryan's example: week of 11/9, 0 done after Tue", () => {
  const c = byDate(grid(quota()));

  it("Wed is red, the last chance, as Full Body at the office", () => {
    expect(c[D(11)].rec).toMatchObject({ tone: "red", label: "Full body (office)", kind: "goal" });
    expect(c[D(11)].rec?.why).toBe("Last chance for 3");
  });

  it("today (Tue), the day before, is orange and names a strength session", () => {
    expect(c[D(10)].rec).toMatchObject({ tone: "orange", label: "Full Body", kind: "goal" });
    expect(c[D(10)].rec?.why).toBe("Spare day before Wed");
  });

  it("Fri and Sun are placed, uncoloured beyond green; Sun is a home day", () => {
    expect(c[D(13)].rec).toMatchObject({ tone: "green", label: "Full body (office)" });
    expect(c[D(15)].rec).toMatchObject({ tone: "green", label: "Row + floor or Bodyweight" });
  });

  it("other days get a ladder, and an unplaced strength row is optional, never urgent", () => {
    expect(c[D(14)].rec).toMatchObject({ tone: "green", label: "Row ladder", kind: "plan" });
    expect(c[D(12)].rec).toMatchObject({ tone: "neutral", label: "Full Body",
                                         why: "Optional · counts" });
  });

  it("exactly one red and one orange", () => {
    const tones = Object.values(c).map((x) => x.rec?.tone);
    expect(tones.filter((t) => t === "red")).toHaveLength(1);
    expect(tones.filter((t) => t === "orange")).toHaveLength(1);
  });

  it("the Recovery Flow evening is blank (amendment 1)", () => {
    expect(c[D(11)].evening).toBeNull();
  });
});

describe("today's cell never says 'plan done, extra' while the goal is owed", () => {
  it("names the next required session and its day", () => {
    const days = grid(quota()).days.map((r) => r.plan_date === D(12) ? ({ ...r, status: "done" } as PlanDay) : r);
    // Thursday, its own row done but not a strength day yet (synthetic): the
    // goal still needs Fri and Sun.
    const q = quota({ placements: [D(13), D(15)], last_chance: D(13), needed: 2,
                      urgency: { [D(13)]: "red" } });
    const c = byDate(grid(q, days), D(12));
    expect(c[D(12)].rec?.label).toBe("Next: Fri");
    expect(c[D(12)].rec?.why).toBe("Full body (office)");
    expect(c[D(12)].rec?.kind).toBe("goal");
    expect(c[D(12)].rec?.label).not.toContain("Extra");
  });

  it("offers the extra once the goal is met and the plan is done", () => {
    const days = grid(null).days.map((r) => r.plan_date === D(12) ? ({ ...r, status: "done" } as PlanDay) : r);
    const q = quota({ needed: 0, count: 3, status: "met", placements: [], last_chance: null, urgency: {} });
    const c = byDate(grid(q, days), D(12));
    expect(c[D(12)].rec?.label).toBe("Extra: yoga or a light row");
  });
});

describe("travel, away and fallbacks", () => {
  it("a travel day is never placed and says Bodyweight is optional", () => {
    const cyc = [HOME(9), OFFICE(10), OFFICE(11), OFFICE(12), OFFICE(13), HOME(14),
                 { date: D(15), day_type: "travel", location: "brown_deer", away: false } as GridDay];
    const q = quota({ placements: [D(10), D(12), D(14)], last_chance: D(10),
                      urgency: { [D(10)]: "red" }, blocked_days: [D(15)] });
    const c = byDate(grid(q, undefined, cyc));
    expect(c[D(15)].rec).toMatchObject({ label: "Travel day", tone: "neutral" });
    expect(c[D(10)].rec?.tone).toBe("red");
  });

  it("a not-counted week (an away week) colours nothing", () => {
    const q = quota({ counted: false, status: "not_counted", away: true });
    const tones = Object.values(byDate(grid(q))).map((x) => x.rec?.tone);
    expect(tones).not.toContain("red");
    expect(tones).not.toContain("orange");
  });

  it("an unreadable quota falls back to the plan, uncoloured", () => {
    const q = quota({ section: { ok: false, reason: "couldn't read strength days" } });
    const c = byDate(grid(q));
    expect(c[D(11)].rec).toMatchObject({ label: "Row ladder", tone: "green", kind: "plan" });
    expect(Object.values(c).some((x) => x.rec?.tone === "red")).toBe(false);
  });

  it("an older Lambda (no quotas sent) keeps phase 1's row", () => {
    const g = { ...grid(quota()), quotas: undefined, cycle: undefined };
    const c = byDate(g);
    expect(c[D(11)].rec).toMatchObject({ label: "Row ladder", kind: "plan" });
  });
});

describe("rooms (amendment 3) and the evening rule", () => {
  it("names the strength session for the room", () => {
    expect(strengthFor(OFFICE(10), null)).toBe("Full body (office)");
    expect(strengthFor(HOME(9), null)).toBe("Row + floor or Bodyweight");
    expect(strengthFor({ ...HOME(9), location: "richfield", day_type: "wi" }, null)).toBe("Bike + floor or Bodyweight");
    expect(strengthFor({ ...HOME(9), location: "brown_deer", day_type: "wi" }, null)).toBe("Run + floor or Bodyweight");
  });

  it("only a mandatory evening fills the Evening row", () => {
    expect(isMandatoryEvening(row(D(9), "recovery_flow", "Recovery Flow", { slot: "evening" }))).toBe(false);
    expect(isMandatoryEvening(row(D(9), "mobility", "Mobility", { slot: "evening" }))).toBe(false);
    expect(isMandatoryEvening(row(D(9), "strength_bw", "Bodyweight", { slot: "evening" }))).toBe(true);
  });
});
