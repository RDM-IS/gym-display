import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import LogPanel from "../src/screens/LogPanel";
import { fetchLoggedToday, postLog } from "../src/lib/api";
import type {
  LogExerciseIn,
  LogResponse,
  LoggedTodayResponse,
  Plan,
} from "../src/lib/types";

const CIRCUIT_PLAN: Plan = {
  plan_id: 42,
  plan_date: "2026-06-08",
  phase: 2,
  week_num: 8,
  session_type: "strength_a",
  target_rpe: 7,
  est_duration_min: 40,
  is_skipped: false,
  blocks: {
    type: "circuit",
    display_name: "Full Body Strength A",
    warmup: "5 min easy",
    rounds: 3,
    rest_between_rounds_sec: 120,
    exercises: [
      { name: "Goblet squat", format: "reps", target_reps: 10, target_load_lbs: 35, rest_after_sec: 60 },
      { name: "Plank", format: "duration", duration_sec: 30, rest_after_sec: 60 },
    ],
    cooldown: "5 min easy",
    finisher: {
      type: "core_circuit",
      rounds: 2,
      exercises: [
        { name: "Dead bug", format: "reps", target_reps: 10 },
        { name: "Hollow hold", format: "duration", duration_sec: 20 },
      ],
    },
  },
};

const STEADY_PLAN: Plan = {
  plan_id: 51,
  plan_date: "2026-06-06",
  phase: 2,
  week_num: 8,
  session_type: "cardio_z2",
  target_rpe: 5,
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

function mkLoggedFixture(overrides: Partial<LoggedTodayResponse> = {}): LoggedTodayResponse {
  return {
    plan_id: 42,
    exercises: [],
    has_session_summary: false,
    ...overrides,
  };
}

function mkLogResponse(plan_id: number, n: number): LogResponse {
  return {
    plan_id,
    inserted: n,
    rows: Array.from({ length: n }, (_, i) => ({
      log_id: 100 + i,
      plan_id,
      log_type: "strength_set",
      exercise: "X",
      set_num: i + 1,
      reps_done: 10,
      weight_lbs: 35,
      duration_sec: null,
      distance_m: null,
      hr_avg: null,
      hr_peak: null,
      rpe_actual: 7,
      notes: null,
      is_skipped: false,
      logged_at: "2026-06-08T19:00:00Z",
      logged_via: "manual",
    })),
  };
}

describe("LogPanel — circuit plan", () => {
  let posted: LogExerciseIn[] = [];

  beforeEach(() => {
    posted = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/health/today/logged")) {
          return new Response(JSON.stringify(mkLoggedFixture()), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/api/health/log") && init?.method === "POST") {
          const body = JSON.parse(init.body as string) as LogExerciseIn;
          posted.push(body);
          return new Response(
            JSON.stringify(mkLogResponse(body.plan_id ?? 42, body.sets.length)),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return Response.error();
      })
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders one per-set input row per round (rounds = sets)", async () => {
    render(
      <LogPanel plan={CIRCUIT_PLAN} elapsed_sec={120} onBackToTimer={() => {}} onFinish={() => {}} />
    );
    // Wait for the hydrate to complete
    await screen.findByText("Goblet squat");
    // Goblet squat with rounds=3 → 3 set rows labelled Set 1 / Set 2 / Set 3
    const setLabels = screen.getAllByText(/^Set \d+/);
    // Goblet squat (3) + Plank (3) + Dead bug (2) + Hollow hold (2) = 10 set rows
    expect(setLabels).toHaveLength(10);
  });

  it("pre-stubs weight + reps from target_load_lbs / target_reps", async () => {
    render(
      <LogPanel plan={CIRCUIT_PLAN} elapsed_sec={120} onBackToTimer={() => {}} onFinish={() => {}} />
    );
    await screen.findByText("Goblet squat");
    const repsInputs = screen.getAllByDisplayValue("10");
    expect(repsInputs.length).toBeGreaterThan(0);
    const lbInputs = screen.getAllByDisplayValue("35");
    expect(lbInputs.length).toBeGreaterThan(0);
  });

  it("POSTs the exercise's sets when Log exercise is tapped", async () => {
    render(
      <LogPanel plan={CIRCUIT_PLAN} elapsed_sec={120} onBackToTimer={() => {}} onFinish={() => {}} />
    );
    await screen.findByText("Goblet squat");
    const buttons = screen.getAllByRole("button", { name: /log exercise/i });
    fireEvent.click(buttons[0]); // Goblet squat
    await waitFor(() => {
      expect(posted.length).toBeGreaterThan(0);
    });
    const body = posted[0];
    expect(body.plan_id).toBe(42);
    expect(body.exercise).toBe("Goblet squat");
    expect(body.log_type).toBe("strength_set");
    expect(body.sets).toHaveLength(3);
    expect(body.sets[0].set_num).toBe(1);
  });

  it("hydrates server-logged exercises as ✓ done on load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/today/logged")) {
          return new Response(
            JSON.stringify(mkLoggedFixture({
              exercises: [{ exercise: "Goblet squat", log_type: "strength_set", set_count: 3 }],
            })),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return Response.error();
      })
    );
    render(
      <LogPanel plan={CIRCUIT_PLAN} elapsed_sec={120} onBackToTimer={() => {}} onFinish={() => {}} />
    );
    // The Goblet squat exercise card should show ✓ Logged
    const loggedBadges = await screen.findAllByRole("button", { name: /logged ✓/i });
    expect(loggedBadges.length).toBeGreaterThan(0);
  });

  it("posts session_summary when Finish workout is tapped", async () => {
    let finished = false;
    render(
      <LogPanel
        plan={CIRCUIT_PLAN}
        elapsed_sec={120}
        onBackToTimer={() => {}}
        onFinish={() => { finished = true; }}
      />
    );
    await screen.findByText("Goblet squat");
    const finish = await screen.findByRole("button", { name: /finish workout/i });
    fireEvent.click(finish);
    await waitFor(() => {
      const summaryPost = posted.find((p) => p.log_type === "session_summary");
      expect(summaryPost).toBeDefined();
    });
    expect(finished).toBe(true);
  });
});

describe("LogPanel — cardio steady", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/today/logged")) {
          return new Response(JSON.stringify(mkLoggedFixture({ plan_id: 51 })), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/api/health/log") && init?.method === "POST") {
          const body = JSON.parse(init.body as string) as LogExerciseIn;
          return new Response(
            JSON.stringify(mkLogResponse(body.plan_id ?? 51, body.sets.length)),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return Response.error();
      })
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows duration / distance / HR fields and a Log cardio button", async () => {
    render(
      <LogPanel plan={STEADY_PLAN} elapsed_sec={2700} onBackToTimer={() => {}} onFinish={() => {}} />
    );
    expect(await screen.findByText(/cardio block/i)).toBeDefined();
    expect(screen.getByRole("button", { name: /log cardio/i })).toBeDefined();
    expect(screen.getByDisplayValue("2700")).toBeDefined();
  });
});

// Direct API smoke tests (no React) ------------------------------------------

describe("postLog client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends JSON body with the right shape and the application/json content-type", async () => {
    const captured: { headers: Record<string, string>; body: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const h: Record<string, string> = {};
        new Headers(init?.headers).forEach((v, k) => { h[k] = v; });
        captured.push({ headers: h, body: init?.body as string });
        return new Response(JSON.stringify(mkLogResponse(1, 1)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      })
    );
    const r = await postLog({
      plan_id: 1, exercise: "X", log_type: "strength_set",
      sets: [{ set_num: 1, reps_done: 10, weight_lbs: 35, rpe_actual: 7 }],
    });
    expect(r.status).toBe("ok");
    expect(captured[0].headers["content-type"]).toContain("application/json");
    const parsed = JSON.parse(captured[0].body);
    expect(parsed.exercise).toBe("X");
  });

  it("returns error status with HTTP detail on non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ detail: { error: "invalid_log_type" } }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        })
      )
    );
    const r = await postLog({
      log_type: "garbage" as never,
      sets: [{ set_num: 1 }],
    });
    expect(r.status).toBe("error");
    if (r.status === "error") {
      expect(r.message).toContain("invalid_log_type");
    }
  });
});

describe("fetchLoggedToday client", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("returns ok with the logged exercises list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(mkLoggedFixture({
          exercises: [{ exercise: "Goblet squat", log_type: "strength_set", set_count: 3 }],
        })), { status: 200, headers: { "Content-Type": "application/json" } })
      )
    );
    const r = await fetchLoggedToday();
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.data.exercises).toHaveLength(1);
    }
  });
});
