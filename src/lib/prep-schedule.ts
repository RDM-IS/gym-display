/** PREP-2 — the prep scheduler. Pure, deterministic, and it runs in the browser.
 *
 * It turns a stay's recipes into one timed session and tries to make that session
 * short. The hands are the only resource that cannot be doubled, so the whole
 * objective is: keep the oven, stove and air fryer working while the hands do the
 * next thing, and have the heat steps finish close together so nothing sits.
 *
 * WHY IT LIVES HERE AND NOT IN THE LAMBDA
 * A kitchen has bad Wi-Fi and an iPad that locks. Every re-flow — starting a card
 * early, marking one done, adding five minutes — has to work with the network off,
 * so the scheduler has to be on the device. `prep_session.schedule_json` is a
 * RECORD of what was computed, never the authority: reopening the board recomputes
 * it, for the same reason the shopping list is recomputed on every read.
 *
 * DETERMINISM IS A REQUIREMENT, NOT A NICETY. Two runs on the same input must give
 * the same board, or the cards move under his hands between refreshes. Every tie
 * here breaks on a stable key.
 */

export type Resource = "hands" | "oven" | "stove" | "air_fryer" | "counter" | "fridge";
export type Mode = "active" | "passive" | "unattended";

export interface PrepStep {
  stepNo: number;
  name: string;
  resource: Resource;
  mode: Mode;
  baseMin: number;
  /** Scales with batch size. Kept separate from baseMin because one combined
   * number is wrong for every batch size except the one it was measured at. */
  perServingMin: number;
  tempF: number | null;
  batchKey: string | null;
  keepSeparate: boolean;
  keepSeparateNote: string | null;
  shortcutKey: string | null;
  notes: string | null;
  /** An independent line of work inside the recipe.
   *
   * Steps sharing a key are sequential; DIFFERENT KEYS RUN IN PARALLEL; null is a
   * BARRIER that waits for every chain and after which every chain continues.
   *
   * This exists because its absence was measured. The seeded Lentil tofu bowl has
   * eleven steps, and treating step N as always depending on N-1 cooked the
   * lentils, the vegetables and the tofu strictly one after another: the live
   * board read **125 minutes with a 25-minute idle gap** for about an hour of
   * work. The synthetic test batch never showed it, because it modelled those
   * three as separate recipes — which is how the source spec lists them.
   *
   * A recipe that really is one queue needs no keys at all: every step is then a
   * barrier, which is exactly the old behaviour. */
  chainKey?: string | null;
}

export interface PrepRecipeInput {
  notionId: string;
  name: string;
  /** servings still to cook — 0 means it contributes nothing */
  servings: number;
  /** total grams this recipe contributes to a shared-prep card, when known */
  grams?: number | null;
  steps: PrepStep[];
}

export interface KitchenProfile {
  ovenSlots: number;
  burners: number;
  airFryerSlots: number;
  preheatMin: number;
  tempChangeMin: number;
  fillerMin: number;
  fillerName: string;
}

export const DEFAULT_KITCHEN: KitchenProfile = {
  ovenSlots: 2,
  burners: 2,
  airFryerSlots: 1,
  preheatMin: 10,
  tempChangeMin: 5,
  fillerMin: 6,
  fillerName: "Clean as you go",
};

export interface Task {
  key: string;
  name: string;
  resource: Resource;
  mode: Mode;
  durationMin: number;
  tempF: number | null;
  /** every recipe this task feeds — more than one after a shared-prep merge */
  recipes: string[];
  grams: number | null;
  keepSeparate: boolean;
  keepSeparateNote: string | null;
  /** keys that must finish before this can start */
  afterKeys: string[];
  batchKey: string | null;
  shortcutKey: string | null;
  notes: string | null;
  startMin: number;
  endMin: number;
  /** longest chain from here to the end, including this task */
  criticalMin: number;
  isFiller: boolean;
  isPreheat: boolean;
}

export interface IdleGap {
  fromMin: number;
  toMin: number;
  min: number;
}

export interface Schedule {
  tasks: Task[];
  /** minutes from start to the last thing finishing */
  makespanMin: number;
  /** minutes the hands are actually busy */
  handsOnMin: number;
  idleGaps: IdleGap[];
  maxIdleGapMin: number;
  /** unattended steps: real instructions, zero session time */
  unattended: Task[];
  /** how many simulations the improve pass ran */
  iterations: number;
}

const UNLIMITED = Number.POSITIVE_INFINITY;

function capacity(resource: Resource, k: KitchenProfile): number {
  switch (resource) {
    case "hands": return 1;
    case "oven": return Math.max(1, k.ovenSlots);
    case "stove": return Math.max(1, k.burners);
    case "air_fryer": return Math.max(1, k.airFryerSlots);
    case "counter": return UNLIMITED;
    case "fridge": return UNLIMITED;
    default: {
      // Exhaustive: a new resource must be given a capacity here, not defaulted.
      const never: never = resource;
      throw new Error(`no capacity for resource ${never}`);
    }
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** The merge identity for shared prep.
 *
 * A batch key alone is not enough — a recipe can carry the same key on several
 * steps ("cut", then "roast"), and merging those together would be nonsense. The
 * identity is the key AND the step name, which means two recipes merge a step only
 * when they call it the same thing. That is exactly what a shared prep step is:
 * one job done once. */
function mergeId(step: PrepStep): string | null {
  if (!step.batchKey) return null;
  return `${step.batchKey}::${step.name.trim().toLowerCase()}`;
}

/** Expand recipes into tasks, merging shared prep and applying shortcuts. */
export function buildTasks(
  recipes: PrepRecipeInput[],
  shortcuts: string[] = [],
): Task[] {
  const skip = new Set(shortcuts);
  const byMerge = new Map<string, Task>();
  /** Per merged task, the running sum of its per-serving parts and the largest
   * base seen. Held beside the task rather than on it, so the public Task shape
   * that the UI reads carries no scratch fields. */
  const mergeParts = new Map<string, { perSum: number; base: number }>();
  const out: Task[] = [];
  for (const r of recipes) {
    if (!(r.servings > 0)) continue;
    // The tip of each chain: the key of the last KEPT step on it, so step N still
    // follows N-1 on its own chain when a shortcut removed the step between them.
    const tips = new Map<string, string>();
    // Where a chain with no history starts: the last barrier, or nothing.
    let lastBarrier: string | null = null;
    const steps = [...r.steps].sort((a, b) => a.stepNo - b.stepNo);
    for (const s of steps) {
      if (s.shortcutKey && skip.has(s.shortcutKey)) continue;
      const perPart = round1(s.perServingMin * r.servings);
      const dur = s.mode === "unattended" ? 0 : round1(s.baseMin + perPart);
      const mid = mergeId(s);
      const existing = mid ? byMerge.get(mid) : undefined;
      const chain = s.chainKey ?? null;
      // What this step waits for: its own chain's tip (or the last barrier, for a
      // chain starting fresh); a BARRIER waits for every chain plus the barrier
      // before it.
      const deps: string[] = chain === null
        ? [...new Set([...tips.values(), ...(lastBarrier ? [lastBarrier] : [])])]
        : (tips.has(chain) ? [tips.get(chain)!]
                           : (lastBarrier ? [lastBarrier] : []));

      if (existing && mid) {
        // Merge: the per-serving parts ADD (more food to cut) and the bases do
        // NOT (you wash the board once), so the base is the LARGEST, not the sum.
        const parts = mergeParts.get(mid)!;
        parts.perSum = round1(parts.perSum + perPart);
        parts.base = Math.max(parts.base, s.baseMin);
        existing.durationMin = existing.mode === "unattended"
          ? 0 : round1(parts.base + parts.perSum);
        if (!existing.recipes.includes(r.name)) existing.recipes.push(r.name);
        if (r.grams != null) existing.grams = round1((existing.grams ?? 0) + r.grams);
        for (const d of deps) {
          if (!existing.afterKeys.includes(d)) existing.afterKeys.push(d);
        }
        if (chain === null) {
          lastBarrier = existing.key;
          tips.clear();
        } else {
          tips.set(chain, existing.key);
        }
        continue;
      }
      const key = mid ?? `${r.notionId}#${s.stepNo}`;
      const task: Task = {
        key,
        name: s.name,
        resource: s.resource,
        mode: s.mode,
        durationMin: dur,
        tempF: s.tempF,
        recipes: [r.name],
        grams: r.grams ?? null,
        keepSeparate: s.keepSeparate,
        keepSeparateNote: s.keepSeparateNote,
        afterKeys: deps,
        batchKey: s.batchKey,
        shortcutKey: s.shortcutKey,
        notes: s.notes,
        startMin: 0,
        endMin: 0,
        criticalMin: 0,
        isFiller: false,
        isPreheat: false,
      };
      if (mid) {
        byMerge.set(mid, task);
        mergeParts.set(mid, { perSum: perPart, base: s.baseMin });
      }
      out.push(task);
      if (chain === null) {
        // A barrier: everything after it waits for it, and the chains restart
        // from it rather than from their own older tips.
        lastBarrier = key;
        tips.clear();
      } else {
        tips.set(chain, key);
      }
    }
  }
  return out;
}


/** Longest chain from each task to the end, including itself. Unattended = 0. */
export function criticalPaths(tasks: Task[]): Map<string, number> {
  const byKey = new Map(tasks.map((t) => [t.key, t]));
  const successors = new Map<string, string[]>();
  for (const t of tasks) {
    for (const dep of t.afterKeys) {
      const arr = successors.get(dep);
      if (arr) arr.push(t.key);
      else successors.set(dep, [t.key]);
    }
  }
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  function chain(key: string): number {
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    if (visiting.has(key)) {
      // A cycle is bad data, not something to loop on. Treat it as a leaf and let
      // the caller's validation surface it.
      return 0;
    }
    visiting.add(key);
    const t = byKey.get(key);
    const own = t && t.mode !== "unattended" ? t.durationMin : 0;
    let best = 0;
    for (const s of successors.get(key) ?? []) best = Math.max(best, chain(s));
    visiting.delete(key);
    const total = round1(own + best);
    memo.set(key, total);
    return total;
  }
  for (const t of tasks) chain(t.key);
  return memo;
}

interface SimResult {
  tasks: Task[];
  makespanMin: number;
}

/** One event-driven pass. `handsOrder` ranks ready hands tasks (lower = sooner);
 * anything absent from it falls back to critical path. */
function simulate(
  input: Task[],
  k: KitchenProfile,
  handsOrder: Map<string, number> | null,
): SimResult {
  const tasks = input.map((t) => ({ ...t, startMin: 0, endMin: 0 }));
  const cp = criticalPaths(tasks);
  for (const t of tasks) t.criticalMin = cp.get(t.key) ?? 0;

  // Unattended steps take no time and never gate anything.
  const timed = tasks.filter((t) => t.mode !== "unattended");
  const unattended = tasks.filter((t) => t.mode === "unattended");
  for (const t of unattended) { t.startMin = 0; t.endMin = 0; }

  // Preheat, once, before the first oven step. No slot: the oven is warming, not
  // occupied, so it must not consume a rack.
  const ovenTasks = timed.filter((t) => t.resource === "oven");
  let preheat: Task | null = null;
  if (ovenTasks.length > 0 && k.preheatMin > 0) {
    preheat = {
      key: "__preheat", name: `Preheat oven to ${ovenTasks[0].tempF ?? ""}°F`.trim(),
      resource: "oven", mode: "passive", durationMin: k.preheatMin,
      tempF: ovenTasks[0].tempF, recipes: [], grams: null, keepSeparate: false,
      keepSeparateNote: null, afterKeys: [], batchKey: null, shortcutKey: null,
      notes: "no rack used — the oven is warming", startMin: 0, endMin: k.preheatMin,
      criticalMin: 0, isFiller: false, isPreheat: true,
    };
    for (const t of ovenTasks) t.afterKeys = [...t.afterKeys, "__preheat"];
    timed.push(preheat);
  }

  const done = new Map<string, number>();       // key -> endMin
  const placed: Task[] = [];
  const running: { task: Task; endMin: number }[] = [];
  const remaining = new Set(timed.map((t) => t.key));
  const byKey = new Map(timed.map((t) => [t.key, t]));
  // When the oven last became free and at what temperature, so a temperature
  // change costs its 5 minutes rather than being free.
  let ovenTemp: number | null = null;
  let ovenFreeAt = 0;
  let fillerUsed = false;
  let t = 0;
  let guard = 0;

  const readyAt = (task: Task): number | null => {
    let at = 0;
    for (const dep of task.afterKeys) {
      const end = done.get(dep);
      if (end === undefined) return null;      // dependency not finished
      at = Math.max(at, end);
    }
    return at;
  };

  const inUse = (resource: Resource): number =>
    running.filter((r) => r.task.resource === resource).length;

  const rank = (task: Task): number => {
    if (handsOrder && task.resource === "hands") {
      const r = handsOrder.get(task.key);
      if (r !== undefined) return r;
    }
    // longest chain first; the key breaks ties so the board is stable
    return -task.criticalMin;
  };

  while (remaining.size > 0) {
    if (++guard > 10000) break;                // bad data: never spin forever
    let startedSomething = false;

    // 1. passive/device tasks first — they are what keeps the hands free later
    const candidates = [...remaining]
      .map((key) => byKey.get(key)!)
      .filter((task) => {
        const at = readyAt(task);
        return at !== null && at <= t;
      })
      .sort((a, b) => rank(a) - rank(b) || a.key.localeCompare(b.key));

    // When a task cannot start because of a RESOURCE rather than a dependency,
    // the earliest time it could. Without this the loop had nothing to advance to
    // and gave up: two oven steps at different temperatures left the second one
    // unplaced, because its dependencies were satisfied and only the temperature
    // change was in the way.
    let blockedUntil: number | null = null;
    const blockAt = (when: number) => {
      if (when > t && (blockedUntil === null || when < blockedUntil)) blockedUntil = when;
    };

    for (const task of candidates) {
      if (task.resource === "hands") continue;
      if (inUse(task.resource) >= capacity(task.resource, k)) continue;
      if (task.resource === "oven" && !task.isPreheat) {
        // A different temperature needs the oven empty and then its change time.
        if (ovenTemp !== null && task.tempF !== null && task.tempF !== ovenTemp) {
          if (inUse("oven") > 0 || t < ovenFreeAt + k.tempChangeMin) {
            blockAt(round1(ovenFreeAt + k.tempChangeMin));
            continue;
          }
        }
      }
      task.startMin = t;
      task.endMin = round1(t + task.durationMin);
      running.push({ task, endMin: task.endMin });
      remaining.delete(task.key);
      placed.push(task);
      if (task.resource === "oven" && task.tempF !== null) ovenTemp = task.tempF;
      startedSomething = true;
    }

    // 2. then the hands, one at a time
    if (inUse("hands") === 0) {
      const handsTask = candidates.find(
        (task) => task.resource === "hands" && remaining.has(task.key));
      if (handsTask) {
        handsTask.startMin = t;
        handsTask.endMin = round1(t + handsTask.durationMin);
        running.push({ task: handsTask, endMin: handsTask.endMin });
        remaining.delete(handsTask.key);
        placed.push(handsTask);
        startedSomething = true;
      } else if (!fillerUsed && running.length > 0 && remaining.size > 0
                 && k.fillerMin > 0) {
        // Hands idle while a device runs: the spec's one filler card. Once only —
        // a scheduler that fills every gap with cleaning has stopped measuring
        // idleness and started hiding it.
        const filler: Task = {
          key: "__filler", name: k.fillerName, resource: "hands", mode: "active",
          durationMin: k.fillerMin, tempF: null, recipes: [], grams: null,
          keepSeparate: false, keepSeparateNote: null, afterKeys: [],
          batchKey: null, shortcutKey: null, notes: null,
          startMin: t, endMin: round1(t + k.fillerMin), criticalMin: 0,
          isFiller: true, isPreheat: false,
        };
        running.push({ task: filler, endMin: filler.endMin });
        placed.push(filler);
        fillerUsed = true;
        startedSomething = true;
      }
    }

    // 3. advance to the next finish
    if (running.length === 0) {
      if (!startedSomething) {
        // Nothing running and nothing startable. Advance to the earliest time
        // anything could become startable — a dependency finishing OR a resource
        // becoming usable (the oven's temperature change). If neither exists the
        // graph is unsatisfiable, and breaking beats spinning.
        const nexts = [...remaining]
          .map((key) => readyAt(byKey.get(key)!))
          .filter((x): x is number => x !== null && x > t);
        if (blockedUntil !== null) nexts.push(blockedUntil);
        if (nexts.length === 0) break;
        t = Math.min(...nexts);
      }
      continue;
    }
    const nextEnd = Math.min(...running.map((r) => r.endMin));
    t = nextEnd;
    for (let i = running.length - 1; i >= 0; i--) {
      if (running[i].endMin <= t) {
        const finished = running[i].task;
        done.set(finished.key, finished.endMin);
        if (finished.resource === "oven") ovenFreeAt = finished.endMin;
        running.splice(i, 1);
      }
    }
  }

  const makespanMin = placed.length
    ? Math.max(...placed.map((x) => x.endMin))
    : 0;
  return { tasks: [...placed, ...unattended], makespanMin };
}

/** Push each passive heat task as late as the CURRENT schedule already allows.
 *
 * This is the spec's "converge" step, and its purpose is concrete: heat steps
 * should finish near each other so food does not sit warm on the counter while the
 * hands are still busy. Delaying a task only into slack that already exists cannot
 * lengthen the session.
 *
 * IT MUST NOT BREAK ANYTHING, AND THE FIRST VERSION DID. Bounding the shift by a
 * successor's latest FINISH rather than its START moved "Simmer" to end at 62 when
 * "Drain and cool" already began at 46 — a dependency violated by the very pass
 * that was supposed to be free. The bound is now the successor's current START,
 * and the shift is additionally rejected if it would put two tasks on one device
 * beyond its capacity. Both are verified by tests that walk every dependency and
 * every lane.
 */
function convergeHeat(tasks: Task[], makespanMin: number, k: KitchenProfile): void {
  const successors = new Map<string, Task[]>();
  for (const t of tasks) {
    for (const dep of t.afterKeys) {
      const arr = successors.get(dep);
      if (arr) arr.push(t);
      else successors.set(dep, [t]);
    }
  }
  const HEAT: Resource[] = ["oven", "stove", "air_fryer"];
  // Latest first, so a chain of heat steps converges from the end backwards.
  const heat = tasks
    .filter((t) => t.mode === "passive" && !t.isPreheat && HEAT.includes(t.resource))
    .sort((a, b) => b.endMin - a.endMin);

  for (const t of heat) {
    const succ = successors.get(t.key) ?? [];
    // Bound: it must still finish before every successor STARTS, and never run
    // past the end of the session.
    const bound = succ.length
      ? Math.min(makespanMin, ...succ.map((x) => x.startMin))
      : makespanMin;
    let shift = round1(bound - t.endMin);
    if (shift <= 0) continue;
    // A shift that over-subscribes the device is not slack. Reduce it until the
    // lane fits, rather than assuming non-critical implies free.
    //
    // AND THE OVEN HAS A SECOND CONSTRAINT THE CAPACITY CHECK CANNOT SEE: two
    // steps may share the racks only at the SAME temperature. The first version
    // checked slots alone and duly slid a 425°F bake on top of a 350°F one — the
    // simulation refuses that, and this pass was quietly undoing it.
    const cap = capacity(t.resource, k);
    const peers = tasks.filter((o) => o.key !== t.key && o.resource === t.resource
                                 && o.mode !== "unattended" && !o.isPreheat);
    while (shift > 0) {
      const ns = round1(t.startMin + shift);
      const ne = round1(t.endMin + shift);
      const overlapping = peers.filter((o) => o.startMin < ne && ns < o.endMin);
      // A different temperature needs the change time BETWEEN the two windows,
      // not merely no overlap. Shifting a 425°F bake until it ends exactly when a
      // 350°F one starts removes a gap that is physics, and the board would have
      // said to put the cooler tray straight into the hotter oven.
      const tempClash = t.resource === "oven" && peers.some((o) =>
        o.tempF !== t.tempF
        && o.startMin < ne + k.tempChangeMin
        && ns - k.tempChangeMin < o.endMin);
      if (!tempClash && overlapping.length + 1 <= cap) break;
      shift = round1(shift - 1);
    }
    if (shift <= 0) continue;
    t.startMin = round1(t.startMin + shift);
    t.endMin = round1(t.endMin + shift);
  }
}


/** Hands-idle gaps once the session has started, excluding the tail. */
export function handsIdleGaps(tasks: Task[], makespanMin: number): IdleGap[] {
  const hands = tasks
    .filter((t) => t.resource === "hands" && t.mode !== "unattended")
    .sort((a, b) => a.startMin - b.startMin);
  const gaps: IdleGap[] = [];
  let cursor = 0;
  for (const t of hands) {
    if (t.startMin > cursor) {
      gaps.push({ fromMin: cursor, toMin: t.startMin, min: round1(t.startMin - cursor) });
    }
    cursor = Math.max(cursor, t.endMin);
  }
  // The tail is not an idle gap: once the hands are done, waiting for the oven is
  // the session finishing, not a scheduling failure.
  void makespanMin;
  return gaps.filter((g) => g.min > 0);
}

export const MAX_IMPROVE_ITERATIONS = 200;

/** Schedule a session. Deterministic for a given input. */
export function schedule(
  recipes: PrepRecipeInput[],
  kitchen: KitchenProfile = DEFAULT_KITCHEN,
  shortcuts: string[] = [],
): Schedule {
  const base = buildTasks(recipes, shortcuts);
  if (base.length === 0) {
    return {
      tasks: [], makespanMin: 0, handsOnMin: 0, idleGaps: [],
      maxIdleGapMin: 0, unattended: [], iterations: 0,
    };
  }

  let best = simulate(base, kitchen, null);
  let iterations = 1;

  // Improve: swap adjacent hands tasks in priority order and keep any swap that
  // shortens the makespan. Capped, because the graph is small and an unbounded
  // search on a kitchen counter is a hang.
  const handsKeys = best.tasks
    .filter((t) => t.resource === "hands" && !t.isFiller && t.mode !== "unattended")
    .sort((a, b) => a.startMin - b.startMin)
    .map((t) => t.key);
  const order = new Map(handsKeys.map((k, i) => [k, i]));
  let improved = true;
  while (improved && iterations < MAX_IMPROVE_ITERATIONS) {
    improved = false;
    for (let i = 0; i + 1 < handsKeys.length && iterations < MAX_IMPROVE_ITERATIONS; i++) {
      const trial = new Map(order);
      const a = handsKeys[i];
      const b = handsKeys[i + 1];
      trial.set(a, order.get(b)!);
      trial.set(b, order.get(a)!);
      const candidate = simulate(base, kitchen, trial);
      iterations++;
      if (candidate.makespanMin < best.makespanMin - 1e-9) {
        best = candidate;
        order.set(a, trial.get(a)!);
        order.set(b, trial.get(b)!);
        handsKeys[i] = b;
        handsKeys[i + 1] = a;
        improved = true;
      }
    }
  }

  convergeHeat(best.tasks, best.makespanMin, kitchen);

  const timed = best.tasks.filter((t) => t.mode !== "unattended");
  const handsOnMin = round1(
    timed.filter((t) => t.resource === "hands")
      .reduce((sum, t) => sum + t.durationMin, 0));
  const gaps = handsIdleGaps(best.tasks, best.makespanMin);

  return {
    tasks: [...timed].sort((a, b) => a.startMin - b.startMin || a.key.localeCompare(b.key)),
    makespanMin: round1(best.makespanMin),
    handsOnMin,
    idleGaps: gaps,
    maxIdleGapMin: gaps.length ? Math.max(...gaps.map((g) => g.min)) : 0,
    unattended: best.tasks.filter((t) => t.mode === "unattended"),
    iterations,
  };
}

/** Which shortcut toggles the loaded steps actually offer, in a stable order. */
export function availableShortcuts(recipes: PrepRecipeInput[]): string[] {
  const keys = new Set<string>();
  for (const r of recipes) {
    for (const s of r.steps) if (s.shortcutKey) keys.add(s.shortcutKey);
  }
  return [...keys].sort();
}

/** Minutes saved by a set of shortcuts, against the same input without them. */
export function shortcutSaving(
  recipes: PrepRecipeInput[],
  kitchen: KitchenProfile,
  shortcuts: string[],
): number {
  const withNone = schedule(recipes, kitchen, []).makespanMin;
  const withThem = schedule(recipes, kitchen, shortcuts).makespanMin;
  return round1(withNone - withThem);
}
