import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  exercisePrompt,
  fitsInRest,
  lastSessionAverage,
  promptTarget,
  repsLeftHint,
} from "../lib/strength-cues";
import { speak } from "../lib/audio";
import StrengthTiles from "../components/StrengthTiles";
import UpNextTiles from "../components/UpNextTiles";
import { setupReminder } from "../lib/set-notes";
import { storedRate } from "../lib/voice";
import { weightStepFor } from "../lib/weight-step";
import { fetchSessions } from "../lib/api";
import {
  formatMMSS,
  initTimer,
  isFirstStepCursor,
  selectCurrentStep,
  selectElapsedSec,
  selectIsHolding,
  selectNextStep,
  selectCanDeferCurrent,
  selectCanDeferNext,
  selectRemainingSec,
  selectStepElapsedSec,
  timerReducer,
  type FlatSession,
  type Step,
} from "../lib/timer";
import { flattenBlocksToSteps, nextExerciseFor } from "../lib/steps";
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
  lastShownFor,
  loggedCountFor,
  restAutoContinues,
  nextSetNumFor,
  totalSetsFor,
  type SessionSets,
  type ServerLoggedCount,
  type SetEntry,
} from "../lib/log-state";
import { useMediaQuery } from "../lib/use-media";
import { useSwipe } from "../lib/use-swipe";
import type { LoadConfigByClass, LastLoggedEntry, Plan, PlannedExercise, SessionDayRow } from "../lib/types";
import JourneyMap from "../components/JourneyMap";
import InlineExerciseLogger from "../components/InlineExerciseLogger";
import { exerciseTags } from "../lib/adjustment";
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

  // GD-STRENGTH-CUES: prior sessions, for the spoken "your last sets averaged".
  // /sessions already exists and already returns per-set rows, so this needs no
  // API change — and /last_logged, the "Last:" hint and the stepper prefill are
  // deliberately untouched: the top set is the right thing to prefill against.
  const todayISO = plan.plan_date;
  const [priorDays, setPriorDays] = useState<SessionDayRow[]>([]);
  const spokenForRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    let live = true;
    void fetchSessions(30).then((r) => {
      if (live && r.status === "ok") setPriorDays(r.data.days ?? []);
    });
    return () => { live = false; };
  }, []);
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
  // GD-DEFER: "Busy — later" on this exercise, or on the rest's "Next:".
  const canDeferCurrent = selectCanDeferCurrent(state);
  const canDeferNext = selectCanDeferNext(state);
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

  // GD-REST-AUTOCONTINUE: a logging rest that has run out and whose set is
  // already entered advances itself — hands are on the weight, not the iPad.
  // An unlogged rest still holds. Paused stays paused.
  useEffect(() => {
    if (!holding || state.status !== "running") return;
    if (!restAutoContinues(current, state.cursor.currentRound, sessionSets, serverLoggedCount)) {
      return;
    }
    suppressIndexAudioRef.current = true;
    dispatch({ type: "NEXT_STEP", now_ms: performance.now() });
  }, [holding, state.status, current, state.cursor.currentRound, sessionSets,
      serverLoggedCount]);

  // GD-STRENGTH-CUES: one spoken prompt per exercise per ROUND (GD-ROUND-CUES,
  // 2026-09-23), at the START of the rest period that precedes it. Not between
  // sets of the same exercise, and not before the first — there is no rest to
  // say it in. The beeps are untouched; this rides alongside them.
  useEffect(() => {
    const target = promptTarget(state.steps, state.cursor.stepIndex,
                                spokenForRef.current, state.cursor.currentRound);
    if (!target) return;
    const { exercise: ex, restSec, key } = target;
    const average = lastSessionAverage(priorDays, ex.name, todayISO);
    const text = exercisePrompt({
      name: ex.name,
      reps: ex.format === "reps" ? ex.target_reps ?? null : null,
      cap: ex.rpe_cap ?? plan.blocks?.rpe_cap ?? plan.target_rpe ?? null,
      bodyweight: isBodyweight(ex, plan.blocks?.load_config),
      average,
    });
    // A rest too short to finish the sentence gets no prompt at all, rather
    // than a voice still talking when the next set starts.
    if (!fitsInRest(text, restSec, storedRate())) return;
    spokenForRef.current.add(key);
    speak(text);
  }, [state.cursor.stepIndex, state.cursor.currentRound, state.steps, priorDays,
      todayISO, plan]);

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
  function deferCurrent() {
    haptic();
    suppressIndexAudioRef.current = true;
    dispatch({ type: "DEFER_CURRENT", now_ms: performance.now() });
  }
  function deferNext() {
    haptic();
    dispatch({ type: "DEFER_NEXT" });
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

  // GD-DISTANCE: during an active set the journey map steps aside (landscape
  // only — see workout.css) and the pane takes the full width, so the tiles,
  // sized from the pane width, grow. It comes back for rest, warmup and
  // cooldown. "Active set" is exactly an exercise step in glance density —
  // the logging rest is its own density.
  const activeSet = density === "glance" && current.kind === "exercise";

  const containerClass =
    `workout ${flashCountdown ? "tint--countdown" : TINT_CLASS[current.kind]}` +
    (isPaused ? " workout--paused" : "") +
    (stacked ? " workout--stacked" : "") +
    (activeSet ? " workout--set" : "");

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
          deferred={state.deferred}
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
                upNextExercise={nextExerciseFor(state.steps, state.cursor.stepIndex,
                                                state.cursor.currentRound)}
                setNum={restEntryRef.current.setNum}
                sessionSets={sessionSets}
                serverLoggedCount={serverLoggedCount}
                lastLogged={lastLogged}
                isFinisher={current.circuitId === "finisher"}
                onLoggedSet={onLoggedSet}
                onNext={nextStep}
                onDeferNext={canDeferNext === "yes" ? deferNext : null}
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
                upNextExercise={nextExerciseFor(state.steps, state.cursor.stepIndex,
                                                state.cursor.currentRound)}
              />
            )}
          </div>
        </main>
      </div>

      {/* GD-DISTANCE: outside the pane, spanning the full width in every
          mode. Inside the pane it followed the pane's width, so hiding the
          journey map for a set moved every button — Pause jumped from
          x 251–474 to 627–802 at the set/rest boundary, under the thumb.
          The row is also FIVE FIXED SLOTS (Prev · Pause · Skip · Busy · More):
          a control that doesn't apply leaves its slot empty rather than
          letting its neighbours slide over. */}
      <div className="workout-actions" data-testid="workout-actions">
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
        {density === "glance" && canDeferCurrent === "last" && current?.exerciseRef
          && state.deferred.includes(current.exerciseRef.name) && (
          <div className="defer-hint" data-testid="defer-hint">
            Last one this round — Skip if it stays busy
          </div>
        )}
        <div className="workout-controls">
          <button type="button" className="btn" onClick={prevStep} disabled={isFirstStepCursor(state)} aria-label="Previous step">
            ◀ Prev
          </button>
          {density === "log" || strengthSet ? (
            <button type="button" className="btn" onClick={togglePause} aria-label={isPaused ? "Resume" : "Pause"}>
              {isPaused ? "▶ Resume" : "⏸ Pause"}
            </button>
          ) : <span className="workout-slot" aria-hidden="true" />}
          <button type="button" className="btn" onClick={nextStep} aria-label="Skip to next">
            {density === "log" ? "Skip rest ▶" : "Skip ▶"}
          </button>
          {density === "glance" && canDeferCurrent === "yes" ? (
            <button type="button" className="btn btn--defer" onClick={deferCurrent}
                    data-testid="defer-current" aria-label="Machine busy — do the next exercise first">
              Busy — later
            </button>
          ) : <span className="workout-slot" aria-hidden="true" />}
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

/** No load stepper at all → the spoken prompt leaves the weight out.
 * LOCATION-1: bands and TRX at the farm are "no load" too, per the row. */
function isBodyweight(ex: PlannedExercise, loadConfig?: LoadConfigByClass | null): boolean {
  try {
    return weightStepFor(ex, loadConfig).isBodyweight;
  } catch {
    return false;
  }
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
  upNextExercise,
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
  /** GD-REST-TILES: what a rest leads into. Null on the final rest. */
  upNextExercise: PlannedExercise | null;
}) {
  if (step.kind === "warmup" || step.kind === "cooldown") {
    return (
      <>
        <div className="glance-set">{step.kind === "warmup" ? "Warmup" : "Cool down"}</div>
        <div className="glance-time mono" data-testid="glance-time" data-mode="rest">{formatMMSS(remaining)}</div>
        {step.label && <div className="glance-desc">{step.label}</div>}
      </>
    );
  }
  if (step.kind === "rest") {
    // GD-REST-TILES: a between-rounds rest shows the first exercise of the
    // round that follows; the final one shows nothing (upNextExercise null).
    return (
      <>
        <div className="glance-set">{step.isRoundBreak ? "Between rounds" : "Rest"}</div>
        <div className="glance-time mono" data-testid="glance-time" data-mode="rest">{formatMMSS(remaining)}</div>
        {step.label && step.label !== "Rest" && <div className="glance-desc">{step.label}</div>}
        <UpNextTiles plan={plan} exercise={upNextExercise}
                     sessionSets={sessionSets} lastLogged={lastLogged} />
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
  const tags = ex ? exerciseTags(ex, plan.blocks?.rpe_cap ?? null) : [];
  // GD-LAST-ROUND: today's logged sets outrank the previous session.
  const shown = isPlanExercise ? lastShownFor(name, sessionSets, lastLogged) : null;
  const last = shown?.entry ?? null;
  const openEnded = !!step.holdAtEnd;
  const capForHint = ex?.rpe_cap ?? plan.blocks?.rpe_cap ?? plan.target_rpe ?? null;
  const repsLeft = repsLeftHint(capForHint);

  // GD-DISTANCE: a strength (reps) set gets the distance layout — three tiles
  // across the top, then SET x OF y and the name, then a half-size timer.
  // The old "Last:" line and the "2×10-12" notes line are gone from this
  // screen: reps, sets and the last set now live in the tiles.
  if (ex?.format === "reps") {
    return (
      <div className="glance-strength" data-mode="set" data-testid="glance-strength">
        <StrengthTiles reps={ex.target_reps ?? null} cap={capForHint} last={last}
                       lastRound={shown?.round ?? null} />
        {setLabel && <div className="glance-set">{setLabel}</div>}
        <div className="glance-name">{name}</div>
        {tags.length > 0 && <div className="glance-target glance-adjusted">{tags.join(" · ")}</div>}
        <div className="glance-time glance-time--set mono" data-testid="glance-time"
             aria-label={openEnded ? "Set time" : "Time remaining"}>
          {formatMMSS(openEnded ? stepElapsed : remaining)}
        </div>
      </div>
    );
  }

  // Timed exercises (planks, holds, steady cardio) keep the existing layout:
  // there are no reps to put in a tile.
  return (
    <>
      {setLabel && <div className="glance-set">{setLabel}</div>}
      <div className="glance-name">{name}</div>
      {/* Steady cardio carries the intensity as its step label. */}
      {step.label !== name && <div className="glance-target">{step.label}</div>}
      {(reps || load || capForHint != null) && (
        <div className="glance-target" data-testid="glance-target-block">
          {[reps, load, capForHint != null ? `RPE ${capForHint}` : null]
            .filter(Boolean).join("  ·  ")}
        </div>
      )}
      {repsLeft && <div className="glance-repsleft dim" data-testid="glance-reps-left">{repsLeft}</div>}
      {tags.length > 0 && <div className="glance-target glance-adjusted">{tags.join(" · ")}</div>}
      <div className="glance-time mono" data-testid="glance-time"
           aria-label={openEnded ? "Set time" : "Time remaining"}>
        {formatMMSS(openEnded ? stepElapsed : remaining)}
      </div>
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
  upNextExercise,
  setNum,
  sessionSets,
  serverLoggedCount,
  lastLogged,
  isFinisher,
  onLoggedSet,
  onNext,
  onDeferNext,
}: {
  plan: Plan;
  exerciseName: string;
  remaining: number;
  holding: boolean;
  upNextLabel: string | null;
  /** GD-REST-TILES: the exercise this rest leads into — null on the final rest. */
  upNextExercise: PlannedExercise | null;
  setNum: number;
  sessionSets: SessionSets;
  serverLoggedCount: ServerLoggedCount;
  lastLogged: Record<string, LastLoggedEntry>;
  isFinisher: boolean;
  onLoggedSet: (exerciseName: string, set: SetEntry) => void;
  onNext: () => void;
  /** GD-DEFER: the next exercise's machine is busy — swap it with the one after. */
  onDeferNext: (() => void) | null;
}) {
  const exercise = findExercise(plan, exerciseName);
  const total = totalSetsFor(plan, exerciseName);
  const logged = loggedCountFor(exerciseName, sessionSets, serverLoggedCount);
  const thisSetLogged = logged >= setNum;
  const lastHint = lastLogged[exerciseName] ?? null;

  return (
    <>
      <div className={`restlog-timer${holding ? " restlog-timer--over" : ""}`}>
        <div className="restlog-timer-main">
          <span className="restlog-label">{holding ? "Rest over" : "Rest"}</span>
          <span className="restlog-time mono">{formatMMSS(remaining)}</span>
          {/* GD-REST-TILES: the name moved into the tiles; this stays only when
              there are no tiles to carry it (a rest with nothing after it). */}
          {upNextLabel && !upNextExercise
            && <span className="restlog-next">Next: {upNextLabel}</span>}
          {onDeferNext && (
            <button type="button" className="btn btn--defer restlog-defer" onClick={onDeferNext}
                    data-testid="defer-next" aria-label={`${upNextLabel} busy — do the one after first`}>
              Busy — later
            </button>
          )}
        </div>
        <UpNextTiles plan={plan} exercise={upNextExercise}
                     sessionSets={sessionSets} lastLogged={lastLogged} />
      </div>
      {/* GD-DISTANCE: exercise notes moved here from the active set. This is
          where "log seat + pin setting" is useful — you're entering them. */}
      {/* GD-REST-TILES: the prescription is in the tiles and on the logger
          card; what is worth repeating here is the setup reminder. */}
      {setupReminder(exercise?.notes) && (
        <div className="restlog-note" data-testid="restlog-note">
          {setupReminder(exercise?.notes)}
        </div>
      )}
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
          loadConfig={plan.blocks?.load_config}
          week_num={plan.week_num}
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
            exercise.load_from != null,
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
