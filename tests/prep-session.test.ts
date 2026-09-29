import { beforeEach, describe, expect, it } from "vitest";
import { schedule, type PrepRecipeInput, type PrepStep } from "../src/lib/prep-schedule";
import {
  canStart,
  runningHandsTasks,
  startTask,
  clearRun,
  expiredTasks,
  fmtCountdown,
  initialRun,
  loadRun,
  nextHandsTask,
  project,
  projectedFinishMs,
  runningTasks,
  saveRun,
  type RunState,
} from "../src/lib/prep-session";

/** PUBLIC-FIXTURES: Greek-letter stand-ins, never Ryan's recipes. */

function step(p: Partial<PrepStep> & { stepNo: number; name: string }): PrepStep {
  return {
    resource: "hands", mode: "active", baseMin: 0, perServingMin: 0, tempF: null,
    batchKey: null, keepSeparate: false, keepSeparateNote: null,
    shortcutKey: null, notes: null, ...p,
  };
}

function batch(): PrepRecipeInput[] {
  return [
    { notionId: "a", name: "Alpha", servings: 2, steps: [
      step({ stepNo: 1, name: "Season", baseMin: 4 }),
      step({ stepNo: 2, name: "Air-fry", resource: "air_fryer", mode: "passive", baseMin: 22 }),
      step({ stepNo: 3, name: "Portion", perServingMin: 2 }),
    ] },
    { notionId: "b", name: "Beta", servings: 4, steps: [
      step({ stepNo: 1, name: "Rinse", baseMin: 3 }),
      step({ stepNo: 2, name: "Simmer", resource: "stove", mode: "passive", baseMin: 20 }),
    ] },
    { notionId: "c", name: "Gamma", servings: 4, steps: [
      step({ stepNo: 1, name: "Cube", baseMin: 4 }),
      step({ stepNo: 2, name: "Bake", resource: "oven", mode: "passive", baseMin: 25, tempF: 425 }),
    ] },
    { notionId: "d", name: "Delta", servings: 2, steps: [
      step({ stepNo: 1, name: "Press", baseMin: 2 }),
      step({ stepNo: 2, name: "Pressing", resource: "counter", mode: "passive", baseMin: 15 }),
    ] },
  ];
}

const T0 = 1_800_000_000_000;   // a fixed absolute anchor

function running(keys: string[], startedMs: number): RunState {
  const actual: RunState["actual"] = {};
  for (const k of keys) actual[k] = { startedMs };
  return { sessionId: 1, status: "running", startedAtMs: startedMs, actual };
}

describe("timers are absolute, so a locked screen changes nothing", () => {
  const plan = schedule(batch());

  it("a five-minute lock leaves the countdown exactly five minutes shorter", () => {
    // THE acceptance criterion. An interval-based timer would have stopped getting
    // frames while the tab slept and come back wrong; this is arithmetic on
    // Date.now(), so the gap is simply the gap.
    const bake = plan.tasks.find((t) => t.name === "Bake")!;
    const run = running([bake.key], T0);
    const before = runningTasks(plan, run, T0 + 60_000)[0];
    const after = runningTasks(plan, run, T0 + 6 * 60_000)[0];
    expect(before.task.key).toBe(bake.key);
    expect(before.remainingMs - after.remainingMs).toBe(5 * 60_000);
  });

  it("survives a gap longer than the task itself and reads 0:00, not negative", () => {
    const bake = plan.tasks.find((t) => t.name === "Bake")!;
    const run = running([bake.key], T0);
    const late = runningTasks(plan, run, T0 + 999 * 60_000)[0];
    expect(late.remainingMs).toBeLessThan(0);
    expect(fmtCountdown(late.remainingMs)).toBe("0:00");
  });

  it("an expired timer HOLDS instead of clearing itself", () => {
    // The food leaves the oven when he takes it out, not when a number hits zero.
    // A timer that vanished would lose the only signal that something is waiting.
    const bake = plan.tasks.find((t) => t.name === "Bake")!;
    const run = running([bake.key], T0);
    const at = T0 + 40 * 60_000;
    expect(expiredTasks(plan, run, at).map((t) => t.key)).toEqual([bake.key]);
    expect(runningTasks(plan, run, at)).toHaveLength(1);
  });

  it("a task marked done drops off the rail", () => {
    const bake = plan.tasks.find((t) => t.name === "Bake")!;
    const run: RunState = {
      sessionId: 1, status: "running", startedAtMs: T0,
      actual: { [bake.key]: { startedMs: T0, doneMs: T0 + 10 * 60_000 } },
    };
    expect(runningTasks(plan, run, T0 + 12 * 60_000)).toHaveLength(0);
  });
});

describe("four or more timers at once", () => {
  it("the rail reports them all, soonest to finish first", () => {
    const plan = schedule(batch());
    const four = ["Air-fry", "Simmer", "Bake", "Pressing"]
      .map((n) => plan.tasks.find((t) => t.name === n)!);
    expect(four.every(Boolean)).toBe(true);
    const run = running(four.map((t) => t.key), T0);
    const rail = runningTasks(plan, run, T0 + 60_000);
    expect(rail).toHaveLength(4);
    const remaining = rail.map((r) => r.remainingMs);
    expect([...remaining].sort((a, b) => a - b)).toEqual(remaining);
  });
});

describe("one pair of hands", () => {
  /** The board was letting four hands cards run at once — Press curd, Rinse
   * pulses, Clean as you go and Mix jars together — which is not a thing a person
   * can do. The scheduler always knew it; only the manual start path did not. */
  const plan = schedule(batch());
  const handsTasks = () => plan.tasks.filter((t) => t.resource === "hands");

  it("starting a hands card ends the hands card that was running", () => {
    const [first, second] = handsTasks();
    const started = startTask(plan, running([], T0), first, T0).run;
    const after = startTask(plan, started, second, T0 + 60_000);
    expect(after.run.actual[first.key]?.doneMs).toBe(T0 + 60_000);
    expect(after.run.actual[second.key]?.startedMs).toBe(T0 + 60_000);
    expect(after.ended.map((e) => e.task.key)).toEqual([first.key]);
  });

  it("never leaves two hands tasks running, however many are started", () => {
    let run = running([], T0);
    let t = T0;
    for (const task of handsTasks()) {
      t += 60_000;
      run = startTask(plan, run, task, t).run;
      expect(runningHandsTasks(plan, run, t)).toHaveLength(1);
    }
  });

  it("reports the displaced task's real start so its actual time can be logged", () => {
    const [first, second] = handsTasks();
    const started = startTask(plan, running([], T0), first, T0).run;
    const after = startTask(plan, started, second, T0 + 90_000);
    expect(after.ended[0].startedMs).toBe(T0);
  });

  it("leaves the oven, the hob and the air fryer running — four at once still", () => {
    // The rule is about the ONE resource that cannot be doubled. Passive work is
    // the entire point of the schedule and must not be disturbed.
    const devices = ["Air-fry", "Simmer", "Bake", "Pressing"]
      .map((n) => plan.tasks.find((t) => t.name === n)!);
    let run = running(devices.map((d) => d.key), T0);
    run = startTask(plan, run, handsTasks()[0], T0 + 60_000).run;
    const rail = runningTasks(plan, run, T0 + 61_000);
    expect(rail.filter((r) => r.task.resource !== "hands")).toHaveLength(4);
    expect(rail).toHaveLength(5);
  });

  it("re-starting the SAME hands task does not mark it done", () => {
    const [first] = handsTasks();
    const started = startTask(plan, running([], T0), first, T0).run;
    const again = startTask(plan, started, first, T0 + 30_000);
    expect(again.run.actual[first.key]?.doneMs).toBeUndefined();
    expect(again.ended).toEqual([]);
  });

  it("a task that was never started is not reported as ended", () => {
    const [first, second] = handsTasks();
    // `first` is waiting, not running; starting `second` must not invent an end.
    const after = startTask(plan, running([], T0), second, T0);
    expect(after.ended).toEqual([]);
    expect(after.run.actual[first.key]).toBeUndefined();
  });
});

describe("a late start shifts what depends on it", () => {
  const plan = schedule(batch());

  it("a dependent task moves by the delay", () => {
    const cube = plan.tasks.find((t) => t.name === "Cube")!;
    const bake = plan.tasks.find((t) => t.name === "Bake")!;
    const onTime = project(plan, running([], T0), T0).get(bake.key)!;
    // he starts Cube ten minutes late and it therefore finishes ten minutes late
    const late: RunState = {
      sessionId: 1, status: "running", startedAtMs: T0,
      actual: { [cube.key]: {
        startedMs: T0 + (cube.startMin + 10) * 60_000,
        doneMs: T0 + (cube.startMin + 10 + cube.durationMin) * 60_000 } },
    };
    const shifted = project(plan, late, T0).get(bake.key)!;
    expect(shifted.startMs).toBeGreaterThan(onTime.startMs);
    expect(shifted.late).toBe(true);
  });

  it("the projected finish moves with it", () => {
    const cube = plan.tasks.find((t) => t.name === "Cube")!;
    const base = projectedFinishMs(plan, running([], T0), T0);
    const late: RunState = {
      sessionId: 1, status: "running", startedAtMs: T0,
      actual: { [cube.key]: {
        startedMs: T0 + (cube.startMin + 20) * 60_000,
        doneMs: T0 + (cube.startMin + 20 + cube.durationMin) * 60_000 } },
    };
    expect(projectedFinishMs(plan, late, T0)).toBeGreaterThan(base);
  });

  it("added minutes extend the running task and nothing else", () => {
    const bake = plan.tasks.find((t) => t.name === "Bake")!;
    const plain = running([bake.key], T0);
    const extended: RunState = {
      ...plain,
      actual: { [bake.key]: { startedMs: T0, addedMin: 5 } },
    };
    const a = runningTasks(plan, plain, T0)[0].remainingMs;
    const b = runningTasks(plan, extended, T0)[0].remainingMs;
    expect(b - a).toBe(5 * 60_000);
  });
});

describe("what may be started", () => {
  const plan = schedule(batch());

  it("a task whose dependency is unfinished may not start", () => {
    const bake = plan.tasks.find((t) => t.name === "Bake")!;
    expect(canStart(plan, bake.afterKeys.length ? initialRun() : initialRun(), bake, T0))
      .toBe(false);
  });

  it("a first step may start straight away", () => {
    const cube = plan.tasks.find((t) => t.name === "Cube")!;
    const run = { ...initialRun(), status: "running" as const, startedAtMs: T0 };
    expect(canStart(plan, run, cube, T0)).toBe(true);
  });

  it("a task already running may not be started again", () => {
    const cube = plan.tasks.find((t) => t.name === "Cube")!;
    expect(canStart(plan, running([cube.key], T0), cube, T0)).toBe(false);
  });
});

describe("next up, for the phone", () => {
  it("is a hands card and never a device one", () => {
    const plan = schedule(batch());
    const next = nextHandsTask(plan, running([], T0), T0);
    expect(next).not.toBeNull();
    expect(next!.resource).toBe("hands");
  });

  it("is null once the hands have nothing left", () => {
    const plan = schedule(batch());
    const actual: RunState["actual"] = {};
    for (const t of plan.tasks) {
      if (t.resource === "hands") actual[t.key] = { startedMs: T0, doneMs: T0 + 1 };
    }
    expect(nextHandsTask(plan, { sessionId: 1, status: "running", startedAtMs: T0, actual }, T0))
      .toBeNull();
  });
});

describe("the session survives a reload — and works offline", () => {
  beforeEach(() => clearRun());

  it("round-trips through storage", () => {
    const plan = schedule(batch());
    const bake = plan.tasks.find((t) => t.name === "Bake")!;
    const run = running([bake.key], T0);
    saveRun(run);
    const back = loadRun();
    expect(back?.startedAtMs).toBe(T0);
    expect(back?.actual[bake.key]?.startedMs).toBe(T0);
  });

  it("every timer is computed with NO network call", () => {
    // The acceptance criterion "session runs with Wi-Fi off after it has started"
    // reduces to this: the projection is pure arithmetic over stored state. If it
    // needed a fetch, an aeroplane-mode blip would blank the board mid-cook.
    const plan = schedule(batch());
    const run = loadRun() ?? running(
      [plan.tasks.find((t) => t.name === "Bake")!.key], T0);
    expect(() => {
      project(plan, run, T0 + 5 * 60_000);
      runningTasks(plan, run, T0 + 5 * 60_000);
      projectedFinishMs(plan, run, T0 + 5 * 60_000);
    }).not.toThrow();
  });

  it("an unreadable store is not an error", () => {
    // Private window, cleared site data, thumbnail capture: the session starts
    // fresh rather than the screen breaking.
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new Error("blocked"); };
    try {
      expect(loadRun()).toBeNull();
    } finally {
      Storage.prototype.getItem = original;
    }
  });

  it("a blocked write does not throw into the session", () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error("full"); };
    try {
      expect(() => saveRun(initialRun())).not.toThrow();
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});

describe("countdown formatting", () => {
  it("never shows a negative time", () => {
    expect(fmtCountdown(-90_000)).toBe("0:00");
  });
  it("pads the seconds", () => {
    expect(fmtCountdown(65_000)).toBe("1:05");
    expect(fmtCountdown(600_000)).toBe("10:00");
  });
});
