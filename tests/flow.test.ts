import { describe, expect, it } from "vitest";
import office from "./fixtures/recovery-flow-office.json";
import home from "./fixtures/recovery-flow-home.json";
import {
  buildFlowTimeline,
  flowLogNotes,
  flowTotalSec,
  holdsForRound,
  initialFlowState,
  remainingInStageSec,
  remainingTotalSec,
  skipFlow,
  transitionSec,
  CHIME_LEAD_MS,
  stepNumber,
  tickFlow,
  validateFlow,
  type FlowEvent,
} from "../src/lib/flow";
import { shouldRedirectTodayToStatus } from "../src/lib/routing";
import { flattenBlocksToSteps } from "../src/lib/steps";
import type { RecoveryFlowBlocks } from "../src/lib/types";

// Fixtures are generated from artemis.health_office (the real seed).
const OFFICE = office.blocks as unknown as RecoveryFlowBlocks;
const HOME = home.blocks as unknown as RecoveryFlowBlocks;

function clone(b: RecoveryFlowBlocks): RecoveryFlowBlocks {
  return JSON.parse(JSON.stringify(b)) as RecoveryFlowBlocks;
}

describe("side validator", () => {
  it("accepts the seeded flows", () => {
    expect(validateFlow(OFFICE)).toEqual([]);
    expect(validateFlow(HOME)).toEqual([]);
  });

  it("rejects a flow missing one side", () => {
    const b = clone(HOME);
    b.flow = b.flow.filter((s) => s.step !== "12b");
    expect(validateFlow(b)).toEqual(["wind: missing side L"]);
  });

  it("rejects unequal R/L time", () => {
    const b = clone(HOME);
    b.flow.find((s) => s.step === "11a")!.duration_sec = 45;
    expect(validateFlow(b)).toContain("twist-supine: R 45s ≠ L 30s (round 1)");
  });

  it("compares a lunge unit as a group, not pose by pose", () => {
    const b = clone(HOME);
    const by = Object.fromEntries(b.flow.map((s) => [s.step, s]));
    by["5"].duration_sec = 20; by["6"].duration_sec = 40;   // R unit 60
    by["8"].duration_sec = 40; by["9"].duration_sec = 20;   // L unit 60
    expect(validateFlow(b)).toEqual([]);
    by["9"].duration_sec = 30;
    expect(validateFlow(b)[0]).toMatch(/^lunge-unit: R 60s ≠ L 70s/);
  });

  it("rejects a side with no mirror group", () => {
    const b = clone(HOME);
    b.flow[0].side = "R";
    expect(validateFlow(b)).toEqual(["step 1 has a side but no mirror_group"]);
  });
});

describe("timeline", () => {
  it("round 2 doubles steps 10–16 only", () => {
    const r1 = holdsForRound(HOME, 1);
    const r2 = holdsForRound(HOME, 2);
    HOME.flow.forEach((s, i) => {
      const n = stepNumber(s.step);
      expect(r2[i], s.step).toBe(n >= 10 && n <= 16 ? r1[i] * 2 : r1[i]);
    });
    expect(r1.reduce((a, b) => a + b)).toBe(630);
    expect(r2.reduce((a, b) => a + b)).toBe(960);
  });

  it("totals: office 41:07, home 33:00 — holds plus transitions (YOGA-3)", () => {
    expect(flowTotalSec(OFFICE)).toBe(2467);
    expect(flowTotalSec(HOME)).toBe(1980);
    const moving = (b: RecoveryFlowBlocks) => buildFlowTimeline(b).reduce((a, i) => a + i.transitionSec, 0);
    expect([moving(OFFICE), moving(HOME)]).toEqual([157, 150]);
    // Same numbers artemis wrote into the plan row.
    expect([OFFICE.total_sec, HOME.total_sec]).toEqual([2467, 1980]);
    const t = buildFlowTimeline(OFFICE);
    expect(t[0]).toMatchObject({ kind: "pre", name: "Seated meditation", duration_sec: 60 });
    expect(t[1]).toMatchObject({ kind: "pre", name: "Stretch Trainer", duration_sec: 480,
                                 cue: "Follow the 8 placard stretches" });
    expect(t.at(-1)).toMatchObject({ kind: "close", name: "Savasana", duration_sec: 180 });
    expect(buildFlowTimeline(HOME)[0].name).toBe("Seated meditation");
    expect(t.filter((i) => i.kind === "pose")).toHaveLength(40);
    // Seated breathing stays inside the rounds.
    expect(t.filter((i) => i.name === "Easy pose")).toHaveLength(2);
  });

  it("marks a switch between every R/L pair, in both rounds", () => {
    const t = buildFlowTimeline(HOME);
    const switches = t.filter((i) => i.switchBefore).map((i) => `${i.round}:${i.step}`);
    expect(switches).toEqual([
      "1:8", "1:11b", "1:12b", "1:13b", "1:14b",
      "2:8", "2:11b", "2:12b", "2:13b", "2:14b",
    ]);
    expect(t.find((i) => i.step === "8")!.sideLabel).toBe("Left leg forward");
    expect(t.filter((i) => i.roundStart).map((i) => i.step)).toEqual(["1"]);
    expect(t.find((i) => i.step === "3")!.easier).toBe("Dolphin — forearms down");
  });

  it("flattens to auto-advancing steps for the app's step count", () => {
    expect(flattenBlocksToSteps(OFFICE).steps).toHaveLength(43);
  });
});

describe("spoken cues (YOGA-3)", () => {
  const t = buildFlowTimeline(HOME);
  const at = (step: string, round = 1) => t.find((i) => i.step === step && i.round === round)!;

  it("lead-in: the full sentence, with the side and the hold", () => {
    expect(at("3").leadIn).toBe("Next we'll move into downward facing dog for 60 seconds.");
    expect(at("5").leadIn).toBe("Next we'll move into high lunge, right leg forward, for 30 seconds.");
    expect(at("6").leadIn).toBe("Next we'll move into crescent lunge, right leg forward, for 30 seconds.");
    // Switch sides: "Next, …, <side>, for …"
    expect(at("11b").leadIn).toBe("Next, supine twist, left side, for 30 seconds.");
    expect(at("8").leadIn).toBe("Next, high lunge, left leg forward, for 30 seconds.");
    // Round 2 doubles the hold and names the round.
    expect(at("1", 2).leadIn).toBe("Round 2. Next we'll move into child's pose for 30 seconds.");
    expect(at("11b", 2).leadIn).toBe("Next, supine twist, left side, for 60 seconds.");
    expect(t[0].leadIn).toBe("We'll begin with seated meditation for 60 seconds.");
    expect(t.at(-1)!.leadIn).toBe("Next we'll move into savasana for 3 minutes.");
  });

  it("move cue: just the pose and side", () => {
    expect(at("3").moveCue).toBe("Downward facing dog.");
    expect(at("8").moveCue).toBe("High lunge, left leg forward.");
    expect(at("13a").moveCue).toBe("Seated side bend, lean left.");
    expect(at("12b").moveCue).toBe("Wind release, left knee.");
    expect(t.at(-1)!.moveCue).toBe("Savasana.");
  });
});

describe("transitions by body position (YOGA-3)", () => {
  const posture = (name: string) => HOME.flow.find((s) => s.name === name)!.posture;
  const pair = (a: string, b: string) => transitionSec(posture(a), posture(b));

  it("3 s when the position holds or it's floor to floor; 5 s to get up or down", () => {
    expect(pair("Supine twist", "Supine twist")).toBe(3);        // right → left
    expect(pair("Seated twist", "Seated twist")).toBe(3);
    expect(pair("Standing forward bend", "High lunge")).toBe(3);
    expect(pair("High lunge", "Crescent lunge")).toBe(3);
    expect(pair("Crescent lunge", "Extended puppy")).toBe(5);
    expect(pair("Bridge", "Seated side bend")).toBe(5);
    expect(pair("Child's pose", "Cobra")).toBe(3);
    expect(pair("Cobra", "Downward dog")).toBe(3);
    expect(pair("Downward dog", "Standing forward bend")).toBe(5);
    expect(transitionSec("seated", "supine")).toBe(5);
    expect(transitionSec(undefined, "seated")).toBe(5);          // unknown → long
  });

  it("every item in both flows resolves to 3 or 5 — no gaps", () => {
    for (const b of [HOME, OFFICE]) {
      const t = buildFlowTimeline(b);
      expect(t.every((i) => i.posture), "an item has no posture").toBe(true);
      expect(new Set(t.map((i) => i.transitionSec))).toEqual(new Set([3, 5]));
    }
    const o = buildFlowTimeline(OFFICE);
    expect(o.slice(0, 3).map((i) => i.transitionSec)).toEqual([5, 5, 5]);  // start → sit, → trainer, → floor
    expect(o.find((i) => i.roundStart)!.transitionSec).toBe(3);             // easy pose → child's
    expect(o.at(-1)!.transitionSec).toBe(5);                                // easy pose → savasana
    expect(buildFlowTimeline(HOME)[1].transitionSec).toBe(3);               // meditation → child's
  });

  it("the lengths are config values on the plan", () => {
    const b = clone(HOME);
    b.transition_short_sec = 2;
    b.transition_long_sec = 8;
    const t = buildFlowTimeline(b);
    expect(new Set(t.map((i) => i.transitionSec))).toEqual(new Set([2, 8]));
  });

  it("an old plan row with no postures moves on the long transition", () => {
    const b = clone(HOME);
    for (const s of b.flow) delete s.posture;
    expect(new Set(buildFlowTimeline(b).slice(1, 41).map((i) => i.transitionSec))).toEqual(new Set([5]));
  });
});

function run(items: ReturnType<typeof buildFlowTimeline>, totalMs: number, dt = 250) {
  let s = initialFlowState();
  const events: { at: number; e: FlowEvent }[] = [];
  for (let t = dt; t <= totalMs; t += dt) {
    const r = tickFlow(items, s, dt);
    s = r.state;
    for (const e of r.events) events.push({ at: t, e });
  }
  return { state: s, events };
}

describe("engine — hands-free", () => {
  it("runs start to finish with no input", () => {
    const items = buildFlowTimeline(HOME);
    const { state, events } = run(items, 1980 * 1000 + 5000);
    expect(state.done).toBe(true);
    expect(state.elapsedMs).toBe(1980 * 1000);
    const of = (type: FlowEvent["type"]) => events.filter((x) => x.e.type === type).map((x) => x.e);
    expect(of("transition")).toHaveLength(items.length - 1);   // the first one starts with Start
    expect(of("hold")).toHaveLength(items.length);
    const leads = of("leadin") as Extract<FlowEvent, { type: "leadin" }>[];
    expect(leads).toHaveLength(items.length - 1);
    expect(leads.filter((p) => p.kind === "switch")).toHaveLength(10);
    expect(leads.filter((p) => p.kind === "round")).toHaveLength(1);
    expect(events.at(-1)!.e).toEqual({ type: "done" });
  });

  it("lead-in once, 3 s (plus the chime) before the hold ends; move cue at 0; hold after the transition", () => {
    const items = buildFlowTimeline(HOME);   // meditation: 5 s in, 60 s hold; child's pose: 3 s in
    const { events } = run(items, 70_000);
    const firstHold = events.find((x) => x.e.type === "hold")!;
    expect(firstHold).toEqual({ at: 5_000, e: { type: "hold", index: 0 } });
    const leads = events.filter((x) => x.e.type === "leadin");
    expect(leads).toHaveLength(1);
    // 5 s + 60 s − 3 s − 0.7 s chime = 61.3 s (next tick at 61.5 s)
    expect(leads[0].at).toBe(61_500);
    expect(leads[0].at).toBeGreaterThanOrEqual(65_000 - 3_000 - CHIME_LEAD_MS.next);
    expect(events.find((x) => x.e.type === "transition")).toEqual({ at: 65_000, e: { type: "transition", index: 1 } });
    expect(events.filter((x) => x.e.type === "hold")[1]).toEqual({ at: 68_000, e: { type: "hold", index: 1 } });
  });

  it("the hold clock doesn't run during the transition", () => {
    const items = buildFlowTimeline(HOME);
    let s = tickFlow(items, initialFlowState(), 4_000).state;
    expect(s.stage).toBe("transition");
    expect(remainingInStageSec(items, s)).toBe(1);
    expect(remainingTotalSec(items, s)).toBe(1980 - 4);
    s = tickFlow(items, s, 1_000).state;
    expect(s.stage).toBe("hold");
    expect(remainingInStageSec(items, s)).toBe(60);
  });

  it("pause keeps the remaining time — in a hold and in a transition", () => {
    const items = buildFlowTimeline(HOME);
    let s = tickFlow(items, initialFlowState(), 2_000).state;       // transition, 3 s left
    s = tickFlow(items, { ...s, paused: true }, 60_000).state;
    expect([s.stage, remainingInStageSec(items, s)]).toEqual(["transition", 3]);
    s = tickFlow(items, { ...s, paused: false }, 15_000).state;     // 12 s into the hold
    expect(remainingInStageSec(items, s)).toBe(48);
    s = tickFlow(items, { ...s, paused: true }, 60_000).state;
    expect(remainingInStageSec(items, s)).toBe(48);
    expect(s.elapsedMs).toBe(17_000);
  });

  it("swipe skips to the next pose's transition without counting the skipped time", () => {
    const items = buildFlowTimeline(HOME);
    const s = skipFlow(items, tickFlow(items, initialFlowState(), 10_000).state, 1);
    expect([s.state.index, s.state.stage, s.state.elapsedMs]).toEqual([1, "transition", 10_000]);
    expect(s.events).toEqual([{ type: "transition", index: 1 }]);
  });

  it("log notes", () => {
    expect(flowLogNotes("complete", 1980_000, 1980)).toBe("recovery_flow: complete 33 min");
    expect(flowLogNotes("partial", 990_000, 1980)).toBe("recovery_flow: partial 16 of 33 min");
  });
});

describe("routing", () => {
  const base = { exists: true, is_skipped: false, is_logged: false };
  it("a flow day stays on Today until it is logged — even on a rest_mobility row", () => {
    expect(shouldRedirectTodayToStatus({ ...base, session_type: "rest_mobility", blocks_type: "recovery_flow" })).toBe(false);
    expect(shouldRedirectTodayToStatus({ ...base, session_type: "recovery_flow", blocks_type: null })).toBe(false);
    expect(shouldRedirectTodayToStatus({ ...base, is_logged: true, session_type: "recovery_flow", blocks_type: "recovery_flow" })).toBe(true);
    expect(shouldRedirectTodayToStatus({ ...base, session_type: "rest_mobility", blocks_type: "mobility" })).toBe(true);
  });
});
