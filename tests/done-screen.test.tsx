import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import DoneScreen from "../src/screens/DoneScreen";
import type {
  LastLoggedEntry,
  LogExerciseIn,
  LogResponse,
  Plan,
} from "../src/lib/types";
import type {
  ServerLoggedCount,
  SessionSets,
  SetEntry,
} from "../src/lib/log-state";

const CIRCUIT_PLAN: Plan = {
  plan_id: 70,
  plan_date: "2026-06-08",
  phase: 2,
  week_num: 8,
  session_type: "strength_c",
  target_rpe: 7,
  est_duration_min: 40,
  is_skipped: false,
  blocks: {
    type: "circuit",
    rounds: 3,
    rest_between_rounds_sec: 120,
    exercises: [
      { name: "Goblet squat", format: "reps", target_reps: 10, target_load_lbs: 35, rest_after_sec: 60 },
      { name: "Plank", format: "duration", duration_sec: 30, rest_after_sec: 60 },
    ],
  },
};

function mkLogResponse(): LogResponse {
  return {
    plan_id: 70, inserted: 1,
    rows: [{
      log_id: 1, plan_id: 70, log_type: "strength_set",
      exercise: "X", set_num: 1, reps_done: 10, weight_lbs: 35,
      duration_sec: null, distance_m: null, hr_avg: null, hr_peak: null,
      rpe_actual: 7, notes: null, is_skipped: false,
      logged_at: "2026-06-08T19:00:00Z", logged_via: "manual",
    }],
  };
}

function stubFetch(captured: LogExerciseIn[]) {
  vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      const body = JSON.parse(init.body as string) as LogExerciseIn;
      captured.push(body);
      return new Response(JSON.stringify(mkLogResponse()), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
    return Response.error();
  }));
}

interface DoneOpts {
  sessionSets?: SessionSets;
  serverLoggedCount?: ServerLoggedCount;
  lastLogged?: Record<string, LastLoggedEntry>;
  hasSummary?: boolean;
  onLoggedSet?: (name: string, set: SetEntry) => void;
}

function renderDone(opts: DoneOpts = {}) {
  return render(
    <DoneScreen
      plan={CIRCUIT_PLAN}
      total_elapsed_sec={2400}
      sessionSets={opts.sessionSets ?? {}}
      serverLoggedCount={opts.serverLoggedCount ?? {}}
      lastLogged={opts.lastLogged ?? {}}
      hasSummary={opts.hasSummary ?? false}
      onLoggedSet={opts.onLoggedSet ?? (() => {})}
      onSummaryLogged={() => {}}
      onBack={() => {}}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DoneScreen unlogged-set catch-all", () => {
  let posted: LogExerciseIn[] = [];
  beforeEach(() => { posted = []; stubFetch(posted); });

  it("shows zero unlogged when sessionSets is empty (everything to do)", () => {
    renderDone();
    // 3 rounds × 2 exercises = 6 unlogged sets
    expect(screen.getByText(/6 sets still need to be logged/i)).toBeDefined();
    expect(screen.getAllByTestId("inline-logger")).toHaveLength(6);
  });

  it("trims unlogged set count when sessionSets has entries", () => {
    renderDone({
      sessionSets: {
        "Goblet squat": [
          { set_num: 1, weight_lbs: 35, reps_done: 10, rpe_actual: 7 },
          { set_num: 2, weight_lbs: 40, reps_done: 10, rpe_actual: 8 },
        ],
      },
    });
    // Remaining: Goblet set 3 + Plank sets 1,2,3 = 4
    expect(screen.getByText(/4 sets still need to be logged/i)).toBeDefined();
  });

  it("catches the final-round last-exercise gap (Plank set 3)", () => {
    renderDone({
      sessionSets: {
        "Goblet squat": Array.from({ length: 3 }, (_, i) => ({
          set_num: i + 1, weight_lbs: 35, reps_done: 10, rpe_actual: 7,
        })),
        "Plank": Array.from({ length: 2 }, (_, i) => ({
          set_num: i + 1, weight_lbs: null, reps_done: null, rpe_actual: 7,
        })),
      },
    });
    expect(screen.getByText(/1 set still needs to be logged/i)).toBeDefined();
    expect(screen.getByText(/Plank/i)).toBeDefined();
    expect(screen.getByText(/Set 3 of 3/i)).toBeDefined();
  });

  it("Skip-set button POSTs a single is_skipped=true row with the right set_num", async () => {
    const logged: SetEntry[] = [];
    renderDone({
      sessionSets: {
        "Goblet squat": Array.from({ length: 3 }, (_, i) => ({
          set_num: i + 1, weight_lbs: 35, reps_done: 10, rpe_actual: 7,
        })),
        "Plank": Array.from({ length: 2 }, (_, i) => ({
          set_num: i + 1, weight_lbs: null, reps_done: null, rpe_actual: 7,
        })),
      },
      onLoggedSet: (_, set) => logged.push(set),
    });
    fireEvent.click(screen.getByRole("button", { name: /mark plank set 3 as skipped/i }));
    await waitFor(() => expect(posted.length).toBe(1));
    expect(posted[0].sets[0].is_skipped).toBe(true);
    expect(posted[0].sets[0].set_num).toBe(3);
    expect(posted[0].exercise).toBe("Plank");
    // Parent's sessionSets gets the skip entry so the slot is counted resolved.
    expect(logged).toHaveLength(1);
    expect(logged[0].set_num).toBe(3);
  });

  it("shows 'Almost done' while sets remain; 'Workout Complete' once all logged + summary", () => {
    const all3 = Array.from({ length: 3 }, (_, i) => ({
      set_num: i + 1, weight_lbs: 35, reps_done: 10, rpe_actual: 7,
    }));
    const { rerender } = renderDone({
      sessionSets: { "Goblet squat": all3, "Plank": all3 },
      hasSummary: false,
    });
    expect(screen.getByText("Almost done")).toBeDefined();
    rerender(
      <DoneScreen
        plan={CIRCUIT_PLAN}
        total_elapsed_sec={2400}
        sessionSets={{ "Goblet squat": all3, "Plank": all3 }}
        serverLoggedCount={{}}
        lastLogged={{}}
        hasSummary={true}
        onLoggedSet={() => {}}
        onSummaryLogged={() => {}}
        onBack={() => {}}
      />
    );
    expect(screen.getByText("Workout Complete")).toBeDefined();
  });
});
