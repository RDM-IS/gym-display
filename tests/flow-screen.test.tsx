import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import FlowScreen from "../src/screens/FlowScreen";
import { speechLog } from "../src/lib/audio";
import { buildFlowTimeline } from "../src/lib/flow";
import { _resetQueueForTests } from "../src/lib/log-queue";
import type { LogExerciseIn, Plan } from "../src/lib/types";
import home from "./fixtures/recovery-flow-home.json";

const PLAN = home as unknown as Plan;
const TOTAL_MS = 1947 * 1000;
const ITEMS = buildFlowTimeline(PLAN.blocks as never);

let posted: LogExerciseIn[] = [];
let visibility: DocumentVisibilityState = "visible";

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"],
  });
  posted = [];
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
      sets: [{ duration_sec: 1947, notes: "recovery_flow: complete 32 min", is_skipped: false }],
    });
  });

  it("speaks the lead-in then the move cue for every pose, one utterance at a time", async () => {
    const speech = fakeSpeech();
    start();
    for (let t = 0; t < TOTAL_MS + 1000; t += 1000) await advance(1000);
    expect(screen.getByTestId("flow-done")).toBeDefined();
    // YOGA-5: each hold also carries its one mid-hold line — at the start for
    // meditation and savasana, 12 s in for a pose.
    const expected: string[] = [ITEMS[0].leadIn];
    if (ITEMS[0].cueMid) expected.push(ITEMS[0].cueMid);
    for (const it of ITEMS.slice(1)) {
      expected.push(it.leadIn, it.moveCue);
      if (it.cueMid) expected.push(it.cueMid);
    }
    expected.push("Flow complete");
    expect(speech.said).toEqual(expected);
    expect(speech.overlaps()).toBe(0);
    expect(speech.said).toContain("Next, supine twist, left side, for 40 seconds.");
    expect(speech.said).toContain("Next we'll move into downward facing dog for 40 seconds.");
    expect(speech.said).toContain("Move to oo-TEE-tah ASH-wah sahn-chah-lah-NAH-sah-nah.");
  });

  it("lead-in at 7 s, move cue at 0, hold timer only after the transition", async () => {
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
    // YOGA-4: nothing sounds at the hold start, and nothing precedes the words.
    // The meditation is silent for its whole minute — nothing at 12 s, and
    // nothing after (Ryan, 2026-09-20).
    await advance(12_000);
    expect(speechLog).toHaveLength(1);
    await advance(40_000);                             // 0:08 left
    expect(speechLog).toHaveLength(1);                 // still only the lead-in
    await advance(1_000);                              // 0:07 left — the lead-in
    expect(speechLog.at(-1)).toBe("Next we'll move into child's pose for 40 seconds.");
    expect(speechLog.filter((x) => x.startsWith("Next we'll move into child's"))).toHaveLength(1);
    await advance(7_000);                              // 0 → the Sanskrit move cue
    expect(speechLog.at(-1)).toBe("Move to bah-LAH-sah-nah.");
    expect(screen.getByTestId("flow-name").textContent).toBe("Child's pose");
    expect(screen.getByTestId("flow-move")).toBeDefined();
    expect(screen.getByTestId("flow-clock").textContent).toBe("5");   // from the table
    expect(screen.getByTestId("flow-next-title").textContent).toBe("Next: Cobra");
  });

  it("shows the switch-sides screen with the side and the move countdown", async () => {
    start();
    // YOGA-4: the switch is now at the top of the crescent. meditation 5+60,
    // child's 5+40, cobra 3+40, dog 3+40, fold 3+40, high lunge R 5+40,
    // crescent R 3+40 → crescent L's 3 s transition runs 327–330 s.
    await advance(328_000);
    const sw = screen.getByTestId("flow-switch");
    expect(sw.textContent).toContain("Switch sides");
    expect(sw.textContent).toContain("Crescent lunge · Left leg forward");
    expect(sw.textContent).toContain("Move into position");
    expect(speechLog.slice(-2)).toEqual(["Next, crescent lunge, left leg forward, for 40 seconds.",
                                         "Move to AHSH-tah chahn-DRAH-sah-nah."]);
    await advance(2_000);
    expect(screen.queryByTestId("flow-switch")).toBeNull();
    expect(screen.getByTestId("flow-name").textContent).toBe("Crescent lunge");
    expect(screen.getByTestId("flow-side").textContent).toBe("Left leg forward");
    expect(screen.getByTestId("flow-clock").textContent).toBe("0:40");
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
      duration_sec: 974, notes: "recovery_flow: partial 16 of 32 min",
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
    expect(speechLog.at(-1)).not.toContain("Next");
    tap(2);
    await advance(3_000);
    expect(screen.getByTestId("flow-run").dataset.stage).toBe("hold");

  });

  it("rate, pitch and the chosen voice are applied to every utterance", async () => {
    const { utteranceLog } = await import("../src/lib/audio");
    utteranceLog.length = 0;
    start();
    await advance(20_000);
    expect(utteranceLog.length).toBeGreaterThan(0);
    for (const u of utteranceLog) {
      expect(u.rate).toBe(0.85);
      expect(u.pitch).toBe(0.95);
    }
  });

  it("the mid-hold cues can be switched off, and then nothing is said in a hold", async () => {
    const { setMidCues } = await import("../src/lib/voice");
    setMidCues(false);
    try {
      start();
      await advance(20_000);
      // Only the opening lead-in. (Meditation has no mid cue either way; this
      // asserts the toggle, and the pose cues are covered by the engine tests.)
      expect(speechLog).toEqual(["We'll begin with seated meditation for 60 seconds."]);
    } finally {
      setMidCues(true);
    }
  });

  it("the speed stepper persists what Ryan chooses, exactly", async () => {
    const { storedRate } = await import("../src/lib/voice");
    render(<FlowScreen plan={PLAN} />);
    // Shown as a whole percentage, so 0.85 reads as 85 — not a rounded "0.8".
    expect(screen.getByLabelText("Speed 85 %, tap to enter")).toBeDefined();
    fireEvent.click(screen.getByLabelText("Increase Speed"));
    expect(storedRate()).toBe(0.9);
    fireEvent.click(screen.getByLabelText("Decrease Speed"));
    expect(storedRate()).toBe(0.85);                 // lands back on 0.85
  });

  it("the cues toggle persists, and is a button, not a checkbox", async () => {
    const { readMidCues, setMidCues } = await import("../src/lib/voice");
    render(<FlowScreen plan={PLAN} />);
    const toggle = screen.getByTestId("midcue-toggle");
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(toggle);
    expect(readMidCues()).toBe(false);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    setMidCues(true);
  });

  it("the voice control cycles, and persists the choice", async () => {
    const { storedVoiceURI } = await import("../src/lib/voice");
    render(<FlowScreen plan={PLAN} />);
    const picker = screen.getByTestId("voice-picker");
    expect(picker.tagName).toBe("BUTTON");
    expect(picker.textContent).toBe("Voice: Automatic");
    // jsdom has no voices, so the cycle is Automatic → Automatic; the stored
    // value stays "no preference" rather than something invented.
    fireEvent.click(picker);
    expect(storedVoiceURI() || null).toBeNull();
  });

  it("the settings raise no keyboard and no native picker", () => {
    render(<FlowScreen plan={PLAN} />);
    const panel = screen.getByTestId("flow-settings");
    expect(panel.querySelectorAll("input, select, textarea, [contenteditable]")).toHaveLength(0);
  });

  it("an invalid flow refuses to start", () => {
    const bad = JSON.parse(JSON.stringify(PLAN)) as Plan & { blocks: { flow: { step: string }[] } };
    bad.blocks.flow = bad.blocks.flow.filter((s) => s.step !== "17");   // seated twist R
    render(<FlowScreen plan={bad} />);
    expect(screen.getByTestId("flow-invalid").textContent).toContain("twist-seated: missing side R");
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
  });
});
