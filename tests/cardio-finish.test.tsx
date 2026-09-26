// CARDIO-REQUIRED — a cardio row finishes only with its cardio block.
// Synthetic values only (PUBLIC-FIXTURES): dates in 2027, loads/HR/RPE unused.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import DoneScreen from "../src/screens/DoneScreen";
import LogPanel from "../src/screens/LogPanel";
import {
  cardioFinishBody,
  finishBlocker,
  isCardioPlan,
  prefillMinutes,
  rowCardio,
} from "../src/lib/cardio-finish";
import type { LogExerciseIn, Plan } from "../src/lib/types";
import type { ServerLoggedCount } from "../src/lib/log-state";

const Z2: Plan = {
  plan_id: 9001,
  plan_date: "2027-03-02",
  phase: 1,
  week_num: 3,
  session_type: "cardio_z2",
  target_rpe: 6,
  est_duration_min: 33,
  is_skipped: false,
  blocks: {
    type: "steady",
    display_name: "Zone 2 Cardio",
    duration_min: 33,
    cardio: { modality: "row", device: "water" },
  },
};

const Z2_NO_CARDIO: Plan = {
  ...Z2,
  plan_id: 9002,
  blocks: { type: "steady", display_name: "Zone 2 Cardio", duration_min: 33 },
};

const STRENGTH: Plan = {
  ...Z2,
  plan_id: 9003,
  session_type: "strength_a",
  blocks: { type: "circuit", rounds: 1, exercises: [] },
};

function stubFetch(captured: LogExerciseIn[]) {
  vi.stubGlobal("fetch", vi.fn(async (_i: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      captured.push(JSON.parse(init.body as string) as LogExerciseIn);
      return new Response(JSON.stringify({ plan_id: 9001, inserted: 2, rows: [] }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
    return Response.error();
  }));
}

function renderDone(plan: Plan, opts: { hasSummary?: boolean; server?: ServerLoggedCount } = {}) {
  const onSummaryLogged = vi.fn();
  const onLoggedSet = vi.fn();
  render(
    <DoneScreen
      plan={plan}
      total_elapsed_sec={2000}
      sessionSets={{}}
      serverLoggedCount={opts.server ?? {}}
      lastLogged={{}}
      hasSummary={opts.hasSummary ?? false}
      onLoggedSet={onLoggedSet}
      onSummaryLogged={onSummaryLogged}
      onBack={() => {}}
    />,
  );
  return { onSummaryLogged, onLoggedSet };
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("cardio-finish lib", () => {
  it("knows which rows are cardio", () => {
    expect(isCardioPlan(Z2)).toBe(true);
    expect(isCardioPlan(STRENGTH)).toBe(false);
  });

  it("takes the modality from the row and never guesses", () => {
    expect(rowCardio(Z2)).toEqual({ modality: "row", device: "water" });
    expect(rowCardio(Z2_NO_CARDIO)).toEqual({ modality: null, device: null });
  });

  it("requires minutes and an effort", () => {
    const base = { duration_min: 20, distance_m: null, hr_avg: null, hr_peak: null, rpe: 6, notes: "" };
    expect(finishBlocker(base)).toBeNull();
    expect(finishBlocker({ ...base, duration_min: null })).toMatch(/minutes/i);
    expect(finishBlocker({ ...base, duration_min: 0 })).toMatch(/minutes/i);
    expect(finishBlocker({ ...base, rpe: null })).toMatch(/effort/i);
  });

  it("builds one POST with the summary riding along, or none when one exists", () => {
    const f = { duration_min: 25, distance_m: 5000, hr_avg: null, hr_peak: null, rpe: 6, notes: " ok " };
    const b = cardioFinishBody(Z2, f);
    expect(b.log_type).toBe("cardio_block");
    expect(b.modality).toBe("row");
    expect(b.device).toBe("water");
    expect(b.sets[0].duration_sec).toBe(1500);
    expect(b.session_rpe).toBe(6);
    expect(b.notes).toBe("ok");
    expect(cardioFinishBody(Z2, f, { withSummary: false }).session_rpe).toBeNull();
  });

  it("pre-fills minutes from the timer", () => {
    expect(prefillMinutes(2000)).toBe(33);
    expect(prefillMinutes(20)).toBeNull();
  });
});

describe("DoneScreen on a cardio row", () => {
  let posted: LogExerciseIn[] = [];
  beforeEach(() => { posted = []; stubFetch(posted); });

  it("offers no summary-only finish", () => {
    renderDone(Z2);
    expect(screen.queryByRole("button", { name: /save session summary/i })).toBeNull();
    const btn = screen.getByRole("button", { name: /finish cardio/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);           // minutes pre-filled; effort still owed
    expect(screen.getByText(/pick an effort/i)).toBeDefined();
  });

  it("posts the block with the summary in one request", async () => {
    const { onSummaryLogged, onLoggedSet } = renderDone(Z2);
    fireEvent.click(screen.getByRole("button", { name: /^Effort 6$/ }));
    fireEvent.click(screen.getByRole("button", { name: /finish cardio/i }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].log_type).toBe("cardio_block");
    expect(posted[0].modality).toBe("row");
    expect(posted[0].sets[0].duration_sec).toBe(33 * 60);
    expect(posted[0].session_rpe).toBe(6);
    await waitFor(() => expect(onSummaryLogged).toHaveBeenCalled());
    expect(onLoggedSet).toHaveBeenCalledWith("Zone 2 Cardio", expect.objectContaining({ set_num: 1 }));
  });

  it("still owes the block on a row finished the old way, without a second summary", async () => {
    const { onSummaryLogged } = renderDone(Z2, { hasSummary: true });
    fireEvent.click(screen.getByRole("button", { name: /^Effort 6$/ }));
    fireEvent.click(screen.getByRole("button", { name: /finish cardio/i }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].session_rpe).toBeNull();
    expect(onSummaryLogged).not.toHaveBeenCalled();
  });

  it("falls back to the plain summary once the block is logged", () => {
    renderDone(Z2, { server: { "Zone 2 Cardio": 1 } });
    expect(screen.queryByRole("button", { name: /finish cardio/i })).toBeNull();
    expect(screen.getByRole("button", { name: /save session summary/i })).toBeDefined();
  });

  it("leaves strength rows alone", () => {
    renderDone(STRENGTH);
    expect(screen.queryByRole("button", { name: /finish cardio/i })).toBeNull();
  });
});

describe("LogPanel on a cardio row", () => {
  beforeEach(() => stubFetch([]));

  it("replaces the separate cardio card and summary with the one finish", () => {
    render(
      <LogPanel
        plan={Z2}
        elapsed_sec={1200}
        sessionSets={{}}
        serverLoggedCount={{}}
        lastLogged={{}}
        hasSummary={false}
        onLoggedSet={() => {}}
        onSummaryLogged={() => {}}
        onBackToTimer={() => {}}
        onFinish={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /finish cardio/i })).toBeDefined();
    expect(screen.queryByRole("button", { name: /^log cardio$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /finish workout/i })).toBeNull();
  });
});
