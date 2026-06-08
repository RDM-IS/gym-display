import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import LogPanel from "../src/screens/LogPanel";
import { fetchLastLogged, fetchLoggedToday, postLog } from "../src/lib/api";
import type {
  LastLoggedResponse,
  LogExerciseIn,
  LogResponse,
  LoggedTodayResponse,
  Plan,
} from "../src/lib/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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
    intensity: "Z2",
    target_range_min: [40, 50],
  },
};

function mkLoggedFixture(overrides: Partial<LoggedTodayResponse> = {}): LoggedTodayResponse {
  return { plan_id: 42, exercises: [], has_session_summary: false, ...overrides };
}

function mkLastLoggedFixture(by: Record<string, Partial<LastLoggedResponse["by_exercise"][string]>> = {}): LastLoggedResponse {
  const out: LastLoggedResponse["by_exercise"] = {};
  for (const [k, v] of Object.entries(by)) {
    out[k] = {
      exercise: k, plan_date: "2026-05-30",
      weight_lbs: null, reps_done: null, rpe_actual: null,
      duration_sec: null, distance_m: null, hr_avg: null, hr_peak: null,
      ...v,
    };
  }
  return { by_exercise: out };
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

function stubFetch(opts: {
  logged?: LoggedTodayResponse;
  lastLogged?: LastLoggedResponse;
  capture?: LogExerciseIn[];
}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/today/logged")) {
        return new Response(JSON.stringify(opts.logged ?? mkLoggedFixture()), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/last_logged")) {
        return new Response(JSON.stringify(opts.lastLogged ?? { by_exercise: {} }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/api/health/log") && init?.method === "POST") {
        const body = JSON.parse(init.body as string) as LogExerciseIn;
        opts.capture?.push(body);
        return new Response(JSON.stringify(mkLogResponse(body.plan_id ?? 42, body.sets.length)), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }
      return Response.error();
    })
  );
}

// ---------------------------------------------------------------------------
// LogPanel — stepper UX
// ---------------------------------------------------------------------------

describe("LogPanel — stepper UX (circuit plan)", () => {
  let posted: LogExerciseIn[] = [];

  beforeEach(() => {
    posted = [];
    stubFetch({ capture: posted });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders Weight / Reps / RPE steppers for a weighted exercise", async () => {
    render(
      <LogPanel plan={CIRCUIT_PLAN} elapsed_sec={120} onBackToTimer={() => {}} onFinish={() => {}} />
    );
    await screen.findByText("Goblet squat");
    // Each stepper has -, value, + buttons; check labels exist
    expect(screen.getAllByText("Weight").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Reps").length).toBeGreaterThan(0);
    expect(screen.getAllByText("RPE").length).toBeGreaterThan(0);
  });

  it("hides the Weight stepper for bodyweight / duration exercises (Plank)", async () => {
    render(
      <LogPanel plan={CIRCUIT_PLAN} elapsed_sec={120} onBackToTimer={() => {}} onFinish={() => {}} />
    );
    await screen.findByText("Plank");
    // Plank card has Seconds + RPE but NOT Weight
    const plankCard = screen.getByText("Plank").closest(".log-card") as HTMLElement;
    expect(plankCard).toBeTruthy();
    expect(plankCard.textContent).not.toContain("Weight");
    expect(plankCard.textContent).toMatch(/Seconds/);
    expect(plankCard.textContent).toMatch(/RPE/);
  });

  it("+ button on weight bumps by the inferred step (5 for goblet/db)", async () => {
    render(
      <LogPanel plan={CIRCUIT_PLAN} elapsed_sec={120} onBackToTimer={() => {}} onFinish={() => {}} />
    );
    await screen.findByText("Goblet squat");
    const gobletCard = screen.getByText("Goblet squat").closest(".log-card") as HTMLElement;
    const incWeight = gobletCard.querySelector('[aria-label="Increase Weight"]') as HTMLButtonElement;
    fireEvent.click(incWeight);
    // pre-fill from target_load_lbs=35, +5 → 40
    expect(gobletCard.textContent).toContain("40");
  });

  it("default 'simple' multi-set POSTs N copies of the simple triple (3×)", async () => {
    render(
      <LogPanel plan={CIRCUIT_PLAN} elapsed_sec={120} onBackToTimer={() => {}} onFinish={() => {}} />
    );
    await screen.findByText("Goblet squat");
    const gobletCard = screen.getByText("Goblet squat").closest(".log-card") as HTMLElement;
    // Bump RPE up so the post has a non-null value (starts null in simple)
    fireEvent.click(gobletCard.querySelector('[aria-label="Increase RPE"]') as HTMLButtonElement);
    const log = gobletCard.querySelector('[aria-label="Log Goblet squat"]') as HTMLButtonElement;
    fireEvent.click(log);
    await waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const body = posted[0];
    // CIRCUIT_PLAN.rounds = 3, so 3 sets should be sent with the same triple
    expect(body.sets).toHaveLength(3);
    expect(body.sets.every((s) => s.weight_lbs === 35)).toBe(true);
    expect(body.sets.every((s) => s.reps_done === 10)).toBe(true);
    expect(body.sets.every((s) => s.rpe_actual === 7)).toBe(true);
  });

  it("expand toggle reveals per-set steppers (3 set rows for rounds=3)", async () => {
    render(
      <LogPanel plan={CIRCUIT_PLAN} elapsed_sec={120} onBackToTimer={() => {}} onFinish={() => {}} />
    );
    await screen.findByText("Goblet squat");
    const gobletCard = screen.getByText("Goblet squat").closest(".log-card") as HTMLElement;
    const toggle = gobletCard.querySelector(".log-expand-toggle") as HTMLButtonElement;
    fireEvent.click(toggle);
    // After expanding: Set 1 / Set 2 / Set 3 rows are visible
    const setLabels = Array.from(gobletCard.querySelectorAll(".log-per-set-label")).map((e) => e.textContent);
    expect(setLabels).toEqual(["Set 1", "Set 2", "Set 3"]);
  });

  it("pre-fills weight + reps from last-logged when available", async () => {
    stubFetch({
      lastLogged: mkLastLoggedFixture({
        "Goblet squat": { weight_lbs: 45, reps_done: 8 },
      }),
    });
    render(
      <LogPanel plan={CIRCUIT_PLAN} elapsed_sec={120} onBackToTimer={() => {}} onFinish={() => {}} />
    );
    await screen.findByText("Goblet squat");
    const gobletCard = screen.getByText("Goblet squat").closest(".log-card") as HTMLElement;
    // last weight=45 (not 35 from target_load_lbs) and last reps=8
    const values = Array.from(gobletCard.querySelectorAll(".stepper-value")).map((e) => e.textContent);
    expect(values).toContain("45");
    expect(values).toContain("8");
  });

  it("renders ✓ Logged for exercises in today/logged on hydrate", async () => {
    stubFetch({
      logged: mkLoggedFixture({
        exercises: [{ exercise: "Goblet squat", log_type: "strength_set", set_count: 3 }],
      }),
    });
    render(
      <LogPanel plan={CIRCUIT_PLAN} elapsed_sec={120} onBackToTimer={() => {}} onFinish={() => {}} />
    );
    await screen.findByText("Goblet squat");
    const loggedBadge = screen.getAllByRole("button", { name: /Log Goblet squat/i })[0];
    expect(loggedBadge.textContent).toMatch(/Logged ✓/);
  });
});

describe("LogPanel — cardio steady", () => {
  let posted: LogExerciseIn[] = [];

  beforeEach(() => {
    posted = [];
    stubFetch({ capture: posted });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows Duration / Distance / HR avg+peak / RPE steppers and a Log cardio button", async () => {
    render(
      <LogPanel plan={STEADY_PLAN} elapsed_sec={2700} onBackToTimer={() => {}} onFinish={() => {}} />
    );
    expect(await screen.findByText("Cardio block")).toBeDefined();
    expect(screen.getByText("Duration")).toBeDefined();
    expect(screen.getByText("Distance")).toBeDefined();
    expect(screen.getByText("HR avg")).toBeDefined();
    expect(screen.getByText("HR peak")).toBeDefined();
    expect(screen.getByRole("button", { name: /log cardio/i })).toBeDefined();
  });

  it("POSTs a single cardio_block row when Log cardio is tapped", async () => {
    render(
      <LogPanel plan={STEADY_PLAN} elapsed_sec={2700} onBackToTimer={() => {}} onFinish={() => {}} />
    );
    await screen.findByText("Cardio block");
    fireEvent.click(screen.getByRole("button", { name: /log cardio/i }));
    await waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(posted[0].log_type).toBe("cardio_block");
    expect(posted[0].sets).toHaveLength(1);
    // duration auto-filled from elapsed_sec when not bumped
    expect(posted[0].sets[0].duration_sec).toBe(2700);
  });
});

// ---------------------------------------------------------------------------
// API clients
// ---------------------------------------------------------------------------

describe("postLog / fetchLastLogged clients", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("postLog returns ok on 200", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify(mkLogResponse(1, 1)), {
        status: 200, headers: { "Content-Type": "application/json" },
      })
    ));
    const r = await postLog({
      plan_id: 1, exercise: "X", log_type: "strength_set",
      sets: [{ set_num: 1, reps_done: 10, weight_lbs: 35, rpe_actual: 7 }],
    });
    expect(r.status).toBe("ok");
  });

  it("postLog surfaces the API's invalid_log_type detail on 400", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ detail: { error: "invalid_log_type" } }), {
        status: 400, headers: { "Content-Type": "application/json" },
      })
    ));
    const r = await postLog({ log_type: "garbage" as never, sets: [{ set_num: 1 }] });
    expect(r.status).toBe("error");
    if (r.status === "error") expect(r.message).toContain("invalid_log_type");
  });

  it("fetchLastLogged skips the network call when given an empty list", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const r = await fetchLastLogged([]);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.data.by_exercise).toEqual({});
    expect(f).not.toHaveBeenCalled();
  });

  it("fetchLastLogged returns the by_exercise map on 200", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({
        by_exercise: {
          "Goblet squat": { exercise: "Goblet squat", weight_lbs: 35, reps_done: 10, rpe_actual: 7,
                            duration_sec: null, distance_m: null, hr_avg: null, hr_peak: null,
                            plan_date: "2026-06-01" },
        }
      }), { status: 200, headers: { "Content-Type": "application/json" }})
    ));
    const r = await fetchLastLogged(["Goblet squat"]);
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.data.by_exercise["Goblet squat"].weight_lbs).toBe(35);
    }
  });

  it("fetchLoggedToday surfaces the exercise count", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify(mkLoggedFixture({
        exercises: [{ exercise: "Goblet squat", log_type: "strength_set", set_count: 3 }],
      })), { status: 200, headers: { "Content-Type": "application/json" }})
    ));
    const r = await fetchLoggedToday();
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.data.exercises[0].set_count).toBe(3);
  });
});
