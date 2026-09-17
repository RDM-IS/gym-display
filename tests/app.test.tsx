import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import overview from "./fixtures/overview.json";
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
    if (url.includes("/api/health/overview")) return overviewResponse();
    return Response.error();
  });
}

function overviewResponse(): Response {
  return new Response(JSON.stringify(overview), {
    status: 200,
    headers: { "Content-Type": "application/json" },
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
    expect(await screen.findByRole("heading", { name: "This week" })).toBeDefined();
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
    expect(await screen.findByRole("heading", { name: "This week" })).toBeDefined();
    expect(window.location.pathname).toBe("/status");
  });
});

// ---------------------------------------------------------------------------
// Cardio-steady + mobility regression: with the new block shapes the page
// must not crash. The setup screen must render and show the display_name.
// ---------------------------------------------------------------------------

describe("App — cardio steady plan", () => {
  const STEADY_PLAN: Plan = {
    plan_id: 51,
    plan_date: "2026-06-06",
    phase: 2,
    week_num: 8,
    session_type: "cardio_z2",
    target_rpe: 5.5,
    est_duration_min: 60,
    is_skipped: false,
    blocks: {
      type: "steady",
      display_name: "Long Z2 Bike",
      warmup_sec: 300,
      duration_min: 45,
      cooldown_sec: 300,
      intensity: "Z2 — conversational",
      target_range_min: [40, 50],
    },
  };

  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, "", "/today");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/health/today")) {
          return new Response(JSON.stringify(STEADY_PLAN), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/api/health/status")) {
          return new Response(JSON.stringify(statusFixture({
            today_summary: { plan_id: 51, session_type: "cardio_z2", is_skipped: false, is_logged: false, exists: true },
          })), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/api/health/overview")) return overviewResponse();
        return Response.error();
      })
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders without crashing and shows blocks.display_name as the title", async () => {
    render(<App />);
    expect(await screen.findByText("Long Z2 Bike")).toBeDefined();
    // The Setup screen's START button should be present (no crash)
    expect(await screen.findByRole("button", { name: /start workout/i })).toBeDefined();
  });
});

describe("App — mobility plan is treated as rest day", () => {
  const MOBILITY_PLAN: Plan = {
    plan_id: 60,
    plan_date: "2026-06-07",
    phase: 2,
    week_num: 8,
    session_type: "cardio_z2",      // session_type may not match block type
    target_rpe: 3,
    est_duration_min: 20,
    is_skipped: false,
    blocks: {
      type: "mobility",
      display_name: "Easy Recovery Mobility",
      notes: "Foam roll + T-spine + hip openers",
      duration_min: 20,
    },
  };

  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, "", "/today");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/health/today")) {
          return new Response(JSON.stringify(MOBILITY_PLAN), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/api/health/status")) {
          return new Response(JSON.stringify(statusFixture({
            today_summary: { plan_id: 60, session_type: "cardio_z2", is_skipped: false, is_logged: false, exists: true },
          })), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/api/health/overview")) return overviewResponse();
        return Response.error();
      })
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("redirects mobility days to /status (auto-redirect rule)", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { name: "This week" })).toBeDefined();
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

  it("renders the rebuilt Status page with the program header", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Foundation · Phase 1 · Week 1 of 7" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "This week" })).toBeDefined();
  });

  it("shows persistent nav with active Status link", async () => {
    render(<App />);
    const links = await screen.findAllByRole("link");
    const statusLink = links.find((l) => /status/i.test(l.textContent ?? ""));
    expect(statusLink).toBeDefined();
    expect(statusLink?.className).toContain("active");
  });
});
