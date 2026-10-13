import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import type { Plan, StatusResponse } from "../src/lib/types";

// GD-RESUME end to end: a reload mid-workout, with two sets of the first
// exercise already on the server. Synthetic names and values (PUBLIC-FIXTURES).

const PLAN: Plan = {
  plan_id: 9001,
  plan_date: "2030-01-07",
  phase: 2,
  week_num: 8,
  session_type: "strength_c",
  target_rpe: 7,
  est_duration_min: 45,
  is_skipped: false,
  blocks: {
    type: "circuit",
    rounds: 3,
    rest_between_rounds_sec: 120,
    exercises: [
      { name: "Alpha press", format: "reps", target_reps: 10, rest_after_sec: 60 },
      { name: "Bravo row", format: "reps", target_reps: 10, rest_after_sec: 60 },
    ],
  },
};

function status(): StatusResponse {
  return {
    today: "2030-01-07", window_start: "2030-01-02", window_end: "2030-01-12",
    today_summary: { plan_id: 9001, session_type: "strength_c", is_skipped: false, is_logged: false, exists: true },
    banner: { phase: 2, week_num: 8, phase_name: "Build", as_of_date: "2030-01-07" },
    day_strip: [], most_recent_session: null, same_type_history: [], rpe_trend: [], weight_trend: [],
  };
}
const json = (b: unknown) =>
  new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });

describe("GD-RESUME: a reloaded workout picks up where it left off", () => {
  let logged: { exercise: string; set_count: number }[];

  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, "", "/today");
    logged = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/health/today/logged")) {
        return json({ plan_id: 9001, has_session_summary: false, exercises: logged });
      }
      if (url.includes("/api/health/today")) return json(PLAN);
      if (url.includes("/api/health/status")) return json(status());
      if (url.includes("/api/health/last_logged")) return json({ by_exercise: {} });
      if (url.includes("/api/health/sessions")) return json({ days: [] });
      return json({});
    }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  async function start() {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /start workout/i }));
    for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); });
  }

  it("2 sets of the first exercise logged → opens on the second exercise, Set 1 of 3", async () => {
    logged = [{ exercise: "Alpha press", set_count: 2 }];
    await start();
    expect(screen.getByText("Bravo row", { selector: ".glance-name" })).toBeTruthy();
    expect(screen.getByText("Set 1 of 3")).toBeTruthy();
    expect(screen.queryByText("Set 3 of 3")).toBeNull();
  });

  it("nothing logged → starts at the top as before", async () => {
    await start();
    expect(screen.getByText("Alpha press", { selector: ".glance-name" })).toBeTruthy();
    expect(screen.getByText("Set 1 of 3")).toBeTruthy();
  });
});
