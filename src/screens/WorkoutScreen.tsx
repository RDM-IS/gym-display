import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  formatMMSS,
  initTimer,
  isFirstStepCursor,
  selectCurrentStep,
  selectElapsedSec,
  selectIsHolding,
  selectNextStep,
  selectRemainingSec,
  selectStepElapsedSec,
  timerReducer,
  type FlatSession,
  type Step,
} from "../lib/timer";
import { flattenBlocksToSteps } from "../lib/steps";
import {
  beepCountdown,
  beepEndOfRest,
  beepEndOfRound,
  beepEndOfWork,
  beepEndOfWorkout,
  toggleMuted,
} from "../lib/audio";
import { acquireWakeLock, releaseWakeLock, takeWakeHint } from "../lib/wake-lock";
import {
  buildCompletionMap,
  computePrefill,
  loggedCountFor,
  nextSetNumFor,
  totalSetsFor,
  type SessionSets,
  type ServerLoggedCount,
  type SetEntry,
} from "../lib/log-state";
import { useMediaQuery } from "../lib/use-media";
import { useSwipe } from "../lib/use-swipe";
import type { LastLoggedEntry, Plan } from "../lib/types";
import JourneyMap from "../components/JourneyMap";
import InlineExerciseLogger from "../components/InlineExerciseLogger";
import SoundBadge from "../components/SoundBadge";
import SyncBadge from "../components/SyncBadge";
import LogPanel from "./LogPanel";

const TINT_CLASS: Record<Step["kind"], string> = {
  warmup: "tint--warmup",
  exercise: "tint--work",
  rest: "tint--rest",
  cooldown: "tint--cooldown",
};

interface Props {
  plan: Plan;
  sessionSets: SessionSets;
  serverLoggedCount: ServerLoggedCount;
  lastLogged: Record<string, LastLoggedEntry>;
  hasSummary: boolean;
  onLoggedSet: (exerciseName: string, set: SetEntry) => void;
  onSummaryLogged: () => void;
  onDone: (total_elapsed_sec: number) => void;
  onBackToHome: () => void;
}

function haptic(ms = 30): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* no-op on iPad */
  }
}

/** Workout screen for an iPad at arm's length.
 *
 * Density follows the step cursor:
 *   glance — active set / timed step: name, target, set x/y, big timer.
 *   log    — the rest after a planned exercise: the per-set logger for the
 *            set just finished, controls in the bottom half.
 * Landscape: journey map (~35%) | active pane. Portrait / narrow: stacked, map
 * collapsed to a strip. Horizontal swipe on the pane = next / prev step. */
export default function WorkoutScreen({
  plan,
  sessionSets,
  serverLoggedCount,
  lastLogged,
  hasSummary,
  onLoggedSet,
  onSummaryLogged,
  onDone,
  onBackToHome,
}: Props) {
  const session: FlatSession = useMemo(() => flattenBlocksToSteps(plan.blocks), [plan]);
  const [state, dispatch] = useReducer(timerReducer, session, initTimer);
  const [now, setNow] = useState(() => performance.now());
  const [logPanelOpen, setLogPanelOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [wakeHint, setWakeHint] = useState(false);
  const stacked = useMediaQuery("(orientation: portrait), (max-width: 700px)");

  const lastIndexRef = useRef(0);
  const lastBeepSecRef = useRef<number | null>(null);
  const holdBeepKeyRef = useRef<string | null>(null);
  const suppressIndexAudioRef = useRef(false);
  const doneFiredRef = useRef(false);

  // Start + screen wake lock (re-acquired whenever the page becomes visible).
  // Audio was unlocked by the Start tap in App.
  useEffect(() => {
    dispatch({ type: "START", now_ms: performance.now() });
    void acquireWakeLock().then((ok) => setWakeHint(takeWakeHint(ok)));
    function onVis() {
      if (document.visibilityState === "visible") void acquireWakeLock();
    }
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      void releaseWakeLock();
    };
  }, []);

  useEffect(() => {
    if (state.status !== "running") return;
    const id = window.setInterval(() => {
      const t = performance.now();
      setNow(t);
      dispatch({ type: "TICK", now_ms: t });
    }, 100);
    return () => window.clearInterval(id);
  }, [state.status]);

  const current = selectCurrentStep(state);
  const upNext = selectNextStep(state);
  const remaining = selectRemainingSec(state, now);
  const elapsed = selectElapsedSec(state, now);
  const stepElapsed = selectStepElapsedSec(state, now);
  const holding = selectIsHolding(state, now);
  const isPaused = state.status === "paused";
  const strengthSet = current?.kind === "exercise" && !!current.holdAtEnd;
  const stepKey = `${state.cursor.stepIndex}:${state.cursor.currentRound}:${state.step_started_at_ms}`;

  // End-of-previous-step cue on cursor change.
  useEffect(() => {
    if (state.cursor.stepIndex === lastIndexRef.current) return;
    if (!suppressIndexAudioRef.current) {
      const prev = state.steps[lastIndexRef.current];
      if (prev && !prev.holdAtEnd) {
        if (prev.kind === "exercise" || prev.kind === "warmup") beepEndOfWork();
        else if (prev.kind === "rest") {
          if (prev.isRoundBreak) beepEndOfRound();
          else beepEndOfRest();
        }
      }
    }
    suppressIndexAudioRef.current = false;
    lastIndexRef.current = state.cursor.stepIndex;
  }, [state.cursor.stepIndex, state.steps]);

  useEffect(() => {
    lastBeepSecRef.current = null;
  }, [state.step_started_at_ms]);

  // 3-2-1 countdown on timed steps and rests (not on open-ended strength sets).
  useEffect(() => {
    if (state.status !== "running" || strengthSet) return;
    const sec = Math.ceil(remaining);
    if (sec >= 1 && sec <= 3 && lastBeepSecRef.current !== sec) {
      lastBeepSecRef.current = sec;
      beepCountdown();
    }
  }, [remaining, state.status, strengthSet]);

  // A logging rest that has run out: cue once, then wait for the user.
  useEffect(() => {
    if (!holding || strengthSet || holdBeepKeyRef.current === stepKey) return;
    holdBeepKeyRef.current = stepKey;
    beepEndOfRest();
    haptic(80);
  }, [holding, strengthSet, stepKey]);

  useEffect(() => {
    if (state.status === "done" && !doneFiredRef.current) {
      doneFiredRef.current = true;
      beepEndOfWorkout();
      onDone(elapsed);
    }
  }, [state.status, elapsed, onDone]);

  // ── Actions ────────────────────────────────────────────────────────────
  function togglePause() {
    haptic();
    if (state.status === "running") dispatch({ type: "PAUSE", now_ms: performance.now() });
    else if (state.status === "paused") dispatch({ type: "RESUME", now_ms: performance.now() });
  }
  function restartStep() {
    dispatch({ type: "RESTART_STEP", now_ms: performance.now() });
  }
  function prevStep() {
    haptic();
    suppressIndexAudioRef.current = true;
    dispatch({ type: "PREV_STEP", now_ms: performance.now() });
  }
  function nextStep() {
    haptic();
    suppressIndexAudioRef.current = true;
    dispatch({ type: "NEXT_STEP", now_ms: performance.now() });
  }
  function restartWorkout() {
    suppressIndexAudioRef.current = true;
    dispatch({ type: "RESTART_WORKOUT", now_ms: performance.now() });
  }
  function endWorkout() {
    suppressIndexAudioRef.current = true;
    dispatch({ type: "END_WORKOUT" });
  }

  const swipe = useSwipe((dir) => (dir === "left" ? nextStep() : prevStep()));

  const planExerciseNames = useMemo(() => collectExerciseNames(plan), [plan]);
  const completionMap = useMemo(
    () => buildCompletionMap(plan, planExerciseNames, sessionSets, serverLoggedCount),
    [plan, planExerciseNames, sessionSets, serverLoggedCount],
  );

  // The set number a logging rest is for is pinned when the rest begins, so
  // logging it doesn't immediately offer the next set in the same rest.
  const restEntryRef = useRef<{ key: string; setNum: number } | null>(null);
  const restExercise =
    current?.kind === "rest" &&
    current.precedingExerciseRef &&
    planExerciseNames.includes(current.precedingExerciseRef.name)
      ? current.precedingExerciseRef
      : null;
  if (restExercise && restEntryRef.current?.key !== stepKey) {
    restEntryRef.current = {
      key: stepKey,
      setNum: nextSetNumFor(restExercise.name, sessionSets, serverLoggedCount),
    };
  }

  if (!current) return null;

  const flashCountdown =
    state.status === "running" && !strengthSet && Math.ceil(remaining) <= 3 && remaining > 0;
  const density = restExercise ? "log" : "glance";

  const inCircuit = !!current.circuitId && !!current.totalRounds && current.totalRounds > 1;
  const roundLabel = inCircuit
    ? `Round ${state.cursor.currentRound} of ${current.totalRounds}`
    : current.kind.toUpperCase();

  const containerClass =
    `workout ${flashCountdown ? "tint--countdown" : TINT_CLASS[current.kind]}` +
    (isPaused ? " workout--paused" : "") +
    (stacked ? " workout--stacked" : "");

  return (
    <div className={containerClass}>
      <header className="workout-bar">
        <span className="workout-bar-label">{roundLabel}</span>
        <span className="mono">Total {formatMMSS(elapsed)}</span>
        <span className="workout-bar-spacer" />
        <SyncBadge />
        <SoundBadge />
      </header>

      <div className="workout-grid">
        <JourneyMap
          steps={state.steps}
          sections={state.sections}
          cursor={state.cursor}
          completion={completionMap}
          collapsed={stacked && !mapOpen}
          onToggleCollapsed={stacked ? () => setMapOpen((o) => !o) : undefined}
        />

        <main className={`workout-pane workout-pane--${density}`} {...swipe}>
          {isPaused && <div className="paused-badge">Paused</div>}
          <div className="workout-pane-body">
            {density === "log" && restExercise && restEntryRef.current ? (
              <RestLog
                plan={plan}
                exerciseName={restExercise.name}
                remaining={remaining}
                holding={holding}
                upNextLabel={upNext?.label ?? null}
                setNum={restEntryRef.current.setNum}
                sessionSets={sessionSets}
                serverLoggedCount={serverLoggedCount}
                lastLogged={lastLogged}
                isFinisher={current.circuitId === "finisher"}
                onLoggedSet={onLoggedSet}
                onNext={nextStep}
              />
            ) : (
              <Glance
                plan={plan}
                step={current}
                remaining={remaining}
                stepElapsed={stepElapsed}
                isPaused={isPaused}
                planExerciseNames={planExerciseNames}
                sessionSets={sessionSets}
                serverLoggedCount={serverLoggedCount}
                lastLogged={lastLogged}
              />
            )}
          </div>

          <div className="workout-actions">
            {density === "glance" &&
              (strengthSet ? (
                <button type="button" className="btn btn--primary btn--block" onClick={nextStep} aria-label="Set done">
                  Set done ✓
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn--primary btn--block"
                  onClick={togglePause}
                  aria-label={isPaused ? "Resume" : "Pause"}
                >
                  {isPaused ? "▶ Resume" : "⏸ Pause"}
                </button>
              ))}
            <div className="workout-controls">
              <button type="button" className="btn" onClick={prevStep} disabled={isFirstStepCursor(state)} aria-label="Previous step">
                ◀ Prev
              </button>
              {(density === "log" || strengthSet) && (
                <button type="button" className="btn" onClick={togglePause} aria-label={isPaused ? "Resume" : "Pause"}>
                  {isPaused ? "▶ Resume" : "⏸ Pause"}
                </button>
              )}
              <button type="button" className="btn" onClick={nextStep} aria-label="Skip to next">
                {density === "log" ? "Skip rest ▶" : "Skip ▶"}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setMoreOpen(true)}
                aria-label="More controls"
                aria-expanded={moreOpen}
              >
                ⋯ More
              </button>
            </div>
          </div>
        </main>
      </div>

      {wakeHint && (
        <div className="hint-banner" role="status">
          <span>
            This browser can’t keep the screen awake. During workouts set Settings → Display &amp; Brightness →
            Auto-Lock → Never.
          </span>
          <button type="button" className="btn" onClick={() => setWakeHint(false)}>
            OK
          </button>
        </div>
      )}

      {moreOpen && (
        <>
          <div className="sheet-backdrop" onClick={() => setMoreOpen(false)} />
          <div className="sheet sheet--narrow" role="dialog" aria-modal="true" aria-label="More controls">
            <div className="more-grid">
              <button type="button" className="btn" onClick={() => { restartStep(); setMoreOpen(false); }} aria-label="Restart step">
                ↻ Restart step
              </button>
              <button type="button" className="btn" onClick={() => { restartWorkout(); setMoreOpen(false); }} aria-label="Restart workout">
                ⟲ Restart workout
              </button>
              <button type="button" className="btn" onClick={() => { setLogPanelOpen(true); setMoreOpen(false); }} aria-label="Open log panel">
                ✎ All sets
              </button>
              <button type="button" className="btn" onClick={() => toggleMuted()} aria-label="Toggle sound">
                🔈 Sound on / off
              </button>
              <button type="button" className="btn" onClick={onBackToHome} aria-label="Back to home">
                ⌂ Home
              </button>
              <button type="button" className="btn btn--danger" onClick={() => { endWorkout(); setMoreOpen(false); }} aria-label="End workout">
                End workout
              </button>
            </div>
            <button type="button" className="btn btn--ghost btn--block more-close" onClick={() => setMoreOpen(false)}>
              Close
            </button>
          </div>
        </>
      )}

      {logPanelOpen && (
        <LogPanel
          plan={plan}
          elapsed_sec={elapsed}
          sessionSets={sessionSets}
          serverLoggedCount={serverLoggedCount}
          lastLogged={lastLogged}
          hasSummary={hasSummary}
          onLoggedSet={onLoggedSet}
          onSummaryLogged={onSummaryLogged}
          onBackToTimer={() => setLogPanelOpen(false)}
          onFinish={() => onDone(elapsed)}
        />
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────

function collectExerciseNames(plan: Plan): string[] {
  const out: string[] = [];
  const b = plan.blocks;
  if (b?.type === "circuit") {
    for (const ex of Array.isArray(b.exercises) ? b.exercises : []) out.push(ex.name);
  }
  const fin = b?.finisher;
  if (fin && Array.isArray(fin.exercises)) {
    for (const ex of fin.exercises) out.push(ex.name);
  }
  return out;
}

function Glance({
  plan,
  step,
  remaining,
  stepElapsed,
  isPaused,
  planExerciseNames,
  sessionSets,
  serverLoggedCount,
  lastLogged,
}: {
  plan: Plan;
  step: Step;
  remaining: number;
  stepElapsed: number;
  isPaused: boolean;
  planExerciseNames: string[];
  sessionSets: SessionSets;
  serverLoggedCount: ServerLoggedCount;
  lastLogged: Record<string, LastLoggedEntry>;
}) {
  if (step.kind === "warmup" || step.kind === "cooldown") {
    return (
      <>
        <div className="glance-set">{step.kind === "warmup" ? "Warmup" : "Cool down"}</div>
        <div className="glance-time mono">{formatMMSS(remaining)}</div>
        {step.label && <div className="glance-desc">{step.label}</div>}
      </>
    );
  }
  if (step.kind === "rest") {
    return (
      <>
        <div className="glance-set">{step.isRoundBreak ? "Between rounds" : "Rest"}</div>
        <div className="glance-time mono">{formatMMSS(remaining)}</div>
        {step.label && step.label !== "Rest" && <div className="glance-desc">{step.label}</div>}
      </>
    );
  }

  const ex = step.exerciseRef;
  const name = ex?.name ?? step.label;
  const isPlanExercise = !!ex && planExerciseNames.includes(ex.name);
  let setLabel: string | null = null;
  if (isPlanExercise) {
    const total = totalSetsFor(plan, name);
    const setNum = Math.min(nextSetNumFor(name, sessionSets, serverLoggedCount), total);
    setLabel = `Set ${setNum} of ${total}`;
  }
  const reps = ex?.format === "reps" && ex.target_reps != null ? `${ex.target_reps} reps` : null;
  const load = ex?.format === "reps" && ex.target_load_lbs != null ? `${fmt(ex.target_load_lbs)} lb` : null;
  const last = isPlanExercise ? lastLogged[name] ?? null : null;
  const openEnded = !!step.holdAtEnd;

  return (
    <>
      {setLabel && <div className="glance-set">{setLabel}</div>}
      <div className="glance-name">{name}</div>
      {/* Steady cardio carries the intensity as its step label. */}
      {step.label !== name && <div className="glance-target">{step.label}</div>}
      {(reps || load) && <div className="glance-target">{[reps, load].filter(Boolean).join(" × ")}</div>}
      <div className="glance-time mono" aria-label={openEnded ? "Set time" : "Time remaining"}>
        {formatMMSS(openEnded ? stepElapsed : remaining)}
      </div>
      {last && (last.weight_lbs != null || last.reps_done != null) && (
        <div className="glance-prev mono">
          Last:
          {last.weight_lbs != null && ` ${fmt(last.weight_lbs)} lb`}
          {last.reps_done != null && ` × ${last.reps_done}`}
          {last.rpe_actual != null && ` @ RPE ${fmt(last.rpe_actual)}`}
        </div>
      )}
      {!isPaused && ex?.notes && <div className="glance-desc">{ex.notes}</div>}
    </>
  );
}

function RestLog({
  plan,
  exerciseName,
  remaining,
  holding,
  upNextLabel,
  setNum,
  sessionSets,
  serverLoggedCount,
  lastLogged,
  isFinisher,
  onLoggedSet,
  onNext,
}: {
  plan: Plan;
  exerciseName: string;
  remaining: number;
  holding: boolean;
  upNextLabel: string | null;
  setNum: number;
  sessionSets: SessionSets;
  serverLoggedCount: ServerLoggedCount;
  lastLogged: Record<string, LastLoggedEntry>;
  isFinisher: boolean;
  onLoggedSet: (exerciseName: string, set: SetEntry) => void;
  onNext: () => void;
}) {
  const exercise = findExercise(plan, exerciseName);
  const total = totalSetsFor(plan, exerciseName);
  const logged = loggedCountFor(exerciseName, sessionSets, serverLoggedCount);
  const thisSetLogged = logged >= setNum;
  const lastHint = lastLogged[exerciseName] ?? null;

  return (
    <>
      <div className={`restlog-timer${holding ? " restlog-timer--over" : ""}`}>
        <span className="restlog-label">{holding ? "Rest over" : "Rest"}</span>
        <span className="restlog-time mono">{formatMMSS(remaining)}</span>
        {upNextLabel && <span className="restlog-next">Next: {upNextLabel}</span>}
      </div>
      {thisSetLogged || setNum > total || !exercise ? (
        <div className="restlog-done">
          <div>
            ✓ {exerciseName} · set {Math.min(setNum, total)} of {total} logged
          </div>
          <button type="button" className="btn btn--primary btn--block" onClick={onNext}>
            {upNextLabel ? `Next: ${upNextLabel} ▶` : "Next ▶"}
          </button>
        </div>
      ) : (
        <InlineExerciseLogger
          key={`${exerciseName}#${setNum}`}
          exercise={exercise}
          plan_id={plan.plan_id}
          set_num={setNum}
          total_sets={total}
          prefill={computePrefill(
            exerciseName,
            exercise.format,
            exercise.target_load_lbs ?? null,
            exercise.target_reps ?? null,
            exercise.duration_sec ?? null,
            sessionSets,
            lastHint,
          )}
          lastHint={lastHint}
          alreadyFullyLogged={false}
          isFinisher={isFinisher}
          onLoggedSet={onLoggedSet}
        />
      )}
    </>
  );
}

function findExercise(plan: Plan, name: string) {
  const b = plan.blocks;
  const main = b?.type === "circuit" && Array.isArray(b.exercises) ? b.exercises : [];
  const fin = b?.finisher && Array.isArray(b.finisher.exercises) ? b.finisher.exercises : [];
  return [...main, ...fin].find((e) => e.name === name) ?? null;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}
