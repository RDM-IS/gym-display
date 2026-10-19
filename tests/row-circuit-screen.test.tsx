// ROW-CIRCUIT screen. Synthetic only (PUBLIC-FIXTURES): 11-13 spm, 20-30 s rows.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import RowCircuitScreen from "../src/screens/RowCircuitScreen";
import { _resetQueueForTests } from "../src/lib/log-queue";
import { pathToRoute, routeToPath } from "../src/lib/routing";

const ROUNDS = [{ round: 1, work_sec: 20, spm: 11 }];
const opt = (lever: string, rs = ROUNDS) => ({ lever, ok: true, reason: null, rounds: rs, row_sec: 20, label: lever });
const RX = {
  available: true, session_type: "row_circuit", display_name: "Row circuit",
  rounds: 1, min_rounds: 1, max_rounds: 8, base: ROUNDS, has_history: true, last_rounds: 1,
  options: {
    rate: opt("rate", [{ round: 1, work_sec: 20, spm: 12 }]),
    time: { ...opt("time", [{ round: 1, work_sec: 80, spm: 11 }]), ok: false, reason: "capped for the test" },
    repeat: opt("repeat"),
  },
  default: "rate", why: "because the test says so",
  rest: { sec: 3, rate: 9 },
  timing: { station_sec: 2, off_rower_sec: 1, between_moves_sec: 1, back_on_rower_sec: 1, cooldown_sec: 2 },
  stations: [[
    { name: "Push-up", format: "reps", duration_sec: 2, cue: "c" },
    { name: "Dead bug", format: "reps", duration_sec: 2, cue: "c" },
    { name: "Side plank", format: "hold", duration_sec: 2, cue: "c" },
  ]],
  last_reps: { "1": { "Push-up": 4 } },
};

type Call = { url: string; body: unknown };

function stub(rx: unknown) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    const payload = String(url).includes("/row-circuit") ? rx : { plan_id: null, adhoc: true, inserted: 1, rows: [] };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  return calls;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); _resetQueueForTests(); });

describe("routing", () => {
  it("has a /row route", () => {
    expect(pathToRoute("/row")).toBe("row");
    expect(routeToPath("row")).toBe("/row");
  });
});

describe("ready screen", () => {
  it("shows both options with the default selected and a capped one disabled", async () => {
    stub(RX);
    render(<RowCircuitScreen />);
    await waitFor(() => expect(screen.getByTestId("rc-ready")).toBeDefined());
    expect(screen.getByTestId("rc-option-rate").getAttribute("aria-checked")).toBe("true");
    expect((screen.getByTestId("rc-option-time") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("capped for the test")).toBeDefined();
    expect(screen.getByTestId("rc-why").textContent).toContain("because the test says so");
  });

  it("an unavailable prescription says why and offers no Start", async () => {
    stub({ available: false, reason: "Couldn't read your last row circuit." });
    render(<RowCircuitScreen />);
    await waitFor(() => expect(screen.getByTestId("rc-unavailable")).toBeDefined());
    expect(screen.queryByTestId("rc-start")).toBeNull();
  });
});

describe("running", () => {
  it("runs to the record card, logs the round on Save, and finishes", async () => {
    const calls = stub(RX);
    render(<RowCircuitScreen />);
    await waitFor(() => expect(screen.getByTestId("rc-start")).toBeDefined());
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date", "performance"] });
    fireEvent.click(screen.getByTestId("rc-start"));
    expect(screen.getByTestId("rc-run")).toBeDefined();
    // get set 10 + row 20 + rest 3 + moves 3 + stations 6 = 42 s to the card
    await act(async () => { vi.advanceTimersByTime(45_000); });
    expect(screen.getByTestId("rc-record")).toBeDefined();
    // Waiting on the card does not advance it.
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(screen.getByTestId("rc-record")).toBeDefined();
    vi.useRealTimers();
    fireEvent.click(screen.getByTestId("rc-save"));
    await waitFor(() => {
      const logs = calls.filter((c) => c.url.includes("/log"));
      expect(logs.length).toBeGreaterThanOrEqual(4);
    });
    const logs = calls.filter((c) => c.url.includes("/log")).map((c) => c.body as Record<string, any>);
    const row = logs.find((b) => b.exercise === "Row")!;
    expect(row.adhoc_session_type).toBe("row_circuit");
    expect(row.sets[0].stroke_rate).toBe(12);
    expect(row.sets[0].started_at).toBeTruthy();
    const push = logs.find((b) => b.exercise === "Push-up")!;
    expect(push.sets[0].reps_done).toBe(4);        // prefilled from last time
  });
});
