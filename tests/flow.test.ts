import { describe, expect, it } from "vitest";
import office from "./fixtures/recovery-flow-office.json";
import home from "./fixtures/recovery-flow-home.json";
import {
  buildFlowTimeline,
  flowLogNotes,
  flowTotalSec,
  holdsForRound,
  initialFlowState,
  remainingInItemSec,
  skipFlow,
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

  it("totals: office 37:30 (Stretch Trainer first), home 29:30", () => {
    expect(flowTotalSec(OFFICE)).toBe(2250);
    expect(flowTotalSec(HOME)).toBe(1770);
    const t = buildFlowTimeline(OFFICE);
    expect(t[0]).toMatchObject({ kind: "pre", name: "Stretch Trainer", duration_sec: 480,
                                 cue: "Follow the 8 placard stretches" });
    expect(t.at(-1)).toMatchObject({ kind: "close", name: "Easy pose breathing", duration_sec: 180 });
    expect(buildFlowTimeline(HOME)[0].kind).toBe("pose");
    expect(t.filter((i) => i.kind === "pose")).toHaveLength(40);
  });

  it("marks a switch between every R/L pair, in both rounds", () => {
    const t = buildFlowTimeline(HOME);
    const switches = t.filter((i) => i.switchBefore).map((i) => `${i.round}:${i.step}`);
    expect(switches).toEqual([
      "1:8", "1:11b", "1:12b", "1:13b", "1:14b",
      "2:8", "2:11b", "2:12b", "2:13b", "2:14b",
    ]);
    const lunge = t.find((i) => i.step === "8")!;
    expect(lunge.sideLabel).toBe("Left leg forward");
    expect(lunge.speech).toBe("High lunge, left leg forward");
    expect(t.find((i) => i.step === "11a")!.speech).toBe("Supine twist, right side");
    expect(t.filter((i) => i.roundStart).map((i) => i.step)).toEqual(["1"]);
    expect(t.find((i) => i.step === "3")!.easier).toBe("Dolphin — forearms down");
  });

  it("flattens to auto-advancing steps for the app's step count", () => {
    expect(flattenBlocksToSteps(OFFICE).steps).toHaveLength(42);
  });
});

describe("engine — hands-free", () => {
  it("runs start to finish with no input", () => {
    const items = buildFlowTimeline(HOME);
    let s = initialFlowState();
    const events: FlowEvent[] = [];
    for (let t = 0; t < 1770 * 1000 + 5000; t += 250) {
      const r = tickFlow(items, s, 250);
      s = r.state;
      events.push(...r.events);
    }
    expect(s.done).toBe(true);
    expect(s.elapsedMs).toBe(1770 * 1000);
    expect(events.filter((e) => e.type === "enter")).toHaveLength(items.length - 1);
    expect(events.at(-1)).toEqual({ type: "done" });
    const previews = events.filter((e): e is Extract<FlowEvent, { type: "preview" }> => e.type === "preview");
    expect(previews).toHaveLength(items.length - 1);
    expect(previews.filter((p) => p.kind === "switch")).toHaveLength(10);
    expect(previews.filter((p) => p.kind === "round")).toHaveLength(1);
  });

  it("fires the preview 5 s before each change", () => {
    const items = buildFlowTimeline(HOME);   // child's pose, 30 s
    const a = tickFlow(items, initialFlowState(), 24_900);
    expect(a.events).toEqual([]);
    const b = tickFlow(items, a.state, 200);
    expect(b.events).toEqual([{ type: "preview", index: 0, next: 1, kind: "next" }]);
    const c = tickFlow(items, b.state, 5_000);
    expect(c.events).toEqual([{ type: "enter", index: 1 }]);
  });

  it("pause keeps the remaining time", () => {
    const items = buildFlowTimeline(HOME);
    let s = tickFlow(items, initialFlowState(), 12_000).state;
    expect(remainingInItemSec(items, s)).toBe(18);
    s = { ...s, paused: true };
    s = tickFlow(items, s, 60_000).state;
    expect(remainingInItemSec(items, s)).toBe(18);
    expect(s.elapsedMs).toBe(12_000);
    s = tickFlow(items, { ...s, paused: false }, 3_000).state;
    expect(remainingInItemSec(items, s)).toBe(15);
  });

  it("swipe skips without counting the skipped time", () => {
    const items = buildFlowTimeline(HOME);
    const s = skipFlow(items, tickFlow(items, initialFlowState(), 5_000).state, 1);
    expect(s.state.index).toBe(1);
    expect(s.state.elapsedMs).toBe(5_000);
    expect(s.events).toEqual([{ type: "enter", index: 1 }]);
  });

  it("log notes", () => {
    expect(flowLogNotes("complete", 1770_000, 1770)).toBe("recovery_flow: complete 29 min");
    expect(flowLogNotes("partial", 885_000, 1770)).toBe("recovery_flow: partial 14 of 30 min");
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
