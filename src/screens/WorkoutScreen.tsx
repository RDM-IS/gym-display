import { useEffect, useReducer, useRef, useState } from "react";
import {
  formatMMSS,
  initTimer,
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
}

export default function WorkoutScreen({ intervals, onDone }: Props) {
  const [state, dispatch] = useReducer(timerReducer, intervals, initTimer);
  const [now, setNow] = useState(() => performance.now());
  const [muted, setMuted] = useState(isMuted());
  const lastIndexRef = useRef(0);
  const lastBeepSecRef = useRef<number | null>(null);
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

  useEffect(() => {
    let raf = 0;
    function tick() {
      const t = performance.now();
      setNow(t);
      dispatch({ type: "TICK", now_ms: t });
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "m" || e.key === "M") {
        const next = toggleMuted();
        setMuted(next);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const current = selectCurrent(state);
  const upNext = selectNext(state);
  const remaining = selectRemainingSec(state, now);
  const elapsed = selectElapsedSec(state, now);

  // Audio: end-of-interval cues fire when current_index changes
  useEffect(() => {
    if (state.current_index === lastIndexRef.current) return;
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
    lastIndexRef.current = state.current_index;
    lastBeepSecRef.current = null;
  }, [state.current_index, state.intervals]);

  // Audio: 3-2-1 countdown beeps
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

  if (!current) return null;

  const flashCountdown = state.status === "running" && Math.ceil(remaining) <= 3 && remaining > 0;
  const containerClass = `workout ${flashCountdown ? "tv--countdown" : KIND_CLASS[current.kind]}`;

  return (
    <div className={containerClass} style={{ transition: "background-color 200ms ease" }}>
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
      </div>

      <div className="workout-bottom">
        {upNext ? `Up next: ${upNext.name}` : "Last interval"}
      </div>

      {muted && <div className="muted-badge">Muted</div>}
    </div>
  );
}
