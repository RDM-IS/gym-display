import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import StatusScreen, {
  CheckinSection,
  FlagSection,
  ProgramSection,
  StrengthSection,
  TodaySection,
  WEIGHT_BOX,
  WeekSection,
  WeightSection,
} from "../src/screens/StatusScreen";
import { barTargets } from "../src/lib/bottom-bar";
import {
  chartGeometry,
  checkinParts,
  deloadText,
  programTitle,
  progressText,
  sorenessStrip,
  topSetText,
} from "../src/lib/overview";
import type { OverviewResponse } from "../src/lib/types";
import fixture from "./fixtures/overview.json";

const OV = fixture as unknown as OverviewResponse;

function clone(over: Partial<OverviewResponse> = {}): OverviewResponse {
  return { ...(JSON.parse(JSON.stringify(OV)) as OverviewResponse), ...over };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("formatting", () => {
  it("progress in the right unit", () => {
    expect(progressText({ unit: "sets", done: 1, planned: 12 })).toBe("Sets 1 / 12");
    expect(progressText({ unit: "minutes", done: 14, planned: 38 })).toBe("Minutes 14 / 38");
    expect(progressText({ unit: "rest", done: null, planned: null })).toBe("Rest");
    expect(progressText(null)).toBe("No session today");
  });

  it("program header and deload countdown", () => {
    const p = OV.program!;
    expect(programTitle(p)).toBe("Foundation · Phase 1 · Week 1 of 7");
    expect(deloadText(p)).toBe("Deload in 6 weeks");
    expect(deloadText({ ...p, weeks_to_deload: 1 })).toBe("Deload next week");
    expect(deloadText({ ...p, weeks_to_deload: 0 })).toBe("Deload week");
  });

  it("labels every check-in number", () => {
    expect(checkinParts(OV.today.checkin)).toEqual(["Sleep 7.5 h", "Energy 4/5", "Weight 282.6 lb", "RHR 58 bpm"]);
    expect(checkinParts(null)).toEqual([]);
  });

  it("top sets", () => {
    expect(topSetText({ date: "2026-09-16", weight_lbs: 180, reps: 12, score: 2160 })).toBe("9/16 · 180 lb × 12");
    expect(topSetText({ date: "2026-09-16", weight_lbs: null, reps: 10, score: 10 })).toBe("9/16 · × 10");
    expect(topSetText(null)).toBe("—");
  });

  it("soreness and pain stay apart in the strip", () => {
    const rows = sorenessStrip(OV.checkins_14d);
    expect(rows.map((r) => r.key)).toEqual([
      "pain:low back", "pain:shoulder", "sore:hamstrings", "sore:legs", "sore:quads",
    ]);
    const shoulder = rows.find((r) => r.key === "pain:shoulder")!;
    expect(shoulder.cells.map((c) => c.value)).toEqual([null, 1, 2, 1, null]);
    expect(rows.some((r) => r.region === "overall")).toBe(false);
  });
});

describe("weight chart", () => {
  it("one reading: a dot, no line; the axis is padded ±3 lb", () => {
    const g = chartGeometry([{ date: "2026-09-21", value: 282.6 }], WEIGHT_BOX,
      { pad: 3, from: "2026-08-23", to: "2026-09-21" });
    expect(g.dots).toHaveLength(1);
    expect(g.path).toBeNull();
    expect([g.yMin, g.yMax]).toEqual([279, 286]);
    // Labels sit outside the plot: the plot starts right of the y-label gutter.
    expect(g.plot.x0).toBe(WEIGHT_BOX.left);
    expect(g.plot.y1).toBe(WEIGHT_BOX.height - WEIGHT_BOX.bottom);
    for (const d of g.dots) {
      expect(d.x).toBeGreaterThanOrEqual(g.plot.x0);
      expect(d.y).toBeGreaterThanOrEqual(g.plot.y0);
      expect(d.y).toBeLessThanOrEqual(g.plot.y1);
    }

    render(<WeightSection data={clone({ weight_30d: [{ date: "2026-09-21", value: 282.6 }],
      weight_summary: { first: { date: "2026-09-21", value: 282.6 }, latest: { date: "2026-09-21", value: 282.6 }, change: 0 } })} />);
    expect(screen.getAllByTestId("weight-dot")).toHaveLength(1);
    expect(screen.queryByTestId("weight-line")).toBeNull();
    expect(screen.getByTestId("weight-summary").textContent).toContain("Change 0 lb");
  });

  it("many readings: a line, labeled axis and summary", () => {
    render(<WeightSection data={OV} />);
    expect(screen.getAllByTestId("weight-dot")).toHaveLength(7);
    expect(screen.getByTestId("weight-line")).toBeDefined();
    const chart = screen.getByTestId("weight-chart");
    expect(chart.textContent).toContain("295 lb");
    expect(chart.textContent).toContain("279 lb");
    const sum = screen.getByTestId("weight-summary").textContent!;
    expect(sum).toContain("First 291.2 lb (8/30)");
    expect(sum).toContain("Latest 282.6 lb (9/21)");
    expect(sum).toContain("Change −8.6 lb");
  });

  it("no readings: an empty state", () => {
    render(<WeightSection data={clone({ weight_30d: [], weight_summary: null })} />);
    expect(screen.getByText("No weight readings in the last 30 days.")).toBeDefined();
  });
});

describe("empty states", () => {
  it("program", () => {
    render(<ProgramSection data={clone({ program: null })} />);
    expect(screen.getByText("No program on the calendar.")).toBeDefined();
  });

  it("week", () => {
    render(<WeekSection data={clone({ week_days: [] })} onOpen={() => {}} />);
    expect(screen.getByText("No sessions planned this week.")).toBeDefined();
  });

  it("today: no plan, no check-in", () => {
    const ov = clone();
    ov.today = { ...ov.today, day: null, progress: null, checkin: null, adjustment: null };
    render(<TodaySection data={ov} />);
    expect(screen.getByText("Nothing planned today.")).toBeDefined();
    expect(screen.getByTestId("st-checkin-empty").textContent).toBe("No check-in yet");
  });

  it("strength: none planned, and not-yet-logged rows", () => {
    const { unmount } = render(<StrengthSection rows={[]} />);
    expect(screen.getByText("No strength exercises this week.")).toBeDefined();
    unmount();
    render(<StrengthSection rows={OV.strength_progress} />);
    const pec = screen.getByRole("row", { name: /Pec fly/ });
    expect(within(pec).getByText("not yet logged")).toBeDefined();
    expect(within(pec).getAllByText("—").length).toBeGreaterThanOrEqual(4);
  });

  it("check-ins", () => {
    render(<CheckinSection checkins={[]} />);
    expect(screen.getByText("No check-ins yet this program.")).toBeDefined();
  });

  it("flags", () => {
    render(<FlagSection flags={[]} />);
    expect(screen.getByTestId("st-flags-empty").textContent).toBe("Nothing flagged");
  });
});

describe("labels", () => {
  it("strength table has labeled columns and trend arrows", () => {
    render(<StrengthSection rows={OV.strength_progress} />);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(
      ["Exercise", "Last", "Previous", "Trend", "Best", "Machine setup"]);
    const lp = screen.getByRole("row", { name: /Leg press/ });
    expect(within(lp).getAllByText("180 lb × 12")).toHaveLength(2);     // last + best
    expect(within(lp).getAllByTitle("9/16 · 180 lb × 12")).toHaveLength(2);
    expect(lp.textContent).toContain("seat 4");                          // legacy setting
    const pd = screen.getByRole("row", { name: /Lat pulldown/ });
    expect(pd.textContent).toContain("seat 5 · pad 2");                 // named positions
    expect(screen.getByLabelText("Up")).toBeDefined();
    expect(screen.getByLabelText("Down")).toBeDefined();
  });

  it("today shows progress, check-in, soreness and pain", () => {
    render(<TodaySection data={OV} />);
    expect(screen.getByTestId("st-progress").textContent).toBe("Sets 1 / 12");
    const ci = screen.getByTestId("st-checkin").textContent!;
    expect(ci).toContain("Sleep 7.5 h · Energy 4/5 · Weight 282.6 lb · RHR 58 bpm");
    expect(ci).toContain("Soreness hamstrings 2/5");
    expect(ci).toContain("Pain low back 3/5");
  });

  it("the week tiles use the Week view icons, today and Adjusted", () => {
    render(<WeekSection data={OV} onOpen={() => {}} />);
    expect(screen.getByTestId("st-tile-2026-09-16").textContent).toContain("✓");
    expect(screen.getByTestId("st-tile-2026-09-17").textContent).toContain("◐");
    expect(screen.getByTestId("st-tile-2026-09-19").textContent).toContain("✕");
    expect(screen.getByTestId("st-tile-2026-09-22").textContent).toContain("•");
    expect(screen.getByTestId("st-tile-2026-09-18").textContent).toContain("Adjusted");
    // EVENING-1: the DATE now heads the group, so today is marked on the day
    // heading rather than on each slot's button.
    expect(within(screen.getByTestId("st-day-2026-09-21")).getByText("Mon 9/21")
      .getAttribute("aria-current")).toBe("date");
  });

  it("the bar on Status offers all three views", () => {
    expect(barTargets("status")).toEqual(["today", "tomorrow", "week"]);
  });
});

describe("StatusScreen", () => {
  let online = true;
  beforeEach(() => {
    online = true;
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (!online) throw new TypeError("Load failed");
      if (String(input).includes("/api/health/overview")) {
        return new Response(JSON.stringify(OV), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return Response.error();
    }));
  });

  it("renders every section, hides nothing, and opens a day from a tile", async () => {
    const onNavigate = vi.fn();
    render(<StatusScreen onNavigate={onNavigate} />);
    await waitFor(() => screen.getByTestId("st-program"));
    for (const id of ["st-program", "st-week", "st-today", "st-strength", "st-checkins",
                      "st-patterns", "st-flags", "st-weight"]) {
      expect(screen.getByTestId(id)).toBeDefined();
    }
    expect(screen.queryByRole("button", { name: /start/i })).toBeNull();
    expect(document.querySelector("input, textarea, select")).toBeNull();
    fireEvent.click(screen.getByTestId("st-tile-2026-09-16"));
    expect(screen.getByTestId("status-day")).toBeDefined();
    expect(screen.getByTestId("plan-detail-logged").textContent).toContain("Leg press — 2 sets · 12, 11 reps · top 180 lb");
    fireEvent.click(within(screen.getByTestId("bottom-bar")).getByRole("button", { name: "Week" }));
    expect(onNavigate).toHaveBeenCalledWith("week");
  });

  it("hides Patterns when there are none", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(clone({ patterns: [] })),
      { status: 200, headers: { "Content-Type": "application/json" } })));
    render(<StatusScreen onNavigate={() => {}} />);
    await waitFor(() => screen.getByTestId("st-flags"));
    expect(screen.queryByTestId("st-patterns")).toBeNull();
  });

  it("offline: last data marked 'as of'", async () => {
    const first = render(<StatusScreen onNavigate={() => {}} />);
    await waitFor(() => screen.getByTestId("st-program"));
    first.unmount();
    online = false;
    render(<StatusScreen onNavigate={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("status-stale").textContent).toMatch(/^Offline — as of \d\d:\d\d$/));
    expect(screen.getByTestId("st-program")).toBeDefined();
  });

  it("refreshes on focus, never polls", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval"] });
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    render(<StatusScreen onNavigate={() => {}} />);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    vi.advanceTimersByTime(30 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("focus"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe("robustness", () => {
  it("a malformed response is an error, not a crash", async () => {
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ by_exercise: {} }),
      { status: 200, headers: { "Content-Type": "application/json" } })));
    render(<StatusScreen onNavigate={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("status-error").textContent).toContain("unexpected response"));
    expect(screen.getByTestId("bottom-bar")).toBeDefined();
  });
});
