import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import FlowScreen from "../src/screens/FlowScreen";
import { speechLog, toneLog } from "../src/lib/audio";
import { buildFlowTimeline } from "../src/lib/flow";
import { _resetQueueForTests } from "../src/lib/log-queue";
import type { LogExerciseIn, Plan } from "../src/lib/types";
import home from "./fixtures/recovery-flow-home.json";

const PLAN = home as unknown as Plan;
const TOTAL_MS = 1980 * 1000;
const ITEMS = buildFlowTimeline(PLAN.blocks as never);

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

/** A fake speechSynthesis: records every utterance and flags one that
 * starts while another is still being spoken (utterances never end on
 * their own here, so only cancel() stops one). */
function fakeSpeech() {
  const said: string[] = [];
  let speaking = false;
  let overlaps = 0;
  vi.stubGlobal("SpeechSynthesisUtterance", class { text: string; rate = 1; volume = 1;
    constructor(t: string) { this.text = t; } });
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    value: {
      speak(u: { text: string }) {
        if (u.text.trim() === "") return;          // the unlock utterance
        if (speaking) overlaps++;
        speaking = true;
        said.push(u.text);
      },
      cancel() { speaking = false; },
    },
  });
  return { said, overlaps: () => overlaps };
}

afterEach(() => {
  delete (window as { speechSynthesis?: unknown }).speechSynthesis;
});

// The full-flow test drives ~800 fake-clock steps; give slow machines room.
describe("FlowScreen — hands-free", { timeout: 120_000 }, () => {
  it("runs start to finish with zero input and logs completion", async () => {
    start();
    expect(screen.getByTestId("flow-name").textContent).toBe("Seated meditation");
    expect(screen.getByTestId("flow-round").textContent).toBe("Before round 1");
    expect(screen.queryByRole("button", { name: /done/i })).toBeNull();
    expect(document.querySelector("input, textarea, select")).toBeNull();

    let sawRound2 = false;
    let switchScreens = 0;
    let wasSwitch = false;
    let nextMissing = 0;
    // 2.5 s steps: every 3 s transition is seen at least once.
    for (let t = 0; t < TOTAL_MS + 2500; t += 2500) {
      await advance(2500);
      if (screen.queryByTestId("flow-done")) break;
      if (screen.queryByTestId("flow-round")?.textContent === "Round 2/2") sawRound2 = true;
      if (!screen.queryByTestId("flow-next")) nextMissing++;
      const sw = screen.queryByTestId("flow-switch") !== null;
      if (sw && !wasSwitch) switchScreens++;
      wasSwitch = sw;
    }
    expect(sawRound2).toBe(true);
    expect(nextMissing).toBe(0);                     // the Next strip never left
    expect(switchScreens).toBe(10);
    expect(screen.getByTestId("flow-done")).toBeDefined();
    expect(screen.getByTestId("flow-log-status").textContent).toBe("Logged ✓");

    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      plan_id: 106, log_type: "session_summary", exercise: null,
      sets: [{ duration_sec: 1980, notes: "recovery_flow: complete 33 min", is_skipped: false }],
    });
    const n = (k: string) => toneLog.filter((t) => t === k).length;
    expect(n("switch")).toBe(10);
    expect(n("round")).toBe(1);
    expect(n("next")).toBe(ITEMS.length - 1 - 10 - 1);
    expect(n("start")).toBe(ITEMS.length);           // every hold starts on its tone
    expect(n("move")).toBe(ITEMS.length - 1);        // no speech here → tones mark the move
    expect(toneLog.at(-1)).toBe("done");
  });

  it("speaks the lead-in then the move cue for every pose, one utterance at a time", async () => {
    const speech = fakeSpeech();
    start();
    for (let t = 0; t < TOTAL_MS + 1000; t += 1000) await advance(1000);
    expect(screen.getByTestId("flow-done")).toBeDefined();
    const expected = [ITEMS[0].leadIn];
    for (const it of ITEMS.slice(1)) expected.push(it.leadIn, it.moveCue);
    expected.push("Flow complete");
    expect(speech.said).toEqual(expected);
    expect(speech.overlaps()).toBe(0);
    expect(speech.said).toContain("Next, supine twist, left side, for 30 seconds.");
    expect(speech.said).toContain("Next we'll move into downward facing dog for 60 seconds.");
    expect(speech.said).toContain("High lunge, left leg forward.");
    expect(toneLog).not.toContain("move");           // speech carries the move point
  });

  it("lead-in at 3 s, move cue at 0, hold timer only after the transition", async () => {
    fakeSpeech();
    start();
    // Start: the lead-in, then "Move into position" for 5 s with the seconds counting.
    expect(speechLog).toEqual(["We'll begin with seated meditation for 60 seconds."]);
    expect(screen.getByTestId("flow-run").dataset.stage).toBe("transition");
    expect(screen.getByTestId("flow-move").textContent).toBe("Move into position");
    expect(screen.getByTestId("flow-clock").textContent).toBe("5");
    expect(screen.getByTestId("flow-next-title").textContent).toBe("Next: Child's pose");
    await advance(3_000);
    expect(screen.getByTestId("flow-clock").textContent).toBe("2");
    await advance(2_000);
    expect(screen.getByTestId("flow-run").dataset.stage).toBe("hold");
    expect(screen.queryByTestId("flow-move")).toBeNull();
    expect(screen.getByTestId("flow-clock").textContent).toBe("1:00");
    expect(toneLog).toEqual(["start"]);
    // 3 s before the hold ends: chime, then the words.
    await advance(56_000);                             // 0:04 left
    expect(speechLog).toHaveLength(1);
    await advance(1_000);                              // 0:03 left
    expect(toneLog.at(-1)).toBe("next");
    expect(speechLog.at(-1)).toBe("Next we'll move into child's pose for 30 seconds.");
    expect(speechLog.filter((x) => x.startsWith("Next we'll move into child's"))).toHaveLength(1);
    await advance(3_000);                              // 0 → the move cue
    expect(speechLog.at(-1)).toBe("Child's pose.");
    expect(screen.getByTestId("flow-name").textContent).toBe("Child's pose");
    expect(screen.getByTestId("flow-move")).toBeDefined();
    expect(screen.getByTestId("flow-clock").textContent).toBe("3");   // seated → kneeling: short
    expect(screen.getByTestId("flow-next-title").textContent).toBe("Next: Cobra");
  });

  it("shows the switch-sides screen with the side and the move countdown", async () => {
    start();
    // meditation 65 · child's 33 · cobra 33 · dog 63 · fold 35 · lunge R 33 ·
    // crescent R 33 · puppy 35 → the left-leg lunge's 5 s transition at 330 s.
    await advance(331_000);
    const sw = screen.getByTestId("flow-switch");
    expect(sw.textContent).toContain("Switch sides");
    expect(sw.textContent).toContain("High lunge · Left leg forward");
    expect(sw.textContent).toContain("Move into position");
    expect(speechLog.slice(-2)).toEqual(["Next, high lunge, left leg forward, for 30 seconds.",
                                         "High lunge, left leg forward."]);
    expect(toneLog.filter((t) => t === "switch")).toHaveLength(1);
    await advance(5_000);
    expect(screen.queryByTestId("flow-switch")).toBeNull();
    expect(screen.getByTestId("flow-name").textContent).toBe("High lunge");
    expect(screen.getByTestId("flow-side").textContent).toBe("Left leg forward");
    expect(screen.getByTestId("flow-clock").textContent).toBe("0:29");
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
      duration_sec: 990, notes: "recovery_flow: partial 16 of 33 min",
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

  function tap(id: number) {
    const run = screen.getByTestId("flow-run");
    fireEvent.pointerDown(run, { pointerId: id, clientX: 300, clientY: 300 });
    fireEvent.pointerUp(run, { pointerId: id, clientX: 302, clientY: 301 });
  }

  it("tap pauses and resumes a hold, keeping the remaining time", async () => {
    start();
    await advance(10_000);                            // 5 s transition + 5 s of the hold
    expect(screen.getByTestId("flow-clock").textContent).toBe("0:55");
    tap(1);
    expect(screen.getByTestId("flow-paused")).toBeDefined();
    await advance(90_000);
    expect(screen.getByTestId("flow-clock").textContent).toBe("0:55");
    tap(2);
    expect(screen.queryByTestId("flow-paused")).toBeNull();
    await advance(5_000);
    expect(screen.getByTestId("flow-clock").textContent).toBe("0:50");
    expect(posted).toHaveLength(0);
  });

  it("pause covers transitions too", async () => {
    start();
    await advance(2_000);
    expect(screen.getByTestId("flow-clock").textContent).toBe("3");
    tap(1);
    await advance(30_000);
    expect(screen.getByTestId("flow-clock").textContent).toBe("3");
    expect(screen.getByTestId("flow-run").dataset.stage).toBe("transition");
    expect(toneLog).not.toContain("start");
    tap(2);
    await advance(3_000);
    expect(screen.getByTestId("flow-run").dataset.stage).toBe("hold");
    expect(toneLog).toEqual(["start"]);
  });

  it("an invalid flow refuses to start", () => {
    const bad = JSON.parse(JSON.stringify(PLAN)) as Plan & { blocks: { flow: { step: string }[] } };
    bad.blocks.flow = bad.blocks.flow.filter((s) => s.step !== "14b");
    render(<FlowScreen plan={bad} />);
    expect(screen.getByTestId("flow-invalid").textContent).toContain("twist-seated: missing side R");
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
  });
});
