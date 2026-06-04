import { useEffect, useReducer, useRef, useState } from "react";
import {
  formatMMSS,
  initTimer,
  isFirstInterval,
  selectCurrent,
  selectElapsedSec,
  selectNext,
  selectRemainingSec,
  timerReducer,
} from "../lib/timer";
import type { Interval, IntervalKind } from "../lib/types";
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

const KIND_CLASS: Record<IntervalKind, string> = {
  warmup: "tv--warmup",
  work: "tv--work",
  rest: "tv--rest",
  round_break: "tv--round-break",
  cooldown: "tv--cooldown",
};

interface Props {
  intervals: Interval[];
  onDone: (total_elapsed_sec: number) => void;
  onBackToHome: () => void;
}

export default function WorkoutScreen({ intervals, onDone, onBackToHome }: Props) {
  const [state, dispatch] = useReducer(timerReducer, intervals, initTimer);
  const [now, setNow] = useState(() => performance.now());
  const [muted, setMuted] = useState(isMuted());
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

  // Ticker — setInterval so it survives background-tab throttling (rAF gets paused).
  // 100ms gives smooth seconds; performance.now() drives actual timing accuracy.
  useEffect(() => {
    if (state.status !== "running") return;
    const id = window.setInterval(() => {
      const t = performance.now();
      setNow(t);
      dispatch({ type: "TICK", now_ms: t });
    }, 100);
    return () => window.clearInterval(id);
  }, [state.status]);

  const current = selectCurrent(state);
  const upNext = selectNext(state);
  const remaining = selectRemainingSec(state, now);
  const elapsed = selectElapsedSec(state, now);

  // Audio: end-of-prev-interval cue on index change (unless suppressed)
  useEffect(() => {
    if (state.current_index === lastIndexRef.current) return;
    if (!suppressIndexAudioRef.current) {
      const prev = state.intervals[lastIndexRef.current];
      if (prev) {
        switch (prev.kind) {
          case "warmup":
          case "work":
            beepEndOfWork();
            break;
          case "rest":
            beepEndOfRest();
            break;
          case "round_break":
            beepEndOfRound();
            break;
          case "cooldown":
            break;
        }
      }
    }
    suppressIndexAudioRef.current = false;
    lastIndexRef.current = state.current_index;
  }, [state.current_index, state.intervals]);

  // Reset countdown-beep ref whenever the current interval restarts (any cause)
  useEffect(() => {
    lastBeepSecRef.current = null;
  }, [state.interval_started_at_ms]);

  // Audio: 3-2-1 countdown
  useEffect(() => {
    if (state.status !== "running") return;
    const sec = Math.ceil(remaining);
    if (sec >= 1 && sec <= 3 && lastBeepSecRef.current !== sec) {
      lastBeepSecRef.current = sec;
      beepCountdown();
    }
  }, [remaining, state.status]);

  // End of workout
  useEffect(() => {
    if (state.status === "done" && !doneFiredRef.current) {
      doneFiredRef.current = true;
      beepEndOfWorkout();
      onDone(elapsed);
    }
  }, [state.status, elapsed, onDone]);

  // Action helpers
  const isPaused = state.status === "paused";

  function togglePause() {
    if (state.status === "running") {
      dispatch({ type: "PAUSE", now_ms: performance.now() });
    } else if (state.status === "paused") {
      dispatch({ type: "RESUME", now_ms: performance.now() });
    }
  }
  function restartInterval() {
    dispatch({ type: "RESTART_INTERVAL", now_ms: performance.now() });
  }
  function prevInterval() {
    // Reducer clamps at 0; no closure-state guard (would go stale inside the keyboard handler).
    suppressIndexAudioRef.current = true;
    dispatch({ type: "PREV_INTERVAL", now_ms: performance.now() });
  }
  function nextInterval() {
    dispatch({ type: "NEXT_INTERVAL", now_ms: performance.now() });
  }
  function restartWorkout() {
    suppressIndexAudioRef.current = true;
    dispatch({ type: "RESTART_WORKOUT", now_ms: performance.now() });
  }
  function endWorkout() {
    suppressIndexAudioRef.current = true;
    dispatch({ type: "END_WORKOUT" });
  }

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case " ":
          e.preventDefault();
          togglePause();
          return;
        case "ArrowRight":
        case "n":
        case "N":
          e.preventDefault();
          nextInterval();
          return;
        case "ArrowLeft":
        case "p":
        case "P":
          e.preventDefault();
          prevInterval();
          return;
        case "r":
          e.preventDefault();
          restartInterval();
          return;
        case "R":
          e.preventDefault();
          restartWorkout();
          return;
        case "e":
        case "E":
          e.preventDefault();
          endWorkout();
          return;
        case "h":
        case "H":
          e.preventDefault();
          onBackToHome();
          return;
        case "m":
        case "M":
          setMuted(toggleMuted());
          return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status, onBackToHome]);

  if (!current) return null;

  const flashCountdown =
    state.status === "running" && Math.ceil(remaining) <= 3 && remaining > 0;
  const containerClass = `workout ${
    flashCountdown ? "tv--countdown" : KIND_CLASS[current.kind]
  } ${isPaused ? "workout--paused" : ""}`;

  return (
    <div className={containerClass}>
      <div className="workout-top">
        <div>
          {current.round && current.total_rounds
            ? `Round ${current.round} of ${current.total_rounds}`
            : current.kind.toUpperCase().replace("_", " ")}
        </div>
        <div className="tv-mono">Total {formatMMSS(elapsed)}</div>
      </div>

      <div className="workout-center">
        <div className="workout-name">{current.name}</div>
        {current.reps != null ? (
          <>
            <div className="workout-reps">{current.reps} reps</div>
            <div className="workout-time tv-mono">{formatMMSS(remaining)}</div>
          </>
        ) : (
          <div className="workout-time tv-mono">{formatMMSS(remaining)}</div>
        )}
        {current.load_lbs != null && (
          <div className="workout-desc">~{current.load_lbs} lb</div>
        )}
        {current.description && (
          <div className="workout-desc">{current.description}</div>
        )}
        {isPaused && <div className="paused-badge">Paused</div>}
      </div>

      <div className="workout-bottom">
        {upNext ? `Up next: ${upNext.name}` : "Last interval"}
      </div>

      <div className="controls">
        <button
          className="control-btn"
          onClick={prevInterval}
          disabled={isFirstInterval(state)}
          aria-label="Previous exercise"
        >
          ◀ Prev
        </button>
        <button className="control-btn" onClick={restartInterval} aria-label="Restart exercise">
          ↻ Restart
        </button>
        <button
          className="control-btn control-btn--primary"
          onClick={togglePause}
          aria-label={isPaused ? "Resume" : "Pause"}
        >
          {isPaused ? "▶ Resume" : "⏸ Pause"}
        </button>
        <button className="control-btn" onClick={nextInterval} aria-label="Skip to next">
          Skip ▶
        </button>
        <div className="control-spacer" />
        <button className="control-btn" onClick={restartWorkout} aria-label="Restart workout">
          ⟲ Restart workout
        </button>
        <button className="control-btn control-btn--danger" onClick={endWorkout} aria-label="End workout">
          End
        </button>
        <button className="control-btn" onClick={onBackToHome} aria-label="Back to home">
          ⌂ Home
        </button>
      </div>

      {muted && <div className="muted-badge">Muted</div>}
    </div>
  );
}
