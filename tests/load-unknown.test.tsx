import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import InlineExerciseLogger from "../src/components/InlineExerciseLogger";
import { _resetQueueForTests } from "../src/lib/log-queue";
import type { LoadConfigByClass, LogExerciseIn, LogResponse, PlannedExercise } from "../src/lib/types";

// LOAD-UNKNOWN-ENTRY (2026-10-27): a reps exercise whose row has no load
// config for its class (msp_home has no recorded inventory) said "log
// manually" and then offered NO weight field, so the set saved weight_lbs
// null. Unknown means "don't guess the steps", never "don't record the load".

const DB_FLY: PlannedExercise = {
  name: "DB fly", format: "reps", target_reps: 25, rest_after_sec: 15,
  equipment_class: "dumbbell",
};

let posted: LogExerciseIn[] = [];

beforeEach(() => {
  posted = [];
  _resetQueueForTests();
  vi.stubGlobal("fetch", vi.fn(async (_i: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      posted.push(JSON.parse(init.body as string) as LogExerciseIn);
      const body: LogResponse = { plan_id: 7, inserted: 1, rows: [] };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return Response.error();
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderLogger(loadConfig: LoadConfigByClass | null) {
  return render(
    <InlineExerciseLogger
      exercise={DB_FLY}
      plan_id={7}
      loadConfig={loadConfig}
      set_num={1}
      total_sets={2}
      prefill={{ weight: null, reps: 25, rpe: null, setup: {} }}
      lastHint={null}
      alreadyFullyLogged={false}
      onLoggedSet={() => {}}
    />,
  );
}

async function typeWeightAndLog(digits: string) {
  fireEvent.click(screen.getByRole("button", { name: /^Weight not set lb, tap to enter$/ }));
  for (const d of digits) fireEvent.click(screen.getByRole("button", { name: `Digit ${d}` }));
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  fireEvent.click(screen.getByRole("button", { name: "Log DB fly set 1" }));
  await waitFor(() => expect(posted).toHaveLength(1));
}

describe("unknown load still records a weight", () => {
  it("no config on the row → message AND a weight field", async () => {
    renderLogger(null);
    expect(screen.getByTestId("load-unknown")).toBeTruthy();
    await typeWeightAndLog("15");
    expect(posted[0].sets[0]).toMatchObject({ weight_lbs: 15, reps_done: 25 });
  });

  it("a config without the class → same, and no snapping to anyone's steps", async () => {
    renderLogger({ bodyweight: { mode: "none" } });
    await typeWeightAndLog("17");
    expect(posted[0].sets[0].weight_lbs).toBe(17);
  });

  it("a known no-load class still shows no weight field", () => {
    render(
      <InlineExerciseLogger
        exercise={{ ...DB_FLY, name: "Push-up", equipment_class: "bodyweight" }}
        plan_id={7} loadConfig={{ bodyweight: { mode: "none" } }} set_num={1} total_sets={2}
        prefill={{ weight: null, reps: 10, rpe: null, setup: {} }} lastHint={null}
        alreadyFullyLogged={false} onLoggedSet={() => {}}
      />,
    );
    expect(screen.queryByTestId("load-unknown")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Weight / })).toBeNull();
  });
});
