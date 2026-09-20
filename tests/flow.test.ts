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
  stepsForRound,
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
    b.flow = b.flow.filter((s) => s.step !== "14");          // wind release L
    expect(validateFlow(b)).toEqual(["wind: missing side L (round 1)",
                                     "wind: missing side L (round 2)"]);
  });

  it("rejects unequal R/L time", () => {
    const b = clone(HOME);
    b.flow.find((s) => s.step === "11")!.duration_sec = 45;
    expect(validateFlow(b)).toContain("twist-supine: R 45s ≠ L 40s (round 1)");
  });

  it("compares a lunge unit as a group, not pose by pose", () => {
    const b = clone(HOME);
    const by = Object.fromEntries(b.flow.map((s) => [s.step, s]));
    by["5"].duration_sec = 20; by["6"].duration_sec = 40;   // high R + crescent R = 60
    by["7"].duration_sec = 40; by["8"].duration_sec = 20;   // crescent L + high L = 60
    expect(validateFlow(b)).toEqual([]);
    by["8"].duration_sec = 30;
    expect(validateFlow(b)[0]).toMatch(/^lunge-unit: R 60s ≠ L 70s/);
  });

  it("rejects a side with no mirror group", () => {
    const b = clone(HOME);
    b.flow[0].side = "R";
    expect(validateFlow(b)).toEqual(["step 1 has a side but no mirror_group"]);
  });
});

describe("timeline (YOGA-4)", () => {
  it("every hold is 40 s, in both rounds — nothing doubles", () => {
    for (const b of [HOME, OFFICE]) {
      expect(new Set([...holdsForRound(b, 1), ...holdsForRound(b, 2)])).toEqual(new Set([40]));
    }
    expect(holdsForRound(HOME, 1)).toHaveLength(20);
    expect(holdsForRound(HOME, 2)).toHaveLength(19);
    expect(holdsForRound(HOME, 1).reduce((a, b) => a + b)).toBe(800);
    expect(holdsForRound(HOME, 2).reduce((a, b) => a + b)).toBe(760);
  });

  it("easy pose is in round 1 and absent from round 2", () => {
    expect(stepsForRound(HOME, 1).map((s) => s.name).at(-1)).toBe("Easy pose");
    const r2 = stepsForRound(HOME, 2).map((s) => s.name);
    expect(r2).not.toContain("Easy pose");
    expect(r2.at(-1)).toBe("Seated mountain");
    const t = buildFlowTimeline(HOME);
    expect(t.filter((i) => i.name === "Easy pose")).toHaveLength(1);
    expect(t.find((i) => i.name === "Easy pose")!.round).toBe(1);
  });

  it("the lunges run R, R, L, L and extended puppy follows them, before bridge", () => {
    const r1 = stepsForRound(HOME, 1);
    expect(r1.filter((s) => s.mirror_group === "lunge-unit").map((s) => `${s.name} ${s.side}`))
      .toEqual(["High lunge R", "Crescent lunge R", "Crescent lunge L", "High lunge L"]);
    const names = r1.map((s) => s.name);
    const puppy = names.indexOf("Extended puppy");
    const lastLunge = r1.map((s) => s.mirror_group).lastIndexOf("lunge-unit");
    expect(lastLunge).toBeLessThan(puppy);
    expect(names[puppy + 1]).toBe("Bridge");
  });

  it("totals: office 40:32, home 32:27 — holds plus transitions", () => {
    expect(flowTotalSec(OFFICE)).toBe(2432);
    expect(flowTotalSec(HOME)).toBe(1947);
    const moving = (b: RecoveryFlowBlocks) => buildFlowTimeline(b).reduce((a, i) => a + i.transitionSec, 0);
    expect([moving(OFFICE), moving(HOME)]).toEqual([152, 147]);
    // Same numbers artemis wrote into the plan row, and both under 45 min.
    expect([OFFICE.total_sec, HOME.total_sec]).toEqual([2432, 1947]);
    expect(flowTotalSec(OFFICE)).toBeLessThan(45 * 60);
    const t = buildFlowTimeline(OFFICE);
    expect(t[0]).toMatchObject({ kind: "pre", name: "Seated meditation", duration_sec: 60 });
    expect(t[1]).toMatchObject({ kind: "pre", name: "Stretch Trainer", duration_sec: 480,
                                 cue: "Follow the 8 placard stretches" });
    expect(t.at(-1)).toMatchObject({ kind: "close", name: "Savasana", duration_sec: 180 });
    expect(buildFlowTimeline(HOME)[0].name).toBe("Seated meditation");
    expect(t.filter((i) => i.kind === "pose")).toHaveLength(39);   // 20 + 19
  });

  it("marks a switch between every R/L pair, in both rounds", () => {
    const t = buildFlowTimeline(HOME);
    const switches = t.filter((i) => i.switchBefore).map((i) => `${i.round}:${i.step}`);
    // The lunge switch is now at the top of the crescent (step 7), not step 8.
    expect(switches).toEqual([
      "1:7", "1:12", "1:14", "1:17", "1:18",
      "2:7", "2:12", "2:14", "2:17", "2:18",
    ]);
    expect(t.find((i) => i.step === "7")!.sideLabel).toBe("Left leg forward");
    expect(t.filter((i) => i.roundStart).map((i) => i.step)).toEqual(["1"]);
    expect(t.find((i) => i.step === "3")!.easier).toBe("Dolphin — forearms down");
  });

  it("flattens to auto-advancing steps for the app's step count", () => {
    expect(flattenBlocksToSteps(OFFICE).steps).toHaveLength(42);   // 2 pre + 39 poses + savasana
  });
});

describe("spoken cues", () => {
  const t = buildFlowTimeline(HOME);
  const at = (step: string, round = 1) => t.find((i) => i.step === step && i.round === round)!;

  it("lead-in: the full sentence, with the side and the hold", () => {
    expect(at("3").leadIn).toBe("Next we'll move into downward facing dog for 40 seconds.");
    expect(at("5").leadIn).toBe("Next we'll move into high lunge, right leg forward, for 40 seconds.");
    expect(at("6").leadIn).toBe("Next we'll move into crescent lunge, right leg forward, for 40 seconds.");
    // Switch sides: "Next, …, <side>, for …"
    expect(at("7").leadIn).toBe("Next, crescent lunge, left leg forward, for 40 seconds.");
    expect(at("12").leadIn).toBe("Next, supine twist, left side, for 40 seconds.");
    // Round 2 names the round, and holds the same 40 s.
    expect(at("1", 2).leadIn).toBe("Round 2. Next we'll move into child's pose for 40 seconds.");
    expect(at("12", 2).leadIn).toBe("Next, supine twist, left side, for 40 seconds.");
    expect(t[0].leadIn).toBe("We'll begin with seated meditation for 60 seconds.");
    expect(t.at(-1)!.leadIn).toBe("Next we'll move into savasana for 3 minutes.");
  });

  it("move cue: just the pose and side", () => {
    expect(at("3").moveCue).toBe("Downward facing dog.");
    expect(at("8").moveCue).toBe("High lunge, left leg forward.");
    expect(at("15").moveCue).toBe("Seated side bend, lean left.");
    expect(at("14").moveCue).toBe("Wind release, left knee.");
    expect(t.at(-1)!.moveCue).toBe("Savasana.");
  });
});

describe("transitions come from the table (YOGA-4)", () => {
  // Ryan's table, verbatim: what each move costs, in play order.
  const TABLE: [string, number][] = [
    ["Child's pose", 5], ["Cobra", 3], ["Downward dog", 3], ["Standing forward bend", 3],
    ["High lunge R", 5], ["Crescent lunge R", 3], ["Crescent lunge L", 3], ["High lunge L", 3],
    ["Extended puppy", 5], ["Bridge", 4], ["Supine twist R", 3], ["Supine twist L", 3],
    ["Wind release R", 4], ["Wind release L", 3], ["Seated side bend L", 5],
    ["Seated twist L", 3], ["Seated twist R", 3], ["Seated side bend R", 3],
    ["Seated mountain", 3], ["Easy pose", 3],
  ];
  const labelled = (b: RecoveryFlowBlocks) =>
    buildFlowTimeline(b).map((i) => [i.name + (i.side ? ` ${i.side}` : ""), i.transitionSec]);

  it("every transition in both flows matches the table exactly", () => {
    for (const b of [HOME, OFFICE]) {
      const seq = labelled(b);
      const poses = seq.slice(b.pre?.length ?? 0);
      expect(poses.slice(0, 20)).toEqual(TABLE);                 // round 1
      expect(poses.slice(20, 39)).toEqual(TABLE.slice(0, 19));   // round 2, no easy pose
    }
  });

  it("round 1 ends easy pose → child's; round 2 ends seated mountain → savasana", () => {
    const seq = labelled(HOME);
    const i = seq.findIndex(([n]) => n === "Easy pose");
    expect(seq[i]).toEqual(["Easy pose", 3]);
    expect(seq[i + 1]).toEqual(["Child's pose", 5]);      // starts round 2
    expect(seq.slice(-2)).toEqual([["Seated mountain", 3], ["Savasana", 5]]);
  });

  it("the pre items carry their own transitions", () => {
    expect(labelled(OFFICE).slice(0, 3)).toEqual([
      ["Seated meditation", 5], ["Stretch Trainer", 5], ["Child's pose", 5],
    ]);
    expect(labelled(HOME).slice(0, 2)).toEqual([["Seated meditation", 5], ["Child's pose", 5]]);
  });

  it("nothing is derived from posture any more", () => {
    const b = clone(HOME);
    for (const st of b.flow) delete st.posture;
    // Posture gone, transitions unchanged — they come from the data, not the body.
    expect(labelled(b)).toEqual(labelled(HOME));
  });

  it("a step with no transition is a seeding bug, and is reported", () => {
    const b = clone(HOME);
    delete (b.flow[4] as { transition_sec?: number }).transition_sec;
    expect(validateFlow(b)).toContain("5: transition_sec is missing");
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
    const { state, events } = run(items, 1947 * 1000 + 5000);
    expect(state.done).toBe(true);
    expect(state.elapsedMs).toBe(1947 * 1000);
    const of = (type: FlowEvent["type"]) => events.filter((x) => x.e.type === type).map((x) => x.e);
    expect(of("transition")).toHaveLength(items.length - 1);   // the first one starts with Start
    expect(of("hold")).toHaveLength(items.length);
    const leads = of("leadin") as Extract<FlowEvent, { type: "leadin" }>[];
    expect(leads).toHaveLength(items.length - 1);
    expect(leads.filter((p) => p.kind === "switch")).toHaveLength(10);
    expect(leads.filter((p) => p.kind === "round")).toHaveLength(1);
    expect(events.at(-1)!.e).toEqual({ type: "done" });
  });

  it("lead-in at exactly 7 s remaining; move cue at 0; hold after the transition", () => {
    const items = buildFlowTimeline(HOME);   // meditation: 5 s in, 60 s hold; child's pose: 5 s in
    const { events } = run(items, 75_000);
    const firstHold = events.find((x) => x.e.type === "hold")!;
    expect(firstHold).toEqual({ at: 5_000, e: { type: "hold", index: 0 } });
    const leads = events.filter((x) => x.e.type === "leadin");
    expect(leads).toHaveLength(1);
    // The hold ends at 65 s, so the words start at 58 s — no chime in front.
    expect(leads[0].at).toBe(58_000);
    expect(leads[0].e).toEqual({ type: "leadin", index: 0, next: 1, kind: "next" });
    // The move cue rides the transition event, at 0 s remaining.
    expect(events.find((x) => x.e.type === "transition")).toEqual({ at: 65_000, e: { type: "transition", index: 1 } });
    expect(events.filter((x) => x.e.type === "hold")[1]).toEqual({ at: 70_000, e: { type: "hold", index: 1 } });
  });

  it("the hold clock doesn't run during the transition", () => {
    const items = buildFlowTimeline(HOME);
    let s = tickFlow(items, initialFlowState(), 4_000).state;
    expect(s.stage).toBe("transition");
    expect(remainingInStageSec(items, s)).toBe(1);
    expect(remainingTotalSec(items, s)).toBe(1947 - 4);
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
    expect(flowLogNotes("complete", 1947_000, 1947)).toBe("recovery_flow: complete 32 min");
    expect(flowLogNotes("partial", 990_000, 1947)).toBe("recovery_flow: partial 16 of 32 min");
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
