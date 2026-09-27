// SESSION-LIB + ADHOC-LOG — the library screen and ad-hoc logging.
// Synthetic data only (PUBLIC-FIXTURES): 2027 dates, made-up loads.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import LibraryScreen, { planFromLibrary } from "../src/screens/LibraryScreen";
import RestDayScreen from "../src/screens/RestDayScreen";
import { ADHOC_PLAN_ID, adhocState, applyAdhoc, endAdhoc, noteAdhocResponse, startAdhoc } from "../src/lib/adhoc";
import { _resetQueueForTests, submitLog } from "../src/lib/log-queue";
import { pathToRoute, routeToPath } from "../src/lib/routing";
import type { LibraryResponse, LogExerciseIn, Plan } from "../src/lib/types";

const SESSION = {
  session_type: "core", display_name: "Test Core", week_num: 9, phase: 1,
  target_rpe: 6, target_hr_zone: null, est_duration_min: 44,
  blocks: { type: "circuit", rounds: 1, exercises: [] },
};
const LIB: LibraryResponse = {
  available: true, stale: false, today: "2027-03-02", generated_on: "2027-03-02",
  week_num: 9, today_location_key: "office",
  locations: [
    { key: "office", display: "office gym", sessions: [
      SESSION as never,
      { ...SESSION, session_type: "recovery_flow", display_name: "Test Flow",
        blocks: { type: "recovery_flow" } } as never,
    ] },
    { key: "msp_home", display: "home", sessions: [
      { ...SESSION, session_type: "recovery_flow", display_name: "Test Flow",
        blocks: { type: "recovery_flow" } } as never,
    ] },
  ],
};

function stubLibrary(body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } })));
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); endAdhoc(); _resetQueueForTests(); });

describe("routing", () => {
  it("has a /library route", () => {
    expect(pathToRoute("/library")).toBe("library");
    expect(routeToPath("library")).toBe("/library");
    expect(pathToRoute("/today")).toBe("today");
  });
});

describe("LibraryScreen", () => {
  it("lists today's location's sessions and launches one", async () => {
    stubLibrary(LIB);
    const onLaunch = vi.fn();
    render(<LibraryScreen onLaunch={onLaunch} />);
    await waitFor(() => expect(screen.getByText("Test Core")).toBeDefined());
    expect(screen.getByText(/office gym · today/)).toBeDefined();
    fireEvent.click(screen.getByText("Test Core"));
    const [plan, type] = onLaunch.mock.calls[0] as [Plan, string];
    expect(type).toBe("core");
    expect(plan.plan_id).toBe(ADHOC_PLAN_ID);
    expect(plan.plan_date).toBe("2027-03-02");
  });

  it("a location override is for this launch and shows only what's there", async () => {
    stubLibrary(LIB);
    render(<LibraryScreen onLaunch={() => {}} />);
    await waitFor(() => screen.getByText("Test Core"));
    fireEvent.click(screen.getByLabelText("Change location for this session"));
    fireEvent.click(screen.getByRole("button", { name: "home" }));
    expect(screen.queryByText("Test Core")).toBeNull();       // absent, not greyed
    expect(screen.getByText("Test Flow")).toBeDefined();
    expect(screen.getByText(/home · this session only/)).toBeDefined();
  });

  it("says why when the library isn't available", async () => {
    stubLibrary({ available: false, reason: "Not built yet." });
    render(<LibraryScreen onLaunch={() => {}} />);
    await waitFor(() => expect(screen.getByText("Not built yet.")).toBeDefined());
  });

  it("flags a stale library", async () => {
    stubLibrary({ ...LIB, stale: true, generated_on: "2027-03-01" });
    render(<LibraryScreen onLaunch={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Built for 2027-03-01, not today/)).toBeDefined());
  });
});

describe("ad-hoc logging", () => {
  const body: LogExerciseIn = { plan_id: ADHOC_PLAN_ID, exercise: "Test press", log_type: "strength_set",
    sets: [{ set_num: 1, reps_done: 9, weight_lbs: 11, rpe_actual: 6 }] };

  it("leaves ordinary logs alone", () => {
    expect(applyAdhoc({ ...body, plan_id: 42 })).toEqual({ ...body, plan_id: 42 });
    expect(applyAdhoc(body)).toEqual(body);            // no launch active
  });

  it("sends the session type until the server names a row, then the row", () => {
    startAdhoc("strength_a");
    const first = applyAdhoc(body);
    expect(first.plan_id).toBeUndefined();
    expect(first.adhoc_session_type).toBe("strength_a");
    noteAdhocResponse({ plan_id: 77, inserted: 1, rows: [] });
    expect(applyAdhoc(body).plan_id).toBe(77);
    expect(applyAdhoc(body).adhoc_session_type).toBeUndefined();
  });

  it("stays ad-hoc when the server stored it unattached", () => {
    startAdhoc("core");
    noteAdhocResponse({ plan_id: null, adhoc: true, inserted: 1, rows: [] });
    expect(adhocState()?.planId).toBeNull();
    expect(applyAdhoc(body).adhoc_session_type).toBe("core");
  });

  it("submitLog rewrites the placeholder before it reaches the network", async () => {
    const sent: LogExerciseIn[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      sent.push(JSON.parse(init!.body as string));
      return new Response(JSON.stringify({ plan_id: 55, inserted: 1, rows: [] }),
        { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    startAdhoc("strength_a");
    await submitLog(body);
    await submitLog(body);
    expect(sent[0].adhoc_session_type).toBe("strength_a");
    expect(sent[0].plan_id).toBeUndefined();
    expect(sent[1].plan_id).toBe(55);
  });
});

describe("RestDayScreen", () => {
  const REST: Plan = {
    plan_id: 9101, plan_date: "2027-03-02", phase: 1, week_num: 9, session_type: "rest",
    target_rpe: 0, est_duration_min: 0, is_skipped: false,
    blocks: { type: "rest", display_name: "Rest" } as never,
  };
  beforeEach(() => stubLibrary({ days: [] }));

  it("offers a session instead of 'Mobility 20 min or full rest'", () => {
    const open = vi.fn();
    render(<RestDayScreen plan={REST} onOpenLibrary={open} />);
    expect(screen.queryByText(/Mobility 20 min/)).toBeNull();
    fireEvent.click(screen.getByText("Start a session"));
    expect(open).toHaveBeenCalled();
  });

  it("has no planned-session builder of its own", () => {
    expect(planFromLibrary(SESSION as never, "2027-03-02").blocks).toBe(SESSION.blocks);
  });
});

describe("makeup (MAKEUP-2)", () => {
  const OFFER = { missed_plan_id: 11, missed_date: "2027-03-09", rest_plan_id: 22,
                  session_type: "strength_b", display_name: "Test B", location_key: "office" };

  it("offers the one not-done session on a rest day and swaps it", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn(async (u: RequestInfo | URL, init?: RequestInit) => {
      const url = String(u);
      if (url.includes("/makeup")) {
        calls.push({ url, body: JSON.parse(init!.body as string) });
        return new Response(JSON.stringify({ ok: true, plan_id: 22 }), { status: 200 });
      }
      return new Response(JSON.stringify({ ...LIB, makeup: { week_start: "2027-03-07",
        not_done: [{ plan_id: 11, plan_date: "2027-03-09", session_type: "strength_b",
                     display_name: "Test B", skipped: false }], offer: OFFER, repeat: false } }),
        { status: 200 });
    }));
    const onMadeUp = vi.fn();
    render(<LibraryScreen onLaunch={() => {}} onMadeUp={onMadeUp} />);
    await waitFor(() => screen.getByText("Make up Test B"));
    fireEvent.click(screen.getByText("Make it up today"));
    await waitFor(() => expect(onMadeUp).toHaveBeenCalled());
    expect(calls[0].body).toEqual({ missed_plan_id: 11, rest_plan_id: 22 });
  });

  it("shows the server's reason when the swap is refused", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u: RequestInfo | URL) => {
      if (String(u).includes("/makeup")) {
        return new Response(JSON.stringify({ detail: { error: "makeup_not_possible",
          reason: "today's morning is no longer an unlogged rest day" } }), { status: 409 });
      }
      return new Response(JSON.stringify({ ...LIB, makeup: { week_start: "2027-03-07",
        not_done: [], offer: OFFER, repeat: false } }), { status: 200 });
    }));
    const onMadeUp = vi.fn();
    render(<LibraryScreen onLaunch={() => {}} onMadeUp={onMadeUp} />);
    await waitFor(() => screen.getByText("Make it up today"));
    fireEvent.click(screen.getByText("Make it up today"));
    await waitFor(() => screen.getByText(/no longer an unlogged rest day/));
    expect(onMadeUp).not.toHaveBeenCalled();
  });

  it("says the week repeats when more than one is not done — and offers nothing", async () => {
    stubLibrary({ ...LIB, makeup: { week_start: "2027-03-07", offer: null, repeat: true,
      not_done: [
        { plan_id: 11, plan_date: "2027-03-08", session_type: "strength_a", display_name: "Test A", skipped: false },
        { plan_id: 12, plan_date: "2027-03-09", session_type: "cardio_z2", display_name: "Test Z2", skipped: true },
      ] } });
    render(<LibraryScreen onLaunch={() => {}} />);
    await waitFor(() => screen.getByText(/The week repeats/));
    expect(screen.queryByText("Make it up today")).toBeNull();
  });
});
