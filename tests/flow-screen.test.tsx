import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import FlowScreen from "../src/screens/FlowScreen";
import { speechLog, toneLog } from "../src/lib/audio";
import { _resetQueueForTests } from "../src/lib/log-queue";
import type { LogExerciseIn, Plan } from "../src/lib/types";
import home from "./fixtures/recovery-flow-home.json";

const PLAN = home as unknown as Plan;
const TOTAL_MS = 1770 * 1000;

let posted: LogExerciseIn[] = [];
let visibility: DocumentVisibilityState = "visible";

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"],
  });
  posted = [];
  toneLog.length = 0;
  speechLog.length = 0;
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  _resetQueueForTests();
  vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    posted.push(JSON.parse(init!.body as string) as LogExerciseIn);
    return new Response(JSON.stringify({ plan_id: 106, inserted: 1, rows: [] }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function start() {
  render(<FlowScreen plan={PLAN} />);
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
}

// The full-flow test drives ~700 fake-clock steps; give slow machines room.
describe("FlowScreen — hands-free", { timeout: 120_000 }, () => {
  it("runs start to finish with zero input and logs completion", async () => {
    start();
    expect(screen.getByTestId("flow-name").textContent).toBe("Child's pose");
    expect(screen.getByTestId("flow-round").textContent).toBe("Round 1/2");
    expect(screen.queryByRole("button", { name: /done/i })).toBeNull();
    expect(document.querySelector("input, textarea, select")).toBeNull();

    let sawRound2 = false;
    let switchScreens = 0;
    let wasSwitch = false;
    // 2.5 s steps: every 5 s preview is seen at least once.
    for (let t = 0; t < TOTAL_MS + 2500; t += 2500) {
      await advance(2500);
      if (screen.queryByTestId("flow-round")?.textContent === "Round 2/2") sawRound2 = true;
      const sw = screen.queryByTestId("flow-switch") !== null;
      if (sw && !wasSwitch) switchScreens++;
      wasSwitch = sw;
    }
    expect(sawRound2).toBe(true);
    expect(switchScreens).toBe(10);
    expect(screen.getByTestId("flow-done")).toBeDefined();
    expect(screen.getByTestId("flow-log-status").textContent).toBe("Logged ✓");

    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      plan_id: 106, log_type: "session_summary", exercise: null,
      sets: [{ duration_sec: 1770, notes: "recovery_flow: complete 29 min", is_skipped: false }],
    });
    expect(toneLog.filter((t) => t === "switch")).toHaveLength(10);
    expect(toneLog.filter((t) => t === "round")).toHaveLength(1);
    expect(toneLog.filter((t) => t === "next").length).toBeGreaterThan(20);
    expect(toneLog.at(-1)).toBe("done");
    expect(speechLog).toContain("Supine twist, right side");
    expect(speechLog).toContain("High lunge, left leg forward");
    expect(speechLog.filter((s) => s === "Switch sides")).toHaveLength(10);
  });

  it("shows the switch-sides screen with the next side between R and L", async () => {
    start();
    // Steps 1-4 = 150 s, 5-7 = 90 s → step 7 (extended puppy) ends at 240 s;
    // its last 5 s is the switch to the left-leg lunge.
    await advance(236_000);
    expect(screen.getByTestId("flow-name").textContent).toBe("Extended puppy");
    const sw = screen.getByTestId("flow-switch");
    expect(sw.textContent).toContain("Switch sides");
    expect(sw.textContent).toContain("Left leg forward");
    await advance(5_000);
    expect(screen.queryByTestId("flow-switch")).toBeNull();
    expect(screen.getByTestId("flow-name").textContent).toBe("High lunge");
    expect(screen.getByTestId("flow-side").textContent).toBe("Left leg forward");
  });

  it("backgrounding at 50% logs a partial with minutes done", async () => {
    start();
    await advance(TOTAL_MS / 2);
    visibility = "hidden";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(posted).toHaveLength(1);
    expect(posted[0].sets[0]).toMatchObject({
      duration_sec: 885, notes: "recovery_flow: partial 14 of 30 min",
    });
    expect(screen.getByTestId("flow-paused")).toBeDefined();
    // Hidden time never counts; coming back resumes by itself.
    await advance(120_000);
    visibility = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(screen.queryByTestId("flow-paused")).toBeNull();
    const clock = screen.getByTestId("flow-clock").textContent;
    await advance(2_000);
    expect(screen.getByTestId("flow-clock").textContent).not.toBe(clock);
  });

  it("tap pauses and resumes, keeping the remaining time", async () => {
    start();
    await advance(10_000);
    expect(screen.getByTestId("flow-clock").textContent).toBe("0:20");
    const run = screen.getByTestId("flow-run");
    fireEvent.pointerDown(run, { pointerId: 1, clientX: 300, clientY: 300 });
    fireEvent.pointerUp(run, { pointerId: 1, clientX: 302, clientY: 301 });
    expect(screen.getByTestId("flow-paused")).toBeDefined();
    await advance(90_000);
    expect(screen.getByTestId("flow-clock").textContent).toBe("0:20");
    fireEvent.pointerDown(run, { pointerId: 2, clientX: 300, clientY: 300 });
    fireEvent.pointerUp(run, { pointerId: 2, clientX: 300, clientY: 300 });
    expect(screen.queryByTestId("flow-paused")).toBeNull();
    await advance(5_000);
    expect(screen.getByTestId("flow-clock").textContent).toBe("0:15");
    expect(posted).toHaveLength(0);
  });

  it("an invalid flow refuses to start", () => {
    const bad = JSON.parse(JSON.stringify(PLAN)) as Plan & { blocks: { flow: { step: string }[] } };
    bad.blocks.flow = bad.blocks.flow.filter((s) => s.step !== "14b");
    render(<FlowScreen plan={bad} />);
    expect(screen.getByTestId("flow-invalid").textContent).toContain("twist-seated: missing side R");
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
  });
});
