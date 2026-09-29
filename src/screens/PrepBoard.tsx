import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PrepTimerRail from "../components/PrepTimerRail";
import { audioStatus, beepEndOfWork, unlockAudio } from "../lib/audio";
import { acquireWakeLock, releaseWakeLock } from "../lib/wake-lock";
import { useMediaQuery } from "../lib/use-media";
import {
  DEFAULT_KITCHEN,
  availableShortcuts,
  schedule as runSchedule,
  shortcutSaving,
  type KitchenProfile,
  type PrepRecipeInput,
  type Schedule,
  type Task,
} from "../lib/prep-schedule";
import {
  canStart,
  clearRun,
  expiredTasks,
  fmtClock,
  initialRun,
  loadRun,
  nextHandsTask,
  project,
  projectedFinishMs,
  runningTasks,
  saveRun,
  type RunState,
} from "../lib/prep-session";
import { postPrepEvent, postPrepSession, setPrepSessionStatus } from "../lib/api";

export interface BoardData {
  stay: { id: number; start_date: string; end_date: string };
  recipes: PrepRecipeInput[];
  stepless: string[];
  kitchen: KitchenProfile;
}

const LANES: { resource: Task["resource"]; label: string }[] = [
  { resource: "hands", label: "Hands" },
  { resource: "oven", label: "Oven" },
  { resource: "stove", label: "Stovetop" },
  { resource: "air_fryer", label: "Air fryer" },
  { resource: "counter", label: "Counter" },
  { resource: "fridge", label: "Fridge" },
];

/** Horizontal scale. The spec's ~15 px per minute, which is what makes a card's
 * width readable as its length from about 60 cm away. */
const PX_PER_MIN = 15;
const TICK_MIN = 5;
/** Card height + the gap under it, in px. Mirrors .prep-card in prep.css — the two
 * are one fact, and a lane sized against a stale number clips its bottom row. */
const CARD_H = 74;

/** Assign each task to the lowest sub-row in which it overlaps nothing.
 *
 * A lane is a RESOURCE, not a single slot: the oven has two racks, so two cards
 * can legitimately occupy the same minutes. Drawing them at the same offset hid
 * one behind the other — the roast covered the bake. */
function subRows(tasks: Task[]): { rowOf: Map<string, number>; rows: number } {
  const rowOf = new Map<string, number>();
  const rowEnds: number[] = [];
  for (const t of [...tasks].sort(
    (a, b) => a.startMin - b.startMin || a.key.localeCompare(b.key))) {
    let row = rowEnds.findIndex((end) => end <= t.startMin);
    if (row === -1) {
      row = rowEnds.length;
      rowEnds.push(0);
    }
    rowEnds[row] = t.endMin;
    rowOf.set(t.key, row);
  }
  return { rowOf, rows: Math.max(1, rowEnds.length) };
}

export default function PrepBoard({ data }: { data: BoardData }) {
  const phone = useMediaQuery("(max-width: 767px)");
  const [shortcuts, setShortcuts] = useState<string[]>([]);
  const [run, setRun] = useState<RunState>(() => loadRun() ?? initialRun());
  // One tick a second drives every countdown. The countdowns themselves are
  // computed from absolute timestamps, so a missed tick loses nothing.
  const [nowMs, setNowMs] = useState(() => Date.now());
  const chimed = useRef<Set<string>>(new Set());

  const plan: Schedule = useMemo(
    () => runSchedule(data.recipes, data.kitchen ?? DEFAULT_KITCHEN, shortcuts),
    [data.recipes, data.kitchen, shortcuts]);

  const offered = useMemo(() => availableShortcuts(data.recipes), [data.recipes]);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => { saveRun(run); }, [run]);

  // Wake lock while running, re-requested on visibilitychange — a lock released by
  // the OS when the screen sleeps is not re-acquired for you.
  useEffect(() => {
    if (run.status !== "running") return;
    void acquireWakeLock();
    const onVis = () => {
      if (document.visibilityState === "visible") void acquireWakeLock();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      void releaseWakeLock();
    };
  }, [run.status]);

  const rail = useMemo(() => runningTasks(plan, run, nowMs), [plan, run, nowMs]);
  const proj = useMemo(() => project(plan, run, nowMs), [plan, run, nowMs]);

  // Chime once per task when its timer reaches zero. Once, and tracked by key:
  // a chime every tick past zero is an alarm nobody can think through.
  useEffect(() => {
    if (run.status !== "running") return;
    for (const t of expiredTasks(plan, run, nowMs)) {
      if (chimed.current.has(t.key)) continue;
      chimed.current.add(t.key);
      beepEndOfWork();
    }
  }, [plan, run, nowMs]);

  const logEvent = useCallback((task: Task, kind: "start" | "done" | "extend" | "skip",
                                actualMin?: number) => {
    if (run.sessionId == null) return;
    void postPrepEvent({
      session_id: run.sessionId, task_key: task.key, task_name: task.name,
      resource: task.resource, kind, planned_min: task.durationMin,
      actual_min: actualMin,
    });
  }, [run.sessionId]);

  const start = useCallback(async () => {
    // The chime is unlocked HERE, by the tap. Web Audio will not start from a
    // timer, so unlocking anywhere else means silent timers for the whole session.
    await unlockAudio();
    const startedAtMs = Date.now();
    const res = await postPrepSession({
      stay_id: data.stay.id,
      session_date: new Date(startedAtMs).toISOString().slice(0, 10),
      status: "running",
      schedule_json: { tasks: plan.tasks, makespanMin: plan.makespanMin },
      shortcuts,
      planned_min: Math.round(plan.makespanMin),
      hands_on_min: Math.round(plan.handsOnMin),
    });
    setRun({
      sessionId: res.status === "ok" ? res.session_id : null,
      status: "running", startedAtMs, actual: {},
    });
  }, [data.stay.id, plan, shortcuts]);

  const finish = useCallback(async (status: "done" | "abandoned") => {
    if (run.sessionId != null) await setPrepSessionStatus(run.sessionId, status);
    setRun((r) => ({ ...r, status: "done" }));
  }, [run.sessionId]);

  const reset = useCallback(() => {
    chimed.current = new Set();
    clearRun();
    setRun(initialRun());
  }, []);

  const startTask = useCallback((task: Task) => {
    setRun((r) => ({
      ...r,
      actual: { ...r.actual, [task.key]: { ...r.actual[task.key], startedMs: Date.now() } },
    }));
    logEvent(task, "start");
  }, [logEvent]);

  const doneTask = useCallback((task: Task) => {
    const now = Date.now();
    setRun((r) => {
      const prev = r.actual[task.key] ?? {};
      const actualMin = prev.startedMs ? (now - prev.startedMs) / 60000 : undefined;
      if (actualMin !== undefined) {
        void postPrepEvent({
          session_id: r.sessionId ?? 0, task_key: task.key, task_name: task.name,
          resource: task.resource, kind: "done",
          planned_min: task.durationMin, actual_min: Math.round(actualMin * 10) / 10,
        });
      }
      return { ...r, actual: { ...r.actual, [task.key]: { ...prev, doneMs: now } } };
    });
  }, []);

  const addMin = useCallback((task: Task, mins: number) => {
    setRun((r) => {
      const prev = r.actual[task.key] ?? {};
      return {
        ...r,
        actual: { ...r.actual, [task.key]: { ...prev, addedMin: (prev.addedMin ?? 0) + mins } },
      };
    });
    logEvent(task, "extend", task.durationMin + mins);
  }, [logEvent]);

  const running = run.status === "running";
  const finishMs = projectedFinishMs(plan, run, nowMs);
  const elapsedMin = run.startedAtMs ? Math.round((nowMs - run.startedAtMs) / 60000) : 0;
  const nowMin = run.startedAtMs ? (nowMs - run.startedAtMs) / 60000 : 0;

  return (
    <div className="prep-board">
      <header className="prep-board-head">
        <div className="prep-board-stats">
          <span><strong>{plan.makespanMin}</strong> min total</span>
          <span><strong>{plan.handsOnMin}</strong> hands-on</span>
          <span>finish ~<strong>{fmtClock(finishMs)}</strong></span>
          {running && <span className="dim">{elapsedMin} min in</span>}
          {plan.maxIdleGapMin > 6 && (
            <span className="chip chip--under">idle gap {plan.maxIdleGapMin} min</span>
          )}
        </div>
        <div className="prep-board-actions">
          {!running && run.status !== "done" && (
            <button className="btn prep-start" onClick={() => void start()}>Start</button>
          )}
          {running && (
            <>
              <button className="btn" onClick={() => void finish("done")}>Finish</button>
              <button className="btn" onClick={reset}>Reset</button>
            </>
          )}
          {run.status === "done" && (
            <button className="btn" onClick={reset}>New session</button>
          )}
          {audioStatus() === "locked" && (
            <span className="muted prep-audio-hint">Start also turns the chime on</span>
          )}
        </div>
      </header>

      {data.stepless.length > 0 && (
        <p className="banner prep-stale">
          No steps yet for {data.stepless.join(", ")} — they are in the batch but the
          board cannot show them. Add steps in the Steps tab.
        </p>
      )}

      <PrepTimerRail entries={rail} onDone={doneTask} />

      {offered.length > 0 && (
        <div className="prep-shortcuts">
          {offered.map((key) => {
            const on = shortcuts.includes(key);
            const saving = shortcutSaving(data.recipes, data.kitchen, [key]);
            return (
              <button
                key={key}
                className={`chip prep-shortcut${on ? " is-on" : ""}`}
                onClick={() => setShortcuts((s) =>
                  s.includes(key) ? s.filter((x) => x !== key) : [...s, key])}
              >
                {key.replace(/_/g, " ")} {saving > 0 ? `−${saving} min` : ""}
              </button>
            );
          })}
        </div>
      )}

      {phone ? (
        <PhoneLayout plan={plan} run={run} nowMs={nowMs}
                     onStart={startTask} onDone={doneTask} onAdd={addMin} />
      ) : (
        <Lanes plan={plan} proj={proj} nowMin={nowMin} running={running}
               onStart={startTask} onDone={doneTask} onAdd={addMin}
               canStartTask={(t) => canStart(plan, run, t, nowMs)} />
      )}

      <RunOrder plan={plan} run={run} nowMs={nowMs} />
      {plan.unattended.length > 0 && (
        <p className="muted prep-note">
          Before bed: {plan.unattended.map((u) => `${u.name} (${u.recipes.join(", ")})`).join(" · ")}
        </p>
      )}
    </div>
  );
}

function Lanes({
  plan, proj, nowMin, running, onStart, onDone, onAdd, canStartTask,
}: {
  plan: Schedule;
  proj: Map<string, ReturnType<typeof project> extends Map<string, infer V> ? V : never>;
  nowMin: number;
  running: boolean;
  onStart: (t: Task) => void;
  onDone: (t: Task) => void;
  onAdd: (t: Task, m: number) => void;
  canStartTask: (t: Task) => boolean;
}) {
  const width = Math.max(plan.makespanMin, 30) * PX_PER_MIN + 40;
  const ticks = [];
  for (let m = 0; m <= plan.makespanMin + TICK_MIN; m += TICK_MIN) ticks.push(m);
  return (
    <div className="prep-lanes-wrap">
      <div className="prep-lanes" style={{ width }}>
        <div className="prep-ticks">
          {ticks.map((m) => (
            <span key={m} className="prep-tick" style={{ left: m * PX_PER_MIN }}>{m}</span>
          ))}
        </div>
        {running && (
          <div className="prep-now" style={{ left: nowMin * PX_PER_MIN }} aria-label="now" />
        )}
        {LANES.map((lane) => {
          const tasks = plan.tasks.filter((t) => t.resource === lane.resource);
          if (tasks.length === 0) return null;
          const temps = [...new Set(tasks.map((t) => t.tempF).filter(Boolean))];
          // Two oven racks means two cards genuinely overlap in time. Overlaying
          // them hid one behind the other; they stack into sub-rows instead, which
          // is what the lane's height is then sized to.
          const { rowOf, rows } = subRows(tasks);
          return (
            <div className="prep-lane" key={lane.resource}
                 style={{ minHeight: rows * CARD_H + 12 }}>
              <div className="prep-lane-label">
                {lane.label}
                {temps.length > 0 && <span className="dim"> {temps.join("/")}°F</span>}
              </div>
              <div className="prep-lane-track">
                {tasks.map((t) => {
                  const p = proj.get(t.key);
                  const phase = p?.phase ?? "waiting";
                  return (
                    <div
                      key={t.key}
                      className={`prep-card prep-card--${t.mode} is-${phase}`
                        + (t.isFiller ? " is-filler" : "")}
                      style={{ left: t.startMin * PX_PER_MIN,
                               top: 4 + (rowOf.get(t.key) ?? 0) * CARD_H,
                               width: Math.max(t.durationMin * PX_PER_MIN, 34) }}
                      title={`${t.name} · ${t.durationMin} min`}
                    >
                      <span className="prep-card-name">{t.name}</span>
                      {t.recipes.length > 1 && (
                        <span className="prep-card-sub">
                          {t.grams ? `${t.grams} g · ` : ""}{t.recipes.join(" + ")}
                        </span>
                      )}
                      {t.keepSeparate && (
                        <span className="chip chip--top_up">keep separate</span>
                      )}
                      <span className="prep-card-actions">
                        {phase === "waiting" && (
                          <button disabled={!canStartTask(t)} onClick={() => onStart(t)}>▶</button>
                        )}
                        {phase === "running" && (
                          <>
                            <button onClick={() => onDone(t)}>✓</button>
                            <button onClick={() => onAdd(t, 1)}>+1</button>
                            <button onClick={() => onAdd(t, 5)}>+5</button>
                          </>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Phone layout: Now, Next up, and the list. The board does not shrink to a phone
 * legibly, so it is not attempted — the three things he needs while standing at a
 * hob are what is running, what is next, and the order. */
function PhoneLayout({
  plan, run, nowMs, onStart, onDone, onAdd,
}: {
  plan: Schedule; run: RunState; nowMs: number;
  onStart: (t: Task) => void; onDone: (t: Task) => void;
  onAdd: (t: Task, m: number) => void;
}) {
  const next = nextHandsTask(plan, run, nowMs);
  const p = next ? project(plan, run, nowMs).get(next.key) : undefined;
  return (
    <div className="prep-phone">
      <section className="prep-next">
        <h3>Next up</h3>
        {next ? (
          <div className="prep-next-card">
            <div className="prep-next-name">{next.name}</div>
            <div className="muted">
              {next.durationMin} min · {next.resource}
              {next.recipes.length > 1 ? ` · ${next.recipes.join(" + ")}` : ""}
            </div>
            {p?.phase === "running" ? (
              <div className="prep-next-actions">
                <button className="btn" onClick={() => onDone(next)}>Done</button>
                <button className="btn" onClick={() => onAdd(next, 1)}>+1</button>
                <button className="btn" onClick={() => onAdd(next, 5)}>+5</button>
              </div>
            ) : (
              <button className="btn prep-start" onClick={() => onStart(next)}>Start this</button>
            )}
          </div>
        ) : <p className="muted">Nothing left for your hands.</p>}
      </section>
    </div>
  );
}

function RunOrder({ plan, run, nowMs }: { plan: Schedule; run: RunState; nowMs: number }) {
  const proj = project(plan, run, nowMs);
  return (
    <section className="prep-runorder">
      <h3>Run order</h3>
      <ol>
        {plan.tasks.map((t) => {
          const p = proj.get(t.key);
          return (
            <li key={t.key} className={`is-${p?.phase ?? "waiting"}`}>
              <span className="prep-ro-time">
                {run.startedAtMs && p ? fmtClock(p.startMs) : `+${t.startMin}m`}
              </span>
              <span className="prep-ro-name">{t.name}</span>
              <span className="prep-ro-lane dim">{t.resource}</span>
              <span className="prep-ro-dur dim">{t.durationMin} min</span>
              {p?.late && <span className="chip chip--under">+{p.lateByMin} late</span>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
