// SESSION-OPEN 5a — the week counter, the "counts" tags and the day-off banner.
// Synthetic data only (PUBLIC-FIXTURES): 2031 dates, no real logs.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import LibraryScreen from "../src/screens/LibraryScreen";
import RestDayScreen from "../src/screens/RestDayScreen";
import type { FetchStatusResult } from "../src/lib/api";
import { counterView, countsTypes, UNREADABLE_TEXT } from "../src/lib/strengthCounter";
import type { LibraryResponse, Plan, StrengthQuota, StrengthQuotaStatus } from "../src/lib/types";

// What the Lambda serves. The test deliberately uses a list the CODE has never
// seen, so a tag can only come from this payload, never from a copy in src/.
const SERVED_TYPES = ["strength_a", "strength_bw", "row_circuit", "synthetic_counts"];

function quota(over: Partial<StrengthQuota>): StrengthQuota {
  return {
    section: { ok: true, reason: null }, week_start: "2031-03-02", week_end: "2031-03-08",
    strength_days: ["2031-03-03"], count: 1, required: 3, needed: 2, days_left: 4,
    status: "on_track", strength_day_types: SERVED_TYPES, ...over,
  };
}
function okStatus(q: StrengthQuota | null | undefined): FetchStatusResult {
  return { status: "ok", data: { strength_quota: q } as never };
}

describe("counterView — one read, one status", () => {
  const cases: Array<[StrengthQuotaStatus, Partial<StrengthQuota>, string, string]> = [
    ["met", { count: 3, needed: 0, days_left: 2 }, "Strength 3 of 3 — done", "met"],
    ["on_track", { count: 1, days_left: 4 }, "Strength 1 of 3 · 4 days left", "neutral"],
    ["tight", { count: 1, needed: 2, days_left: 2 }, "Strength 1 of 3 · 2 days left", "tight"],
    ["short", { count: 0, needed: 3, days_left: 2 }, "Strength 0 of 3 · 2 days left", "short"],
    ["short", { count: 2, needed: 1, days_left: 0 }, "Strength 2 of 3 · no days left", "short"],
    ["tight", { count: 2, needed: 1, days_left: 1 }, "Strength 2 of 3 · 1 day left", "tight"],
    ["not_counted", { count: 1, days_left: 3 }, "Strength 1 of 3 · 3 days left", "neutral"],
  ];
  for (const [status, over, text, tone] of cases) {
    it(`${status} → ${text}`, () => {
      expect(counterView(okStatus(quota({ ...over, status })))).toEqual({ text, tone });
    });
  }

  it("unreadable is never a zero, whichever way it is unreadable", () => {
    const unreadable: FetchStatusResult[] = [
      { status: "error", message: "HTTP 500" },
      okStatus(undefined),                                              // an older Lambda
      okStatus(null),
      okStatus(quota({ section: { ok: false, reason: "couldn't read strength days" },
                       count: null, required: null, days_left: null, status: null })),
      okStatus(quota({ count: null })),
      okStatus(quota({ status: null })),
    ];
    for (const s of unreadable) {
      const v = counterView(s);
      expect(v).toEqual({ text: UNREADABLE_TEXT, tone: "unreadable" });
      expect(v.text).not.toMatch(/\b0\b/);
    }
    expect(UNREADABLE_TEXT).toBe("Couldn't read this week's strength count");
  });

  it("loading says so", () => {
    expect(counterView(null).tone).toBe("loading");
  });
});

describe("countsTypes — served by the Lambda, never copied", () => {
  it("is exactly the served list", () => {
    expect([...countsTypes(okStatus(quota({})))]).toEqual(SERVED_TYPES);
  });
  it("is empty when it can't be read — nothing is tagged on a guess", () => {
    expect(countsTypes({ status: "error", message: "x" }).size).toBe(0);
    expect(countsTypes(okStatus(quota({ strength_day_types: undefined }))).size).toBe(0);
    expect(countsTypes(null).size).toBe(0);
  });
  it("gym-display has no copy of STRENGTH_DAY_TYPES", async () => {
    const files = import.meta.glob("../src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true });
    // A literal list naming both a lift and the circuit is the shape of a copy.
    const COPY = /["']row_circuit["'][\s\S]{0,200}["']strength_bw["']|["']strength_bw["'][\s\S]{0,200}["']row_circuit["']/;
    // The scan can fail: it sees the source tree, and it matches a copy.
    expect(Object.keys(files).length).toBeGreaterThan(20);
    expect(COPY.test('const T = new Set(["strength_a", "strength_bw", "row_circuit"]);')).toBe(true);
    for (const [path, src] of Object.entries(files)) {
      expect(COPY.test(src as string), path).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

const S = (t: string, name: string) => ({
  session_type: t, display_name: name, week_num: 3, phase: 2, target_rpe: 6, target_hr_zone: null,
  est_duration_min: 40, blocks: { type: "circuit", rounds: 1, exercises: [] },
});
const LIB: LibraryResponse = {
  available: true, stale: false, today: "2031-03-04", generated_on: "2031-03-04", week_num: 3,
  today_location_key: "office",
  locations: [{ key: "office", display: "office gym", sessions: [
    S("core", "Test Core") as never, S("mobility", "Test Mobility") as never,
    S("synthetic_counts", "Test Synthetic") as never,
    S("strength_a", "Test A") as never, S("strength_bw", "Test BW") as never,
  ] }],
};
function stub(lib: LibraryResponse = LIB) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const u = String(url);
    const body = u.includes("strength-next") ? { available: true, session_type: "strength_a", after: null }
      : u.includes("recommend") ? { available: true, primary: "row", label: "Row", reason: "test", more: ["mobility"] }
      : lib;
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("LibraryScreen — the counter", () => {
  it("shows the count and colours it by status", async () => {
    stub();
    render(<LibraryScreen onLaunch={() => {}} status={okStatus(quota({ status: "tight", count: 1, days_left: 2 }))} />);
    const c = await screen.findByTestId("strength-counter");
    expect(c.textContent).toBe("Strength 1 of 3 · 2 days left");
    expect(c.getAttribute("data-tone")).toBe("tight");
    expect(c.className).toContain("strength-counter--tight");
  });

  it("says it couldn't read rather than 0 of 3", async () => {
    stub();
    render(<LibraryScreen onLaunch={() => {}} status={{ status: "error", message: "HTTP 503" }} />);
    const c = await screen.findByTestId("strength-counter");
    expect(c.textContent).toBe("Couldn't read this week's strength count");
    expect(screen.queryByText(/0 of 3/)).toBeNull();
    expect(screen.queryAllByTestId("counts-tag")).toHaveLength(0);
  });
});

describe("LibraryScreen — counts tags", () => {
  it("tags exactly the buttons whose type the Lambda served", async () => {
    stub();
    render(<LibraryScreen onLaunch={() => {}} onOpenRowCircuit={() => {}} onOpenRowLadder={() => {}}
                          onOpenLadder={() => {}} status={okStatus(quota({}))} />);
    await waitFor(() => expect(screen.getByTestId("quick-strength")).toBeDefined());
    for (const id of ["quick-strength", "quick-bodyweight", "quick-row-circuit"]) {
      expect(within(screen.getByTestId(id)).queryByTestId("counts-tag"), id).not.toBeNull();
    }
    for (const id of ["quick-row", "quick-ride", "quick-run"]) {
      expect(within(screen.getByTestId(id)).queryByTestId("counts-tag"), id).toBeNull();
    }
    // In More: only the type the payload names (a type src/ has never heard of).
    const more = (name: string) => screen.getByText(name).closest("button")!;
    expect(within(more("Test Synthetic")).queryByTestId("counts-tag")).not.toBeNull();
    expect(within(more("Test Core")).queryByTestId("counts-tag")).toBeNull();
  });
});

describe("day off — warns, never hides", () => {
  it("shows QuickStart and every More session under the banner", async () => {
    stub();
    render(<LibraryScreen onLaunch={() => {}} dayOff onOpenRowLadder={() => {}}
                          status={okStatus(quota({}))} />);
    await screen.findByTestId("day-off-banner");
    expect(screen.getByTestId("day-off-banner").textContent)
      .toBe("Day off from the check-in — gentle mobility suggested.");
    expect(screen.getByTestId("quick-start")).toBeDefined();
    await waitFor(() => expect(screen.getByTestId("quick-strength")).toBeDefined());
    expect(screen.getByTestId("quick-bodyweight")).toBeDefined();
    for (const name of ["Test Core", "Test Mobility", "Test Synthetic"]) {
      expect(screen.getByText(name), name).toBeDefined();
    }
    // RECOMMEND may still highlight Mobility.
    expect(screen.getByText("Test Mobility").closest("button")!.getAttribute("data-recommended")).toBe("true");
  });

  it("the rest-day screen still opens the Sessions page on a day off", () => {
    const DAY_OFF: Plan = {
      plan_id: 9201, plan_date: "2031-03-04", phase: 2, week_num: 3, session_type: "rest_mobility",
      target_rpe: 0, est_duration_min: 0, is_skipped: false,
      blocks: { type: "mobility", display_name: "Day off", duration_min: 0 } as never,
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ days: [] }), { status: 200 })));
    const open = vi.fn();
    render(<RestDayScreen plan={DAY_OFF} onOpenLibrary={open} />);
    expect(screen.getByText("No training today.")).toBeDefined();
    screen.getByText("Start a session").click();
    expect(open).toHaveBeenCalled();
  });
});

describe("stale notice names the fix", () => {
  it("says to send rebuild sessions", async () => {
    stub({ ...LIB, stale: true, generated_on: "2031-03-01" } as LibraryResponse);
    render(<LibraryScreen onLaunch={() => {}} status={okStatus(quota({}))} />);
    expect(await screen.findByText('Built for 2031-03-01 — send "rebuild sessions" to Artemis.')).toBeDefined();
  });
});
