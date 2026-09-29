import { describe, expect, it } from "vitest";
import {
  DEFAULT_KITCHEN,
  MAX_IMPROVE_ITERATIONS,
  availableShortcuts,
  buildTasks,
  criticalPaths,
  handsIdleGaps,
  schedule,
  shortcutSaving,
  type PrepRecipeInput,
  type PrepStep,
} from "../src/lib/prep-schedule";

/** PUBLIC-FIXTURES: every recipe name here is a Greek-letter stand-in, never one
 * of Ryan's. The DURATIONS are the spec's, because the ≤65 min acceptance test is
 * only meaningful if the arithmetic is the real arithmetic. */

function step(p: Partial<PrepStep> & { stepNo: number; name: string }): PrepStep {
  return {
    resource: "hands",
    mode: "active",
    baseMin: 0,
    perServingMin: 0,
    tempF: null,
    batchKey: null,
    keepSeparate: false,
    keepSeparateNote: null,
    shortcutKey: null,
    notes: null,
    ...p,
  };
}

/** The sample batch's SHAPE from the spec: 4 + 4 + 2 + 4 servings, one shared prep
 * task, work on the oven, the stove and the air fryer at once. */
function sampleBatch(): PrepRecipeInput[] {
  return [
    { notionId: "r-alpha", name: "Alpha jars", servings: 4, steps: [
      step({ stepNo: 1, name: "Mix jars", perServingMin: 2 }),
      step({ stepNo: 2, name: "Chill overnight", resource: "fridge", mode: "unattended" }),
    ] },
    { notionId: "r-beta", name: "Beta pulses", servings: 4, steps: [
      step({ stepNo: 1, name: "Rinse pulses", baseMin: 3 }),
      step({ stepNo: 2, name: "Simmer", resource: "stove", mode: "passive", baseMin: 20 }),
      step({ stepNo: 3, name: "Drain and cool", resource: "counter", mode: "passive", baseMin: 10 }),
    ] },
    { notionId: "r-gamma", name: "Gamma curd", servings: 4, steps: [
      step({ stepNo: 1, name: "Press curd", baseMin: 2 }),
      step({ stepNo: 2, name: "Pressing", resource: "counter", mode: "passive", baseMin: 15 }),
      step({ stepNo: 3, name: "Cube and season", baseMin: 4 }),
      step({ stepNo: 4, name: "Bake", resource: "oven", mode: "passive", baseMin: 25, tempF: 425 }),
      step({ stepNo: 5, name: "Portion", perServingMin: 2 }),
    ] },
    { notionId: "r-delta", name: "Delta poultry", servings: 2, steps: [
      step({ stepNo: 1, name: "Season", baseMin: 4 }),
      step({ stepNo: 2, name: "Air-fry", resource: "air_fryer", mode: "passive", baseMin: 22 }),
      step({ stepNo: 3, name: "Portion", perServingMin: 2 }),
    ] },
    { notionId: "r-epsilon", name: "Epsilon cups", servings: 4, steps: [
      step({ stepNo: 1, name: "Blend", perServingMin: 1.5 }),
      step({ stepNo: 2, name: "Chill", resource: "fridge", mode: "unattended" }),
    ] },
    // shared prep, fed by two of the bowls
    { notionId: "r-veg1", name: "Gamma curd", servings: 1, grams: 450, steps: [
      step({ stepNo: 1, name: "Wash", baseMin: 5, batchKey: "roast:veg", shortcutKey: "precut_veg" }),
      step({ stepNo: 2, name: "Cut", baseMin: 12, batchKey: "roast:veg", shortcutKey: "precut_veg" }),
      step({ stepNo: 3, name: "Roast", resource: "oven", mode: "passive", baseMin: 25,
             tempF: 425, batchKey: "roast:veg" }),
    ] },
    { notionId: "r-veg2", name: "Delta poultry", servings: 1, grams: 450, steps: [
      step({ stepNo: 1, name: "Wash", baseMin: 5, batchKey: "roast:veg", shortcutKey: "precut_veg" }),
      step({ stepNo: 2, name: "Cut", baseMin: 12, batchKey: "roast:veg", shortcutKey: "precut_veg" }),
      step({ stepNo: 3, name: "Roast", resource: "oven", mode: "passive", baseMin: 25,
             tempF: 425, batchKey: "roast:veg" }),
    ] },
  ];
}

describe("duration is base + per-serving × servings", () => {
  it("scales only the per-serving part", () => {
    const tasks = buildTasks([{ notionId: "r", name: "R", servings: 4, steps: [
      step({ stepNo: 1, name: "Portion", baseMin: 1, perServingMin: 2 }),
    ] }]);
    expect(tasks[0].durationMin).toBe(9);      // 1 + 2×4
  });

  it("an unattended step takes ZERO minutes, not a small number", () => {
    // "Oats → fridge overnight" must never extend a session. Zero is the answer,
    // and a small placeholder would quietly add up across a batch.
    const tasks = buildTasks([{ notionId: "r", name: "R", servings: 4, steps: [
      step({ stepNo: 1, name: "Fridge", resource: "fridge", mode: "unattended", baseMin: 480 }),
    ] }]);
    expect(tasks[0].durationMin).toBe(0);
  });
});

describe("shared prep merges into one task", () => {
  it("one card, both recipes, summed grams", () => {
    const s = schedule(sampleBatch());
    const cut = s.tasks.filter((t) => t.name === "Cut");
    expect(cut).toHaveLength(1);
    expect(cut[0].recipes.sort()).toEqual(["Delta poultry", "Gamma curd"]);
    expect(cut[0].grams).toBe(900);
  });

  it("the base is the LARGEST, not the sum — you wash the board once", () => {
    const tasks = buildTasks([
      { notionId: "a", name: "A", servings: 2, steps: [
        step({ stepNo: 1, name: "Cut", baseMin: 12, perServingMin: 1, batchKey: "veg" })] },
      { notionId: "b", name: "B", servings: 3, steps: [
        step({ stepNo: 1, name: "Cut", baseMin: 10, perServingMin: 1, batchKey: "veg" })] },
    ]);
    expect(tasks).toHaveLength(1);
    // base max(12,10)=12, per-serving 1×2 + 1×3 = 5 → 17, not 22+13
    expect(tasks[0].durationMin).toBe(17);
  });

  it("different step names under one batch key do NOT merge", () => {
    // A recipe carries the same key on several steps; merging "Cut" with "Roast"
    // would be nonsense, so the identity is the key AND the name.
    const tasks = buildTasks([
      { notionId: "a", name: "A", servings: 1, steps: [
        step({ stepNo: 1, name: "Cut", baseMin: 5, batchKey: "veg" }),
        step({ stepNo: 2, name: "Roast", resource: "oven", mode: "passive",
               baseMin: 20, tempF: 400, batchKey: "veg" })] },
    ]);
    expect(tasks.map((t) => t.name)).toEqual(["Cut", "Roast"]);
  });
});

describe("M3 acceptance — the sample batch", () => {
  const s = schedule(sampleBatch());

  it("fits in 65 minutes", () => {
    expect(s.makespanMin).toBeLessThanOrEqual(65);
  });

  it("leaves no hands-idle gap longer than 6 minutes", () => {
    expect(s.maxIdleGapMin).toBeLessThanOrEqual(6);
  });

  it("runs at least 4 things at once at some point", () => {
    // The timer rail has to cope with ≥4 concurrent, so the schedule has to
    // produce them. Count overlaps at every task start.
    const timed = s.tasks.filter((t) => t.durationMin > 0);
    const most = Math.max(...timed.map((t) =>
      timed.filter((o) => o.startMin <= t.startMin && o.endMin > t.startMin).length));
    expect(most).toBeGreaterThanOrEqual(4);
  });

  it("never exceeds the kitchen's capacity in any lane", () => {
    const caps: Record<string, number> = {
      hands: 1, oven: DEFAULT_KITCHEN.ovenSlots, stove: DEFAULT_KITCHEN.burners,
      air_fryer: DEFAULT_KITCHEN.airFryerSlots,
    };
    const timed = s.tasks.filter((t) => t.durationMin > 0 && !t.isPreheat);
    for (const t of timed) {
      const cap = caps[t.resource];
      if (cap === undefined) continue;          // counter / fridge are unlimited
      const at = timed.filter((o) => o.resource === t.resource
        && o.startMin <= t.startMin && o.endMin > t.startMin).length;
      expect(at, `${t.resource} at ${t.startMin} min`).toBeLessThanOrEqual(cap);
    }
  });

  it("respects every dependency", () => {
    const byKey = new Map(s.tasks.concat(s.unattended).map((t) => [t.key, t]));
    for (const t of s.tasks) {
      for (const dep of t.afterKeys) {
        const d = byKey.get(dep);
        if (!d || d.mode === "unattended" || d.isPreheat) continue;
        expect(t.startMin, `${t.name} after ${d.name}`).toBeGreaterThanOrEqual(d.endMin);
      }
    }
  });

  it("reports hands-on minutes separately from the session length", () => {
    expect(s.handsOnMin).toBeGreaterThan(0);
    expect(s.handsOnMin).toBeLessThanOrEqual(s.makespanMin);
  });

  it("keeps the unattended steps as instructions with no session time", () => {
    expect(s.unattended.length).toBe(2);
    for (const u of s.unattended) expect(u.durationMin).toBe(0);
  });

  it("is deterministic", () => {
    const again = schedule(sampleBatch());
    expect(again.tasks.map((t) => [t.key, t.startMin]))
      .toEqual(s.tasks.map((t) => [t.key, t.startMin]));
    expect(again.makespanMin).toBe(s.makespanMin);
  });

  it("stays inside the iteration cap", () => {
    expect(s.iterations).toBeLessThanOrEqual(MAX_IMPROVE_ITERATIONS);
  });
});

describe("the oven", () => {
  it("preheats once before the first oven step", () => {
    const s = schedule(sampleBatch());
    const pre = s.tasks.filter((t) => t.isPreheat);
    expect(pre).toHaveLength(1);
    const ovens = s.tasks.filter((t) => t.resource === "oven" && !t.isPreheat);
    for (const o of ovens) expect(o.startMin).toBeGreaterThanOrEqual(pre[0].endMin);
  });

  it("lets two steps at the SAME temperature share the racks", () => {
    const s = schedule(sampleBatch());
    const ovens = s.tasks.filter((t) => t.resource === "oven" && !t.isPreheat);
    expect(ovens.length).toBeGreaterThanOrEqual(2);
    expect(new Set(ovens.map((o) => o.tempF)).size).toBe(1);
    const overlap = ovens.some((a) => ovens.some((b) =>
      a.key !== b.key && a.startMin < b.endMin && b.startMin < a.endMin));
    expect(overlap).toBe(true);
  });

  it("charges a temperature change when two steps disagree", () => {
    const recipes: PrepRecipeInput[] = [
      { notionId: "a", name: "A", servings: 1, steps: [
        step({ stepNo: 1, name: "Bake hot", resource: "oven", mode: "passive",
               baseMin: 10, tempF: 425 })] },
      { notionId: "b", name: "B", servings: 1, steps: [
        step({ stepNo: 1, name: "Bake cool", resource: "oven", mode: "passive",
               baseMin: 10, tempF: 350 })] },
    ];
    const s = schedule(recipes, { ...DEFAULT_KITCHEN, ovenSlots: 2 });
    const [first, second] = s.tasks
      .filter((t) => t.resource === "oven" && !t.isPreheat)
      .sort((a, b) => a.startMin - b.startMin);
    // They must NOT overlap, and the gap must cover the temperature change.
    expect(second.startMin).toBeGreaterThanOrEqual(
      first.endMin + DEFAULT_KITCHEN.tempChangeMin);
  });
});

describe("the filler", () => {
  it("appears once at most, never on every gap", () => {
    // A scheduler that fills every gap with cleaning has stopped measuring
    // idleness and started hiding it.
    const s = schedule(sampleBatch());
    expect(s.tasks.filter((t) => t.isFiller).length).toBeLessThanOrEqual(1);
  });

  it("is not invented when the hands are never idle", () => {
    const s = schedule([{ notionId: "a", name: "A", servings: 1, steps: [
      step({ stepNo: 1, name: "Chop", baseMin: 10 }),
      step({ stepNo: 2, name: "Mix", baseMin: 10 }),
    ] }]);
    expect(s.tasks.some((t) => t.isFiller)).toBe(false);
  });
});

describe("shortcuts", () => {
  it("are discovered from the loaded steps", () => {
    expect(availableShortcuts(sampleBatch())).toEqual(["precut_veg"]);
  });

  it("shorten the session and report the saving", () => {
    const saved = shortcutSaving(sampleBatch(), DEFAULT_KITCHEN, ["precut_veg"]);
    expect(saved).toBeGreaterThan(0);
  });

  it("removing a middle step keeps the chain connected", () => {
    // Wash and Cut are both shortcut-skippable; Roast must still depend on
    // whatever remains rather than floating free or depending on a dropped key.
    const tasks = buildTasks(sampleBatch(), ["precut_veg"]);
    const roast = tasks.find((t) => t.name === "Roast")!;
    const keys = new Set(tasks.map((t) => t.key));
    for (const dep of roast.afterKeys) expect(keys.has(dep)).toBe(true);
  });
});

describe("critical path", () => {
  it("is the duration plus the longest chain after it", () => {
    const tasks = buildTasks([{ notionId: "r", name: "R", servings: 1, steps: [
      step({ stepNo: 1, name: "One", baseMin: 5 }),
      step({ stepNo: 2, name: "Two", baseMin: 7 }),
      step({ stepNo: 3, name: "Three", baseMin: 2 }),
    ] }]);
    const cp = criticalPaths(tasks);
    expect(cp.get(tasks[0].key)).toBe(14);
    expect(cp.get(tasks[1].key)).toBe(9);
    expect(cp.get(tasks[2].key)).toBe(2);
  });

  it("counts an unattended step as zero", () => {
    const tasks = buildTasks([{ notionId: "r", name: "R", servings: 1, steps: [
      step({ stepNo: 1, name: "Mix", baseMin: 5 }),
      step({ stepNo: 2, name: "Fridge", resource: "fridge", mode: "unattended", baseMin: 600 }),
    ] }]);
    expect(criticalPaths(tasks).get(tasks[0].key)).toBe(5);
  });
});

describe("idle gaps", () => {
  it("do not count the tail while a device finishes", () => {
    // Once the hands are done, waiting for the oven is the session finishing, not
    // a scheduling failure.
    const s = schedule([{ notionId: "a", name: "A", servings: 1, steps: [
      step({ stepNo: 1, name: "Season", baseMin: 4 }),
      step({ stepNo: 2, name: "Bake", resource: "oven", mode: "passive",
             baseMin: 40, tempF: 400 }),
    ] }]);
    expect(s.maxIdleGapMin).toBeLessThanOrEqual(DEFAULT_KITCHEN.preheatMin);
    expect(handsIdleGaps(s.tasks, s.makespanMin).some((g) => g.toMin > 44)).toBe(false);
  });
});

describe("degenerate input", () => {
  it("an empty batch is an empty schedule, not a crash", () => {
    const s = schedule([]);
    expect(s.tasks).toEqual([]);
    expect(s.makespanMin).toBe(0);
  });

  it("a recipe with nothing left to cook contributes nothing", () => {
    const s = schedule([{ notionId: "a", name: "A", servings: 0, steps: [
      step({ stepNo: 1, name: "Chop", baseMin: 10 })] }]);
    expect(s.tasks).toEqual([]);
  });

  it("a dependency cycle terminates instead of hanging", () => {
    const tasks = buildTasks([{ notionId: "a", name: "A", servings: 1, steps: [
      step({ stepNo: 1, name: "One", baseMin: 5 }),
      step({ stepNo: 2, name: "Two", baseMin: 5 }),
    ] }]);
    tasks[0].afterKeys = [tasks[1].key];      // 1 <- 2 and 2 <- 1
    expect(() => criticalPaths(tasks)).not.toThrow();
  });
});
