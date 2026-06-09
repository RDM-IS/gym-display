import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import LogPanel from "../src/screens/LogPanel";
import type {
  LogExerciseIn,
  LogResponse,
  Plan,
} from "../src/lib/types";
import type { SessionSets, SetEntry } from "../src/lib/log-state";

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
  },
};

function mkLogResponse(): LogResponse {
  return {
    plan_id: 42,
    inserted: 1,
    rows: [{
      log_id: 100,
      plan_id: 42,
      log_type: "strength_set",
      exercise: "X",
      set_num: 1,
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
    }],
  };
}

function stubFetch(captured?: LogExerciseIn[]) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/health/log") && init?.method === "POST") {
      const body = JSON.parse(init.body as string) as LogExerciseIn;
      captured?.push(body);
      return new Response(JSON.stringify(mkLogResponse()), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
    return Response.error();
  }));
}

interface RenderOpts {
  plan?: Plan;
  sessionSets?: SessionSets;
  serverLoggedCount?: Record<string, number>;
  lastLogged?: Record<string, never>;
  onLoggedSet?: (name: string, set: SetEntry) => void;
  hasSummary?: boolean;
}

function renderLogPanel(opts: RenderOpts = {}) {
  return render(
    <LogPanel
      plan={opts.plan ?? CIRCUIT_PLAN}
      elapsed_sec={120}
      sessionSets={opts.sessionSets ?? {}}
      serverLoggedCount={opts.serverLoggedCount ?? {}}
      lastLogged={opts.lastLogged ?? {}}
      hasSummary={opts.hasSummary ?? false}
      onLoggedSet={opts.onLoggedSet ?? (() => {})}
      onSummaryLogged={() => {}}
      onBackToTimer={() => {}}
      onFinish={() => {}}
    />
  );
}

// ---------------------------------------------------------------------------
// LogPanel — per-set behaviour
// ---------------------------------------------------------------------------

describe("LogPanel — per-set logging", () => {
  let posted: LogExerciseIn[] = [];

  beforeEach(() => {
    posted = [];
    stubFetch(posted);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders one InlineExerciseLogger per main exercise with 'Set 1 of 3'", () => {
    renderLogPanel();
    // Two exercises in CIRCUIT_PLAN.blocks.exercises
    const cards = screen.getAllByTestId("inline-logger");
    expect(cards).toHaveLength(2);
    // Each card's header reads "Set 1 of 3"
    const headers = Array.from(document.querySelectorAll(".log-card-target")).map((e) => e.textContent);
    expect(headers.some((h) => h?.includes("Set 1 of 3"))).toBe(true);
  });

  it("starts each exercise card at set_num 1 + advances based on sessionSets length", () => {
    renderLogPanel({
      sessionSets: {
        "Goblet squat": [
          { set_num: 1, weight_lbs: 35, reps_done: 10, rpe_actual: 7 },
          { set_num: 2, weight_lbs: 40, reps_done: 10, rpe_actual: 8 },
        ],
      },
    });
    const gobletCard = screen.getByText("Goblet squat").closest(".log-card") as HTMLElement;
    expect(gobletCard.textContent).toContain("Set 3 of 3");
    // Plank is still on set 1
    const plankCard = screen.getByText("Plank").closest(".log-card") as HTMLElement;
    expect(plankCard.textContent).toContain("Set 1 of 3");
  });

  it("tap on Log posts exactly ONE set, not N copies", async () => {
    renderLogPanel();
    const gobletCard = screen.getByText("Goblet squat").closest(".log-card") as HTMLElement;
    // RPE starts null in the form; one tap on + brings it to blankStart 7.
    fireEvent.click(gobletCard.querySelector('[aria-label="Increase RPE"]') as HTMLButtonElement);
    fireEvent.click(gobletCard.querySelector('[aria-label="Log Goblet squat set 1"]') as HTMLButtonElement);
    await waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const body = posted[0];
    expect(body.sets).toHaveLength(1);
    expect(body.sets[0].set_num).toBe(1);
    expect(body.sets[0].weight_lbs).toBe(35);
    expect(body.sets[0].reps_done).toBe(10);
    expect(body.sets[0].rpe_actual).toBe(7);
  });

  it("renders 'Logged so far: 2 of 3' progress text when partially complete", () => {
    renderLogPanel({
      sessionSets: {
        "Goblet squat": [
          { set_num: 1, weight_lbs: 35, reps_done: 10, rpe_actual: 7 },
          { set_num: 2, weight_lbs: 35, reps_done: 10, rpe_actual: 8 },
        ],
      },
    });
    expect(screen.getByText(/Logged so far: 2 of 3/i)).toBeDefined();
  });

  it("shows fully ✓ Logged when all N sets are recorded", () => {
    renderLogPanel({
      sessionSets: {
        "Goblet squat": Array.from({ length: 3 }, (_, i) => ({
          set_num: i + 1, weight_lbs: 35, reps_done: 10, rpe_actual: 7,
        })),
      },
    });
    const gobletCard = screen.getByText("Goblet squat").closest(".log-card") as HTMLElement;
    expect(gobletCard.textContent).toMatch(/Logged ✓/);
  });

  it("button label format is 'Log set N: …', NOT 'Log 3 ×'", async () => {
    renderLogPanel();
    const gobletCard = screen.getByText("Goblet squat").closest(".log-card") as HTMLElement;
    const btn = gobletCard.querySelector('[aria-label="Log Goblet squat set 1"]') as HTMLButtonElement;
    expect(btn.textContent).toMatch(/^Log set 1:/);
    expect(btn.textContent).not.toMatch(/3 ×/);
  });

  it("calls onLoggedSet(name, {set_num, weight_lbs, reps_done, rpe_actual}) on success", async () => {
    const logged: Array<{ name: string; set: SetEntry }> = [];
    renderLogPanel({
      onLoggedSet: (name, set) => logged.push({ name, set }),
    });
    const gobletCard = screen.getByText("Goblet squat").closest(".log-card") as HTMLElement;
    fireEvent.click(gobletCard.querySelector('[aria-label="Increase RPE"]') as HTMLButtonElement);
    fireEvent.click(gobletCard.querySelector('[aria-label="Log Goblet squat set 1"]') as HTMLButtonElement);
    await waitFor(() => expect(logged.length).toBe(1));
    expect(logged[0].name).toBe("Goblet squat");
    expect(logged[0].set.set_num).toBe(1);
    expect(logged[0].set.weight_lbs).toBe(35);
    expect(logged[0].set.reps_done).toBe(10);
    expect(logged[0].set.rpe_actual).toBe(7);
  });

  it("set 2 PREFILLS from set 1's actual values (divergence-friendly)", () => {
    renderLogPanel({
      sessionSets: {
        "Goblet squat": [
          { set_num: 1, weight_lbs: 30, reps_done: 12, rpe_actual: 8 },
        ],
      },
    });
    const gobletCard = screen.getByText("Goblet squat").closest(".log-card") as HTMLElement;
    const values = Array.from(gobletCard.querySelectorAll(".stepper-value")).map((e) => e.textContent);
    // weight=30 + reps=12 + rpe=8 carry from set 1's actuals (NOT 35 / 10 / null target).
    expect(values).toContain("30");
    expect(values).toContain("12");
    expect(values).toContain("8");
  });
});
