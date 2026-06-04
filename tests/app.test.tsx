import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import App from "../src/App";
import type { Plan, StatusResponse } from "../src/lib/types";

const PLAN: Plan = {
  plan_id: 42,
  plan_date: "2026-05-06",
  phase: 1,
  week_num: 1,
  session_type: "strength_a",
  target_rpe: 6.5,
  est_duration_min: 40,
  is_skipped: false,
  blocks: {
    type: "circuit",
    warmup: "5 min bike easy",
    rounds: 2,
    rest_between_rounds_sec: 120,
    exercises: [
      { name: "Goblet squat", format: "reps", target_reps: 10, target_load_lbs: 30, rest_after_sec: 60 },
    ],
    cooldown: "8 min bike easy",
    equipment: ["Powerblocks 25-35lb", "TRX"],
    setup_notes: ["TRX at mid-anchor"],
  },
};

function statusFixture(overrides: Partial<StatusResponse> = {}): StatusResponse {
  return {
    today: "2026-05-06",
    window_start: "2026-05-01",
    window_end: "2026-05-11",
    today_summary: {
      plan_id: 42,
      session_type: "strength_a",
      is_skipped: false,
      is_logged: false,
      exists: true,
    },
    banner: { phase: 1, week_num: 1, phase_name: "Foundation", as_of_date: "2026-05-06" },
    day_strip: [],
    most_recent_session: null,
    same_type_history: [],
    rpe_trend: [],
    weight_trend: [],
    ...overrides,
  };
}

function mockFetch(statusOverrides: Partial<StatusResponse> = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/health/today")) {
      return new Response(JSON.stringify(PLAN), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/api/health/status")) {
      return new Response(JSON.stringify(statusFixture(statusOverrides)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return Response.error();
  });
}

describe("App — /today route", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, "", "/today");
    vi.stubGlobal("fetch", mockFetch());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders setup screen with session name and START button after fetch", async () => {
    render(<App />);
    expect(await screen.findByText("Strength A")).toBeDefined();
    expect(await screen.findByText("Goblet squat", { exact: false })).toBeDefined();
    expect(await screen.findByRole("button", { name: /start workout/i })).toBeDefined();
  });

  it("redirects to /status when today is already logged", async () => {
    vi.stubGlobal("fetch", mockFetch({
      today_summary: {
        plan_id: 42,
        session_type: "strength_a",
        is_skipped: false,
        is_logged: true,
        exists: true,
      },
    }));
    render(<App />);
    // StatusScreen shows a Last-11-days panel
    expect(await screen.findByText(/last 11 days/i)).toBeDefined();
    expect(window.location.pathname).toBe("/status");
  });

  it("redirects to /status on a rest day", async () => {
    vi.stubGlobal("fetch", mockFetch({
      today_summary: {
        plan_id: 99,
        session_type: "rest_mobility",
        is_skipped: false,
        is_logged: false,
        exists: true,
      },
    }));
    render(<App />);
    expect(await screen.findByText(/last 11 days/i)).toBeDefined();
    expect(window.location.pathname).toBe("/status");
  });
});

describe("App — /status route", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, "", "/status");
    vi.stubGlobal("fetch", mockFetch());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders StatusScreen with phase banner", async () => {
    render(<App />);
    expect(await screen.findByText(/foundation/i)).toBeDefined();
    expect(await screen.findByText(/week 1/i)).toBeDefined();
  });

  it("shows persistent nav with active Status link", async () => {
    render(<App />);
    const links = await screen.findAllByRole("link");
    const statusLink = links.find((l) => /status/i.test(l.textContent ?? ""));
    expect(statusLink).toBeDefined();
    expect(statusLink?.className).toContain("active");
  });
});
