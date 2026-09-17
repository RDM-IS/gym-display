import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  audioStatus,
  chimeNext,
  isMuted,
  speak,
  stopSpeech,
  subscribeAudio,
  toggleMuted,
  toneFlowDone,
  toneRound,
  toneSwitchSides,
  unlockAudio,
  unlockSpeech,
} from "../lib/audio";
import {
  DEFAULT_PREVIEW_SEC,
  buildFlowTimeline,
  flowLogNotes,
  flowTotalSec,
  formatClock,
  initialFlowState,
  previewKind,
  remainingInItemSec,
  remainingTotalSec,
  skipFlow,
  tickFlow,
  validateFlow,
  type FlowEvent,
  type FlowItem,
  type FlowState,
} from "../lib/flow";
import { submitLog } from "../lib/log-queue";
import { detectSwipe } from "../lib/use-swipe";
import { acquireWakeLock, releaseWakeLock } from "../lib/wake-lock";
import { formatPlanDate } from "../lib/format";
import type { Plan, RecoveryFlowBlocks } from "../lib/types";
import PeekButtons from "../components/PeekButtons";
import type { PeekMode } from "./PeekScreen";

interface Props {
  plan: Plan;
  /** True while the flow runs full-screen (the app hides its nav). */
  onRunningChange?: (running: boolean) => void;
  /** Tomorrow / Week — offered on the ready screen only. */
  onPeek?: (mode: PeekMode) => void;
}

const TICK_MS = 250;

type Phase = "ready" | "running" | "done";
type LogStatus = "idle" | "ok" | "queued" | "error";

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** YOGA-1 Recovery Flow — one Start tap, then hands-free: every hold
 * auto-advances with a 5 s preview, a Switch sides screen between R and L,
 * voice cues, and automatic complete / partial logging. Tap to pause, swipe
 * to skip — both optional. */
export default function FlowScreen({ plan, onRunningChange, onPeek }: Props) {
  const blocks = plan.blocks as RecoveryFlowBlocks;
  const items = useMemo(() => buildFlowTimeline(blocks), [blocks]);
  const errors = useMemo(() => validateFlow(blocks), [blocks]);
  const totalSec = useMemo(() => flowTotalSec(blocks), [blocks]);
  const previewSec = blocks.preview_sec ?? DEFAULT_PREVIEW_SEC;

  const [phase, setPhase] = useState<Phase>("ready");
  const [state, setState] = useState<FlowState>(initialFlowState);
  const [logStatus, setLogStatus] = useState<LogStatus>("idle");
  const audio = useSyncExternalStore(subscribeAudio, audioStatus, audioStatus);

  const stateRef = useRef(state);
  const phaseRef = useRef(phase);
  const lastRef = useRef(0);
  const autoPausedRef = useRef(false);
  const partialLoggedRef = useRef(false);
  const completeLoggedRef = useRef(false);
  const pointerRef = useRef<{ x: number; y: number; t: number; id: number } | null>(null);

  const commit = useCallback((s: FlowState) => {
    stateRef.current = s;
    setState(s);
  }, []);

  useEffect(() => {
    phaseRef.current = phase;
    onRunningChange?.(phase === "running");
  }, [phase, onRunningChange]);

  const log = useCallback(
    async (kind: "complete" | "partial", keepalive: boolean) => {
      const s = stateRef.current;
      const body = {
        plan_id: plan.plan_id,
        exercise: null,
        log_type: "session_summary" as const,
        sets: [{
          duration_sec: Math.round(s.elapsedMs / 1000),
          notes: flowLogNotes(kind, s.elapsedMs, totalSec),
          is_skipped: false,
        }],
      };
      const r = await submitLog(body, { keepalive });
      if (kind === "complete") setLogStatus(r.status === "error" ? "error" : r.status);
    },
    [plan.plan_id, totalSec],
  );

  const handleEvents = useCallback(
    (events: FlowEvent[]) => {
      for (const e of events) {
        if (e.type === "enter") {
          speak(items[e.index].speech);
        } else if (e.type === "preview") {
          const next = items[e.next];
          if (e.kind === "switch") {
            toneSwitchSides();
            speak("Switch sides");
          } else if (e.kind === "round") {
            toneRound();
            speak(`Round ${next.round}`);
          } else {
            chimeNext();
          }
        } else if (e.type === "done") {
          toneFlowDone();
          speak("Flow complete");
          setPhase("done");
          void releaseWakeLock();
          if (!completeLoggedRef.current) {
            completeLoggedRef.current = true;
            void log("complete", false);
          }
        }
      }
    },
    [items, log],
  );

  // The clock: elapsed wall time, applied in ticks. Paused time never counts.
  useEffect(() => {
    if (phase !== "running") return;
    lastRef.current = now();
    const id = window.setInterval(() => {
      const t = now();
      const dt = t - lastRef.current;
      lastRef.current = t;
      const { state: next, events } = tickFlow(items, stateRef.current, dt, previewSec);
      if (next !== stateRef.current) commit(next);
      if (events.length) handleEvents(events);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [phase, items, previewSec, commit, handleEvents]);

  // Closing or backgrounding mid-flow logs a partial and pauses; coming back
  // resumes on its own.
  useEffect(() => {
    function away() {
      if (phaseRef.current !== "running") return;
      const s = stateRef.current;
      if (s.done) return;
      if (!partialLoggedRef.current && s.elapsedMs >= 1000) {
        partialLoggedRef.current = true;
        void log("partial", true);
      }
      if (!s.paused) {
        autoPausedRef.current = true;
        commit({ ...s, paused: true });
        stopSpeech();
      }
    }
    function back() {
      if (phaseRef.current !== "running" || !autoPausedRef.current) return;
      autoPausedRef.current = false;
      lastRef.current = now();
      commit({ ...stateRef.current, paused: false });
    }
    function onVisibility() {
      if (document.visibilityState === "hidden") away();
      else back();
    }
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", away);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", away);
    };
  }, [commit, log]);

  useEffect(() => () => {
    stopSpeech();
    void releaseWakeLock();
  }, []);

  function start() {
    // Inside the tap: iOS unlocks audio, speech and the wake lock only here.
    void unlockAudio();
    unlockSpeech();
    void acquireWakeLock();
    const s = initialFlowState();
    commit(s);
    setPhase("running");
    speak(items[0].speech);
  }

  function togglePause() {
    const s = stateRef.current;
    if (s.done) return;
    autoPausedRef.current = false;
    lastRef.current = now();
    if (!s.paused) stopSpeech();
    commit({ ...s, paused: !s.paused });
  }

  function skip(dir: 1 | -1) {
    const { state: next, events } = skipFlow(items, stateRef.current, dir);
    lastRef.current = now();
    commit(next);
    handleEvents(events);
  }

  function onPointerDown(e: ReactPointerEvent<HTMLElement>) {
    if ((e.target as HTMLElement).closest?.("[data-no-swipe]")) {
      pointerRef.current = null;
      return;
    }
    pointerRef.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId };
  }

  function onPointerUp(e: ReactPointerEvent<HTMLElement>) {
    const p = pointerRef.current;
    pointerRef.current = null;
    if (!p || p.id !== e.pointerId) return;
    const dx = Number.isFinite(e.clientX - p.x) ? e.clientX - p.x : 0;
    const dy = Number.isFinite(e.clientY - p.y) ? e.clientY - p.y : 0;
    const dir = detectSwipe(dx, dy, e.timeStamp - p.t);
    if (dir) skip(dir === "left" ? 1 : -1);
    else if (Math.abs(dx) < 20 && Math.abs(dy) < 20) togglePause();
  }

  if (errors.length > 0) {
    return (
      <div className="screen screen--center" data-testid="flow-invalid">
        <div className="h1">Recovery Flow can't run</div>
        <div className="h2 dim">The plan failed the side check:</div>
        <ul className="list">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
      </div>
    );
  }

  if (phase === "ready") {
    return (
      <div className="screen flow-ready" data-testid="flow-ready">
        <div className="meta">{formatPlanDate(plan)}</div>
        <div className="h1">{blocks.display_name || "Recovery Flow"}</div>
        <div className="h2 dim">
          {formatClock(totalSec)} · {blocks.rounds} rounds
          {blocks.location ? ` · ${blocks.location}` : ""}
        </div>
        <ol className="flow-list">
          {items.filter((i) => i.kind !== "pose" || i.round === 1).map((i, n) => (
            <li key={n}>
              <span>{i.title}</span>
              <span className="mono dim">{formatClock(i.duration_sec)}</span>
            </li>
          ))}
          <li className="dim">Round 2: same order, bridge → easy pose held 2×</li>
        </ol>
        <div className="desc">Hands-free after Start: it advances, switches sides and logs itself.</div>
        <div className="start-row">
          <button type="button" className="btn btn--primary flow-start" onClick={start}>
            Start
          </button>
          {onPeek && <PeekButtons onPeek={onPeek} />}
        </div>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="screen screen--center flow-done" data-testid="flow-done">
        <div className="h1">Recovery Flow complete</div>
        <div className="h2 dim">{Math.floor(state.elapsedMs / 60000)} min</div>
        <div className="desc" data-testid="flow-log-status">
          {logStatus === "ok" ? "Logged ✓"
            : logStatus === "queued" ? "Saved offline ✓ — will sync"
            : logStatus === "error" ? "Couldn't log — Artemis will still see the day"
            : "Logging…"}
        </div>
      </div>
    );
  }

  const item: FlowItem = items[state.index];
  const next = items[state.index + 1] ?? null;
  const pkind = previewKind(items, state.index);
  const showPreview = state.previewed && next !== null;
  const secLeft = remainingInItemSec(items, state);
  const roundLabel = item.kind === "pose"
    ? `Round ${item.round}/${item.totalRounds}`
    : item.kind === "pre" ? "Before round 1" : "Close";

  return (
    <div
      className={`screen flow-run${state.paused ? " flow-run--paused" : ""}`}
      data-testid="flow-run"
      data-index={state.index}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { pointerRef.current = null; }}
    >
      <div className="flow-head">
        <span className="flow-round" data-testid="flow-round">{roundLabel}</span>
        <span className="mono dim">{formatClock(remainingTotalSec(items, state))} left</span>
        {audio !== "unsupported" && (
          <button
            type="button"
            className="badge badge--button flow-mute"
            data-no-swipe
            onPointerUp={(e) => e.stopPropagation()}
            onClick={() => { toggleMuted(); if (isMuted()) stopSpeech(); }}
            aria-label={isMuted() ? "Muted — tap for sound" : "Sound on — tap to mute"}
          >
            {isMuted() ? "🔇" : "🔊"}
          </button>
        )}
      </div>

      <div className="flow-body">
        {item.step && <div className="flow-step mono dim">Step {item.step}</div>}
        <div className="flow-name" data-testid="flow-name">{item.name}</div>
        {item.sideLabel && (
          <div className="flow-side" data-testid="flow-side">{item.sideLabel}</div>
        )}
        <div className="flow-clock mono" data-testid="flow-clock">{formatClock(secLeft)}</div>
        {item.cue && <div className="flow-cue">{item.cue}</div>}
        {item.easier && <div className="flow-easier">Easier: {item.easier}</div>}
      </div>

      {showPreview && pkind === "switch" && (
        <div className="flow-switch" data-testid="flow-switch" role="status">
          <div className="flow-switch-title">Switch sides</div>
          <div className="flow-switch-next">{next.sideLabel}</div>
        </div>
      )}
      {showPreview && pkind === "round" && (
        <div className="flow-switch flow-roundcard" data-testid="flow-round-change" role="status">
          <div className="flow-switch-title">Round {next.round}</div>
          <div className="flow-switch-next">Next: {next.title}</div>
        </div>
      )}
      {showPreview && pkind === "next" && (
        <div className="flow-next" data-testid="flow-next" role="status">
          Next: {next.title}
        </div>
      )}
      {state.paused && (
        <div className="flow-paused" data-testid="flow-paused">Paused — tap to resume</div>
      )}
    </div>
  );
}
