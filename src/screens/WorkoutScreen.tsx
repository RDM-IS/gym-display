import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  formatMMSS,
  initTimer,
  isFirstStepCursor,
  selectCurrentStep,
  selectElapsedSec,
  selectNextStep,
  selectRemainingSec,
  selectStepAfterNext,
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
  initAudio,
  isMuted,
  toggleMuted,
} from "../lib/audio";
import { acquireWakeLock, releaseWakeLock } from "../lib/wake-lock";
import { fetchLastLogged, fetchLoggedToday } from "../lib/api";
import type { LastLoggedEntry, Plan, PlannedExercise } from "../lib/types";
import JourneyMap from "../components/JourneyMap";
import InlineExerciseLogger from "../components/InlineExerciseLogger";
import LogPanel from "./LogPanel";

const TINT_CLASS: Record<Step["kind"], string> = {
  warmup: "tv--warmup",
  exercise: "tv--work",
  rest: "tv--rest",
  cooldown: "tv--cooldown",
};

interface Props {
  plan: Plan;
  onDone: (total_elapsed_sec: number) => void;
  onBackToHome: () => void;
}

type Mode = "timer" | "log";

export default function WorkoutScreen({ plan, onDone, onBackToHome }: Props) {
  const session: FlatSession = useMemo(() => flattenBlocksToSteps(plan.blocks), [plan]);
  const [state, dispatch] = useReducer(timerReducer, session, initTimer);
  const [now, setNow] = useState(() => performance.now());
  const [muted, setMuted] = useState(isMuted());
  const [mode, setMode] = useState<Mode>("timer");

  // Shared logging state — both the InlineExerciseLogger (in a rest step)
  // and the LogPanel overlay read and write through here so changes
  // propagate. Hydrated from /today/logged on mount.
  const [loggedExercises, setLoggedExercises] = useState<Set<string>>(new Set());
  const [lastLogged, setLastLogged] = useState<Record<string, LastLoggedEntry>>({});
  const [logHasSummary, setLogHasSummary] = useState(false);

  const lastIndexRef = useRef(0);
  const lastBeepSecRef = useRef<number | null>(null);
  const suppressIndexAudioRef = useRef(false);
  const doneFiredRef = useRef(false);

  useEffect(() => {
    initAudio();
    void acquireWakeLock();
    dispatch({ type: "START", now_ms: performance.now() });
    function onVis() {
      if (document.visibilityState === "visible") void acquireWakeLock();
    }
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      void releaseWakeLock();
    };
  }, []);

  // Hydrate shared logging state.
  useEffect(() => {
    let cancelled = false;
    const names = collectExerciseNames(plan);
    (async () => {
      const [loggedR, lastR] = await Promise.all([
        fetchLoggedToday(),
        fetchLastLogged(names),
      ]);
      if (cancelled) return;
      if (loggedR.status === "ok") {
        setLoggedExercises(new Set(loggedR.data.exercises.map((e) => e.exercise)));
        setLogHasSummary(loggedR.data.has_session_summary);
      }
      if (lastR.status === "ok") {
        setLastLogged(lastR.data.by_exercise);
      }
    })();
    return () => { cancelled = true; };
  }, [plan]);

  // Ticker — setInterval keeps running when tab is hidden.
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
  const afterNext = selectStepAfterNext(state);
  const remaining = selectRemainingSec(state, now);
  const elapsed = selectElapsedSec(state, now);

  // Audio: end-of-prev-step cue on cursor change.
  useEffect(() => {
    if (state.cursor.stepIndex === lastIndexRef.current) return;
    if (!suppressIndexAudioRef.current) {
      const prev = state.steps[lastIndexRef.current];
      if (prev) {
        if (prev.kind === "exercise" || prev.kind === "warmup") {
          beepEndOfWork();
        } else if (prev.kind === "rest") {
          if (prev.isRoundBreak) beepEndOfRound();
          else beepEndOfRest();
        }
        // cooldown end is implicit (workout-end beep fires separately)
      }
    }
    suppressIndexAudioRef.current = false;
    lastIndexRef.current = state.cursor.stepIndex;
  }, [state.cursor.stepIndex, state.steps]);

  useEffect(() => {
    lastBeepSecRef.current = null;
  }, [state.step_started_at_ms]);

  // 3-2-1 countdown.
  useEffect(() => {
    if (state.status !== "running") return;
    const sec = Math.ceil(remaining);
    if (sec >= 1 && sec <= 3 && lastBeepSecRef.current !== sec) {
      lastBeepSecRef.current = sec;
      beepCountdown();
    }
  }, [remaining, state.status]);

  // End of workout.
  useEffect(() => {
    if (state.status === "done" && !doneFiredRef.current) {
      doneFiredRef.current = true;
      beepEndOfWorkout();
      onDone(elapsed);
    }
  }, [state.status, elapsed, onDone]);

  const isPaused = state.status === "paused";

  // ── Actions ────────────────────────────────────────────────────────────
  function togglePause() {
    if (state.status === "running") {
      dispatch({ type: "PAUSE", now_ms: performance.now() });
    } else if (state.status === "paused") {
      dispatch({ type: "RESUME", now_ms: performance.now() });
    }
  }
  function restartStep() { dispatch({ type: "RESTART_STEP", now_ms: performance.now() }); }
  function prevStep() {
    suppressIndexAudioRef.current = true;
    dispatch({ type: "PREV_STEP", now_ms: performance.now() });
  }
  function nextStep() { dispatch({ type: "NEXT_STEP", now_ms: performance.now() }); }
  function restartWorkout() {
    suppressIndexAudioRef.current = true;
    dispatch({ type: "RESTART_WORKOUT", now_ms: performance.now() });
  }
  function endWorkout() {
    suppressIndexAudioRef.current = true;
    dispatch({ type: "END_WORKOUT" });
  }

  // ── Keyboard ───────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case " ": e.preventDefault(); togglePause(); return;
        case "ArrowRight": case "n": case "N": e.preventDefault(); nextStep(); return;
        case "ArrowLeft": case "p": case "P": e.preventDefault(); prevStep(); return;
        case "r": e.preventDefault(); restartStep(); return;
        case "R": e.preventDefault(); restartWorkout(); return;
        case "e": case "E": e.preventDefault(); endWorkout(); return;
        case "h": case "H": e.preventDefault(); onBackToHome(); return;
        case "m": case "M": setMuted(toggleMuted()); return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status, onBackToHome]);

  const handleLogged = useCallback((exerciseName: string) => {
    setLoggedExercises((prev) => {
      if (prev.has(exerciseName)) return prev;
      const next = new Set(prev);
      next.add(exerciseName);
      return next;
    });
  }, []);

  if (!current) return null;

  const flashCountdown =
    state.status === "running" && Math.ceil(remaining) <= 3 && remaining > 0;
  const containerClass = `workout-v2 ${
    flashCountdown ? "tv--countdown" : TINT_CLASS[current.kind]
  } ${isPaused ? "workout--paused" : ""}`;

  const inCircuit = !!current.circuitId && !!current.totalRounds && current.totalRounds > 1;
  const roundLabel = inCircuit
    ? `Round ${state.cursor.currentRound} of ${current.totalRounds}`
    : current.kind.toUpperCase();

  // Find the rounds for the InlineExerciseLogger when a rest is active.
  // We log the just-finished exercise — its full N rounds at once, as
  // the rest of the LogPanel does.
  const restExercise = current.kind === "rest" ? current.precedingExerciseRef ?? null : null;
  const restExerciseLastLogged = restExercise ? lastLogged[restExercise.name] ?? null : null;
  const restCircuitTotal = inCircuit ? current.totalRounds ?? 1 : 1;

  return (
    <div className={containerClass}>
      <div className="workout-v2-grid">
        <main className="workout-v2-main">
          <div className="workout-top">
            <div>{roundLabel}</div>
            <div className="tv-mono">Total {formatMMSS(elapsed)}</div>
          </div>

          <div className="workout-center">
            {current.kind === "exercise" && (
              <ExerciseMain
                step={current}
                remaining={remaining}
                lastLogged={current.exerciseRef ? lastLogged[current.exerciseRef.name] ?? null : null}
                isPaused={isPaused}
              />
            )}
            {current.kind === "rest" && (
              <RestMain
                remaining={remaining}
                restExercise={restExercise}
                planId={plan.plan_id}
                rounds={restCircuitTotal}
                last={restExerciseLastLogged}
                alreadyLogged={!!restExercise && loggedExercises.has(restExercise.name)}
                isFinisher={current.circuitId === "finisher"}
                onLogged={handleLogged}
              />
            )}
            {(current.kind === "warmup" || current.kind === "cooldown") && (
              <WarmupCooldownMain step={current} remaining={remaining} isPaused={isPaused} />
            )}
            {isPaused && <div className="paused-badge">Paused</div>}
          </div>

          <div className="workout-v2-footer">
            <FooterPair label="Next" step={upNext} />
            <FooterPair label="Followed by" step={afterNext} />
          </div>

          <div className="controls">
            <button className="control-btn" onClick={prevStep} disabled={isFirstStepCursor(state)} aria-label="Previous step">◀ Prev</button>
            <button className="control-btn" onClick={restartStep} aria-label="Restart step">↻ Restart</button>
            <button
              className="control-btn control-btn--primary"
              onClick={togglePause}
              aria-label={isPaused ? "Resume" : "Pause"}
            >
              {isPaused ? "▶ Resume" : "⏸ Pause"}
            </button>
            <button className="control-btn" onClick={nextStep} aria-label="Skip to next">Skip ▶</button>
            <div className="control-spacer" />
            <button className="control-btn" onClick={restartWorkout} aria-label="Restart workout">⟲ Restart workout</button>
            <button className="control-btn control-btn--danger" onClick={endWorkout} aria-label="End workout">End</button>
            <button className="control-btn" onClick={onBackToHome} aria-label="Back to home">⌂ Home</button>
            <button
              className="control-btn control-btn--primary"
              onClick={() => setMode("log")}
              aria-label="Open log panel"
            >
              ✎ Log
            </button>
          </div>
        </main>

        <JourneyMap
          steps={state.steps}
          sections={state.sections}
          cursor={state.cursor}
          loggedExercises={loggedExercises}
        />
      </div>

      {muted && <div className="muted-badge">Muted</div>}

      {mode === "log" && (
        <LogPanel
          plan={plan}
          elapsed_sec={elapsed}
          loggedExercises={loggedExercises}
          lastLogged={lastLogged}
          hasSummary={logHasSummary}
          onLogged={handleLogged}
          onSummaryLogged={() => setLogHasSummary(true)}
          onBackToTimer={() => setMode("timer")}
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

function ExerciseMain({
  step,
  remaining,
  lastLogged,
  isPaused,
}: {
  step: Step;
  remaining: number;
  lastLogged: LastLoggedEntry | null;
  isPaused: boolean;
}) {
  const ex = step.exerciseRef;
  return (
    <>
      <div className="workout-name">{step.label}</div>
      {ex?.format === "reps" && ex.target_reps != null && (
        <div className="workout-reps">{ex.target_reps} reps</div>
      )}
      <div className="workout-time tv-mono">{formatMMSS(remaining)}</div>
      {ex?.target_load_lbs != null && (
        <div className="workout-desc">~{ex.target_load_lbs} lb</div>
      )}
      {lastLogged && (
        <div className="workout-prev tv-mono">
          Previous:
          {lastLogged.weight_lbs != null && ` ${formatNum(lastLogged.weight_lbs)} lb`}
          {lastLogged.reps_done != null && ` × ${lastLogged.reps_done}`}
          {lastLogged.rpe_actual != null && ` @ RPE ${formatNum(lastLogged.rpe_actual)}`}
        </div>
      )}
      {!isPaused && step.exerciseRef?.notes && (
        <div className="workout-desc">{step.exerciseRef.notes}</div>
      )}
    </>
  );
}

function RestMain({
  remaining,
  restExercise,
  planId,
  rounds,
  last,
  alreadyLogged,
  isFinisher,
  onLogged,
}: {
  remaining: number;
  restExercise: PlannedExercise | null;
  planId: number;
  rounds: number;
  last: LastLoggedEntry | null;
  alreadyLogged: boolean;
  isFinisher: boolean;
  onLogged: (exerciseName: string) => void;
}) {
  return (
    <>
      <div className="workout-name">REST</div>
      <div className="workout-time tv-mono">{formatMMSS(remaining)}</div>
      {restExercise && (
        <div className="workout-rest-logger">
          <div className="workout-rest-label">Log just-finished</div>
          <InlineExerciseLogger
            exercise={restExercise}
            plan_id={planId}
            rounds={rounds}
            last={last}
            alreadyLogged={alreadyLogged}
            isFinisher={isFinisher}
            onLogged={onLogged}
          />
        </div>
      )}
    </>
  );
}

function WarmupCooldownMain({
  step,
  remaining,
  isPaused,
}: {
  step: Step;
  remaining: number;
  isPaused: boolean;
}) {
  return (
    <>
      <div className="workout-name">{step.kind === "warmup" ? "WARMUP" : "COOL DOWN"}</div>
      <div className="workout-time tv-mono">{formatMMSS(remaining)}</div>
      {step.label && <div className="workout-desc">{step.label}</div>}
      {isPaused && <div className="paused-badge">Paused</div>}
    </>
  );
}

function FooterPair({ label, step }: { label: string; step: Step | null }) {
  return (
    <div className="footer-pair">
      <div className="footer-pair-label">{label}</div>
      <div className="footer-pair-value">{step ? step.label : "—"}</div>
    </div>
  );
}

function formatNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}
