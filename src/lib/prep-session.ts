/** PREP-2 — running a prep session: absolute timers, projection, persistence.
 *
 * TIMERS ARE ABSOLUTE END TIMESTAMPS, NEVER INTERVALS. An iPad on a kitchen
 * counter locks constantly, and a backgrounded tab stops getting frames — an
 * interval-based countdown drifts and then simply stops. Every timer here is
 * `endMs - Date.now()`, which is correct after a five-minute lock, a reload, and a
 * dropped connection alike. The only state that matters is when a task actually
 * started.
 *
 * RE-FLOW PROJECTS; IT DOES NOT RE-SOLVE. When a card starts late the dependent
 * cards move, and that is a forward pass over the EXISTING order. It would be easy
 * to re-run the optimiser instead, and it would be wrong: re-solving mid-session
 * can reorder the cards while his hands are in the food. The order is decided once,
 * before Start; after that the board only tells the truth about time.
 */

import type { Schedule, Task } from "./prep-schedule";

export type RunStatus = "planned" | "running" | "paused" | "done";

export interface TaskActual {
  /** absolute ms when he actually started it */
  startedMs?: number;
  /** absolute ms when he marked it done */
  doneMs?: number;
  /** minutes added with +1 / +5 */
  addedMin?: number;
  skipped?: boolean;
}

export interface RunState {
  sessionId: number | null;
  status: RunStatus;
  /** the anchor every projected time is measured from */
  startedAtMs: number | null;
  actual: Record<string, TaskActual>;
}

export function initialRun(): RunState {
  return { sessionId: null, status: "planned", startedAtMs: null, actual: {} };
}

export type TaskPhase = "waiting" | "running" | "done" | "skipped";

export interface Projected {
  key: string;
  phase: TaskPhase;
  /** absolute ms, projected or actual */
  startMs: number;
  endMs: number;
  /** minutes including any added time */
  durationMin: number;
  /** true when this task is later than its planned slot */
  late: boolean;
  lateByMin: number;
}

const MS_PER_MIN = 60_000;

function dur(task: Task, actual: TaskActual | undefined): number {
  return Math.max(0, task.durationMin + (actual?.addedMin ?? 0));
}

/** Projected absolute times for every task, honouring what actually happened.
 *
 * Rules, in order of authority:
 *   1. a task he has DONE ends when he said it did;
 *   2. a task he has STARTED ends at its start plus its (possibly extended) length;
 *   3. everything else starts at the later of its planned slot and its
 *      dependencies' projected ends.
 *
 * (3) is what makes a late start ripple. It is deliberately a projection over the
 * planned order, not a re-solve — see the module header.
 */
export function project(
  schedule: Schedule,
  run: RunState,
  nowMs: number,
): Map<string, Projected> {
  const anchor = run.startedAtMs ?? nowMs;
  const out = new Map<string, Projected>();
  const byKey = new Map(schedule.tasks.map((t) => [t.key, t]));
  // planned order is a valid topological order: a dependency always ends before
  // its successor starts in the schedule the optimiser produced.
  const ordered = [...schedule.tasks].sort(
    (a, b) => a.startMin - b.startMin || a.key.localeCompare(b.key));

  for (const task of ordered) {
    const act = run.actual[task.key];
    const length = dur(task, act);
    const plannedStart = anchor + task.startMin * MS_PER_MIN;

    let depsEnd = 0;
    for (const depKey of task.afterKeys) {
      const dep = out.get(depKey);
      if (dep) depsEnd = Math.max(depsEnd, dep.endMs);
      else if (!byKey.has(depKey)) {
        // An unattended or preheat dependency that is not on the board: it cannot
        // gate anything, so it contributes nothing rather than blocking for ever.
        continue;
      }
    }

    let phase: TaskPhase = "waiting";
    let startMs: number;
    let endMs: number;
    if (act?.skipped) {
      phase = "skipped";
      startMs = Math.max(plannedStart, depsEnd);
      endMs = startMs;
    } else if (act?.doneMs != null) {
      phase = "done";
      startMs = act.startedMs ?? Math.max(plannedStart, depsEnd);
      endMs = act.doneMs;
    } else if (act?.startedMs != null) {
      phase = "running";
      startMs = act.startedMs;
      endMs = act.startedMs + length * MS_PER_MIN;
    } else {
      startMs = Math.max(plannedStart, depsEnd);
      endMs = startMs + length * MS_PER_MIN;
    }
    const lateByMin = Math.round((startMs - plannedStart) / MS_PER_MIN);
    out.set(task.key, {
      key: task.key, phase, startMs, endMs, durationMin: length,
      late: lateByMin > 0, lateByMin: Math.max(0, lateByMin),
    });
  }
  return out;
}

/** Tasks running right now, soonest to finish first — the timer rail's order. */
export function runningTasks(
  schedule: Schedule, run: RunState, nowMs: number,
): { task: Task; proj: Projected; remainingMs: number }[] {
  const proj = project(schedule, run, nowMs);
  return schedule.tasks
    .map((task) => ({ task, proj: proj.get(task.key)! }))
    .filter((x) => x.proj && x.proj.phase === "running")
    .map((x) => ({ ...x, remainingMs: x.proj.endMs - nowMs }))
    .sort((a, b) => a.remainingMs - b.remainingMs
      || a.task.key.localeCompare(b.task.key));
}

/** Hands tasks running right now.
 *
 * THERE MUST NEVER BE MORE THAN ONE. The hands are the single resource the whole
 * schedule is built around, and the board was letting four hands cards run at
 * once — Press curd, Rinse pulses, Clean as you go and Mix jars together, which
 * is not a thing one person can do. The scheduler already knew that; only the
 * manual start path did not.
 */
export function runningHandsTasks(
  schedule: Schedule, run: RunState, nowMs: number,
): Task[] {
  return runningTasks(schedule, run, nowMs)
    .map((x) => x.task)
    .filter((t) => t.resource === "hands");
}

/** A timer that has reached zero STAYS at zero until he taps Done.
 *
 * It must not disappear on its own: the food is out of the oven when he takes it
 * out, not when a number hit 0:00, and a timer that cleared itself would lose the
 * only signal that something is waiting. */
export function expiredTasks(
  schedule: Schedule, run: RunState, nowMs: number,
): Task[] {
  return runningTasks(schedule, run, nowMs)
    .filter((x) => x.remainingMs <= 0)
    .map((x) => x.task);
}

/** Start a task, returning the new run state and whatever this ended.
 *
 * ONE PAIR OF HANDS. Starting a hands card finishes whichever hands card was
 * running, because that is what physically happened: he put the last thing down to
 * pick this one up. The board was letting four hands cards run at once — Press
 * curd, Rinse pulses, Clean as you go and Mix jars together — which is not a thing
 * a person can do. The scheduler always knew it; only the manual start path did
 * not.
 *
 * PASSIVE AND HEAT TASKS ARE UNTOUCHED. The oven, the hob and the air fryer run at
 * once and must — four concurrent timers is a requirement, and this rule is about
 * the one resource that cannot be doubled.
 *
 * Pure, and it returns the ended tasks so the caller can log their real elapsed
 * time. That is the calibration data we want anyway.
 */
export function startTask(
  schedule: Schedule, run: RunState, task: Task, nowMs: number,
): { run: RunState; ended: { task: Task; startedMs: number }[] } {
  const actual: Record<string, TaskActual> = { ...run.actual };
  const ended: { task: Task; startedMs: number }[] = [];
  if (task.resource === "hands") {
    for (const other of runningHandsTasks(schedule, run, nowMs)) {
      if (other.key === task.key) continue;
      const prev = actual[other.key] ?? {};
      actual[other.key] = { ...prev, doneMs: nowMs };
      if (prev.startedMs != null) ended.push({ task: other, startedMs: prev.startedMs });
    }
  }
  actual[task.key] = { ...actual[task.key], startedMs: nowMs };
  return { run: { ...run, actual }, ended };
}


/** The next hands card — the phone layout's "Next up". */
export function nextHandsTask(
  schedule: Schedule, run: RunState, nowMs: number,
): Task | null {
  const proj = project(schedule, run, nowMs);
  const candidates = schedule.tasks
    .filter((t) => t.resource === "hands")
    .map((t) => ({ t, p: proj.get(t.key)! }))
    .filter((x) => x.p && (x.p.phase === "waiting" || x.p.phase === "running"))
    .sort((a, b) => a.p.startMs - b.p.startMs || a.t.key.localeCompare(b.t.key));
  return candidates.length ? candidates[0].t : null;
}

export function canStart(
  schedule: Schedule, run: RunState, task: Task, nowMs: number,
): boolean {
  const proj = project(schedule, run, nowMs);
  const own = proj.get(task.key);
  if (!own || own.phase !== "waiting") return false;
  for (const dep of task.afterKeys) {
    const d = proj.get(dep);
    if (d && d.phase !== "done" && d.phase !== "skipped") return false;
  }
  return true;
}

/** Projected finish, as an absolute time. */
export function projectedFinishMs(
  schedule: Schedule, run: RunState, nowMs: number,
): number {
  const proj = project(schedule, run, nowMs);
  let last = run.startedAtMs ?? nowMs;
  for (const p of proj.values()) last = Math.max(last, p.endMs);
  return last;
}

export function fmtClock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined,
    { hour: "numeric", minute: "2-digit" });
}

/** mm:ss, and NEVER a negative number — an expired timer reads 0:00 and holds. */
export function fmtCountdown(remainingMs: number): string {
  const total = Math.max(0, Math.round(remainingMs / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ── persistence ─────────────────────────────────────────────────────────────
//
// The run state is kept on the device so a reload mid-session does not lose which
// cards are running. It is per-viewer and disposable by design; the SERVER holds
// the session row and its events, which is what survives.

const KEY = "prep.run.v1";

export function loadRun(): RunState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RunState;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      sessionId: parsed.sessionId ?? null,
      status: parsed.status ?? "planned",
      startedAtMs: parsed.startedAtMs ?? null,
      actual: parsed.actual ?? {},
    };
  } catch {
    // Private window, cleared data, or a thumbnail capture. An unavailable store
    // means the session starts fresh, not that the screen breaks.
    return null;
  }
}

export function saveRun(run: RunState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(run));
  } catch {
    /* full or blocked: the session still runs, it just will not survive a reload */
  }
}

export function clearRun(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}
