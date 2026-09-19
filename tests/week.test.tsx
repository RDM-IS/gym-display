import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import PeekScreen from "../src/screens/PeekScreen";
import PlanDayDetail, { exercisePlanLine } from "../src/components/PlanDayDetail";
import { fetchPlanRange } from "../src/lib/api";
import {
  addDays,
  asOfLabel,
  dayLabel,
  programWeekStart,
  shiftWeek,
  statusIcon,
  tomorrowOf,
  weekDates,
  weekHeading,
} from "../src/lib/week";
import type { CircuitBlocks, PlanDay, PlannedExercise, PlanRangeResponse } from "../src/lib/types";
import office from "./fixtures/recovery-flow-office.json";

function day(date: string, over: Partial<PlanDay> = {}): PlanDay {
  return {
    plan_id: 100, plan_date: date, session_type: "strength_b", display_name: "Office Strength B",
    phase: 1, week_num: 1, target_rpe: 6, est_duration_min: 45, location: "office gym",
    is_skipped: false, adjusted: false, status: "upcoming", logged: [], summary_notes: null,
    blocks: {
      type: "circuit", display_name: "Office Strength B", rounds: 2,
      exercises: [
        { name: "DB goblet squat", format: "reps", target_reps: 12, notes: "2×8-12" },
        { name: "Cable Pallof press", format: "reps", target_reps: 10, notes: "2×10 each side" },
      ],
    },
    ...over,
  } as PlanDay;
}

function resp(today: string, days: PlanDay[]): PlanRangeResponse {
  return { today, timezone: "America/Chicago", range_from: days[0]?.plan_date ?? today,
           range_to: days.at(-1)?.plan_date ?? today, days };
}

describe("week math", () => {
  it("program weeks start on Wednesday", () => {
    // 9/16 Wed … 9/22 Tue all belong to the week of 9/16.
    for (const d of weekDates("2026-09-16")) expect(programWeekStart(d)).toBe("2026-09-16");
    expect(programWeekStart("2026-09-23")).toBe("2026-09-23");
    expect(programWeekStart("2026-11-03")).toBe("2026-10-28");
  });

  it("navigates weeks and crosses months and DST", () => {
    expect(shiftWeek("2026-09-16", 1)).toBe("2026-09-23");
    expect(shiftWeek("2026-09-16", -1)).toBe("2026-09-09");
    expect(weekDates("2026-10-28").at(-1)).toBe("2026-11-03");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");   // DST ends 11/1 in the US
    expect(weekDates("2026-09-16")).toHaveLength(7);
  });

  it("labels", () => {
    expect(dayLabel("2026-09-16")).toBe("Wed 9/16");
    expect(dayLabel("2026-09-22")).toBe("Tue 9/22");
    expect(asOfLabel(new Date(2026, 8, 16, 21, 5))).toBe("as of 21:05");
  });

  it("status icons", () => {
    expect(statusIcon("done")).toEqual({ icon: "✓", label: "Done" });
    expect(statusIcon("partial")).toEqual({ icon: "◐", label: "Partial" });
    expect(statusIcon("missed")).toEqual({ icon: "✕", label: "Missed" });
    expect(statusIcon("upcoming")).toEqual({ icon: "•", label: "Upcoming" });
    expect(statusIcon("today").icon).toBe("•");
  });

  it("heading says Deload in week 7", () => {
    expect(weekHeading([day("2026-09-16"), day("2026-09-17")])).toBe("Phase 1 · Week 1");
    expect(weekHeading([day("2026-10-28", { week_num: 7 })])).toBe("Phase 1 · Week 7 · Deload");
    expect(weekHeading([])).toBeNull();
  });

  it("tomorrow comes from the API's today, not the device", () => {
    const r = resp("2026-09-20", [day("2026-09-20"), day("2026-09-21", { plan_id: 9 })]);
    expect(tomorrowOf(r)?.plan_id).toBe(9);
    expect(tomorrowOf(resp("2026-09-21", [day("2026-09-21")]))).toBeNull();
  });
});

describe("detail lines", () => {
  it("sets × reps and RPE cap, with adjustments", () => {
    const b = day("2026-09-18").blocks as CircuitBlocks & { exercises: PlannedExercise[] };
    expect(exercisePlanLine(b.exercises[0], 2, 6)).toBe("2 × 8-12 · RPE ≤6");
    expect(exercisePlanLine({ name: "Leg extension", format: "reps", notes: "1×10-12", sets: 1, rpe_cap: 5 }, 2, 6))
      .toBe("1 × 10-12 · RPE ≤5");
    expect(exercisePlanLine({ name: "Rear delt fly", format: "reps", notes: "2×12-15",
                              target_load_lbs: 50, load_from: 70 }, 2, 6))
      .toBe("2 × 12-15 · RPE ≤6 · 50 lb (last 70)");
    expect(exercisePlanLine({ name: "Leg press", format: "reps", notes: "2×10-12", added_by: "checkin",
                              replaces: "DB goblet squat" }, 2, null))
      .toBe("2 × 10-12 · added (for DB goblet squat)");
  });

  it("a flow day lists poses and the total; future days say they adjust", () => {
    const flow = day("2026-09-24", { session_type: "recovery_flow", display_name: "Recovery Flow",
                                     blocks: office.blocks as unknown as PlanDay["blocks"] });
    render(<PlanDayDetail day={flow} today="2026-09-23" />);
    const d = screen.getByTestId("plan-detail");
    expect(d.textContent).toContain("41:07 total · 2 rounds");
    expect(d.textContent).toContain("High lunge · Right leg forward");
    expect(d.textContent).toContain("Stretch Trainer");
    expect(d.textContent).toContain("42 min");
    expect(d.textContent).toContain("Seated meditation");
    expect(d.textContent).toContain("Savasana 3:00");
    expect(d.textContent).toContain("Adjusts after your morning check-in.");
  });

  it("a past day shows what was logged and no check-in footer", () => {
    const past = day("2026-09-16", {
      status: "done",
      logged: [{ exercise: "DB goblet squat", log_type: "strength_set", sets: 2, reps: [12, 10],
                 top_weight_lbs: 25, duration_sec: null, skipped: 0 }],
    });
    render(<PlanDayDetail day={past} today="2026-09-21" />);
    const logged = screen.getByTestId("plan-detail-logged");
    expect(logged.textContent).toContain("DB goblet squat — 2 sets · 12, 10 reps · top 25 lb");
    expect(screen.queryByText("Adjusts after your morning check-in.")).toBeNull();
  });
});

// ---------------------------------------------------------------------------

let calls: string[] = [];
let online = true;
let payload: (url: string) => PlanRangeResponse;

beforeEach(() => {
  calls = [];
  online = true;
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (!online) throw new TypeError("Load failed");
    return new Response(JSON.stringify(payload(url)), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function weekPayload(url: string): PlanRangeResponse {
  const from = new URL(url, "http://x").searchParams.get("from")!;
  const days = weekDates(from).map((d, i) => day(d, {
    plan_id: 200 + i,
    week_num: from >= "2026-10-28" ? 7 : 1,
    status: d < "2026-09-21" ? (i === 0 ? "done" : "missed") : d === "2026-09-21" ? "today" : "upcoming",
    adjusted: d === "2026-09-18",
  }));
  return resp("2026-09-21", days);
}

describe("offline cache", () => {
  it("serves the last copy, marked stale with its time", async () => {
    payload = weekPayload;
    const live = await fetchPlanRange("2026-09-16", "2026-09-22");
    expect(live.status === "ok" && live.stale).toBe(false);
    online = false;
    const cached = await fetchPlanRange("2026-09-16", "2026-09-22");
    expect(cached.status).toBe("ok");
    expect(cached.status === "ok" && cached.stale).toBe(true);
    expect(await fetchPlanRange("2026-09-23", "2026-09-29")).toMatchObject({ status: "error" });
  });
});

describe("Week view", () => {
  it("lists the program week, highlights today, and navigates", async () => {
    payload = weekPayload;
    const onNavigate = vi.fn();
    render(<PeekScreen mode="week" onNavigate={onNavigate} deviceToday="2026-09-21" />);
    await waitFor(() => expect(screen.getByTestId("week-title").textContent).toContain("Phase 1 · Week 1"));
    expect(calls[0]).toContain("/api/health/plan?from=2026-09-16&to=2026-09-22");
    const rows = within(screen.getByTestId("week-list")).getAllByRole("button");
    expect(rows).toHaveLength(7);
    expect(rows[0].textContent).toContain("Wed 9/16");
    expect(rows[0].textContent).toContain("✓");
    expect(rows[1].textContent).toContain("✕");
    expect(rows[2].textContent).toContain("Adjusted");
    expect(rows[5].getAttribute("aria-current")).toBe("date");
    expect(screen.getByTestId("plan-detail").textContent).toContain("Mon 9/21");
    expect(screen.queryByRole("button", { name: /start/i })).toBeNull();

    // Bar: Today, Tomorrow — never Week on Week, never Start.
    const bar = () => within(screen.getByTestId("bottom-bar")).getAllByRole("button").map((b) => b.textContent);
    expect(bar()).toEqual(["Today", "Tomorrow"]);

    // A day opens as its own view; Week returns to the same program week.
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    await waitFor(() => expect(calls.at(-1)).toContain("from=2026-09-23&to=2026-09-29"));
    await waitFor(() => expect(within(screen.getByTestId("week-list")).getAllByRole("button")[0].hasAttribute("disabled")).toBe(false));
    fireEvent.click(within(screen.getByTestId("week-list")).getAllByRole("button")[1]);
    expect(screen.getByTestId("peek-day")).toBeDefined();
    expect(screen.getByTestId("plan-detail").textContent).toContain("Thu 9/24");
    expect(bar()).toEqual(["Today", "Week"]);
    fireEvent.click(within(screen.getByTestId("bottom-bar")).getByRole("button", { name: "Week" }));
    expect(screen.getByTestId("peek-week")).toBeDefined();
    expect(screen.getByTestId("week-title").textContent).toContain("Wed 9/23 – Tue 9/29");
    expect(onNavigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Previous week" }));
    await waitFor(() => expect(calls.at(-1)).toContain("from=2026-09-16&to=2026-09-22"));

    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    await waitFor(() => expect(calls.at(-1)).toContain("from=2026-09-23&to=2026-09-29"));
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    await waitFor(() => expect(screen.getByTestId("week-title").textContent).toContain("Week 7 · Deload"));
    expect(calls.at(-1)).toContain("from=2026-10-28&to=2026-11-03");

    expect(screen.queryByRole("button", { name: "‹ Today" })).toBeNull();
    fireEvent.click(within(screen.getByTestId("bottom-bar")).getByRole("button", { name: "Today" }));
    expect(onNavigate).toHaveBeenCalledWith("today");
    fireEvent.click(within(screen.getByTestId("bottom-bar")).getByRole("button", { name: "Tomorrow" }));
    expect(onNavigate).toHaveBeenLastCalledWith("tomorrow");
  });

  it("re-anchors on the API's today", async () => {
    payload = (url) => ({ ...weekPayload(url), today: "2026-09-23" });
    render(<PeekScreen mode="week" onNavigate={() => {}} deviceToday="2026-09-22" />);
    await waitFor(() => expect(calls.at(-1)).toContain("from=2026-09-23"));
    expect(calls).toHaveLength(2);
  });

  it("offline: last data with 'as of'", async () => {
    payload = weekPayload;
    const first = render(<PeekScreen mode="week" onNavigate={() => {}} deviceToday="2026-09-21" />);
    await waitFor(() => screen.getByTestId("plan-detail"));
    first.unmount();
    online = false;
    render(<PeekScreen mode="week" onNavigate={() => {}} deviceToday="2026-09-21" />);
    await waitFor(() => expect(screen.getByTestId("peek-stale").textContent).toMatch(/^Offline — as of \d\d:\d\d$/));
    expect(within(screen.getByTestId("week-list")).getAllByRole("button")[0].textContent).toContain("✓");
  });
});

describe("Tomorrow view", () => {
  it("shows tomorrow read-only with the check-in footer", async () => {
    payload = () => resp("2026-09-20", [
      day("2026-09-19"), day("2026-09-20"),
      day("2026-09-21", { session_type: "strength_c", display_name: "Office Strength C" }),
      day("2026-09-22"),
    ]);
    render(<PeekScreen mode="tomorrow" onNavigate={() => {}} deviceToday="2026-09-20" />);
    await waitFor(() => screen.getByTestId("plan-detail"));
    expect(calls[0]).toContain("from=2026-09-19&to=2026-09-22");
    const d = screen.getByTestId("plan-detail");
    expect(d.textContent).toContain("Office Strength C");
    expect(d.textContent).toContain("office gym · 45 min");
    expect(d.textContent).toContain("DB goblet squat — 2 × 8-12 · RPE ≤6");
    expect(d.textContent).toContain("Adjusts after your morning check-in.");
    expect(screen.queryByRole("button", { name: /start/i })).toBeNull();
    // One separator on the date line.
    expect(d.querySelector(".meta")!.textContent).toBe("Mon 9/21 · Upcoming");
    expect(within(screen.getByTestId("bottom-bar")).getAllByRole("button").map((b) => b.textContent))
      .toEqual(["Today", "Week"]);
  });

  it("says so when nothing is planned", async () => {
    payload = () => resp("2026-11-03", [day("2026-11-03")]);
    render(<PeekScreen mode="tomorrow" onNavigate={() => {}} deviceToday="2026-11-03" />);
    await waitFor(() => screen.getByTestId("peek-empty"));
  });
});
