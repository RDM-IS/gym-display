import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  audioStatus,
  chimeNext,
  isMuted,
  speak,
  speechSupported,
  stopSpeech,
  subscribeAudio,
  toggleMuted,
  toneFlowDone,
  toneHoldStart,
  toneMove,
  toneRound,
  toneSwitchSides,
  unlockAudio,
  unlockSpeech,
} from "../lib/audio";
import {
  CHIME_LEAD_MS,
  DEFAULT_LEADIN_SEC,
  buildFlowTimeline,
  flowLogNotes,
  flowTotalSec,
  formatClock,
  initialFlowState,
  remainingInStageSec,
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
import BottomBar from "../components/BottomBar";
import PoseFigure, { hasPoseArt } from "../assets/poses";
import type { BarTarget } from "../lib/bottom-bar";

interface Props {
  plan: Plan;
  /** True while the flow runs full-screen (the app hides its nav). */
  onRunningChange?: (running: boolean) => void;
  /** Bottom bar (Tomorrow / Week) — on the ready screen only. */
  onNavigate?: (target: BarTarget) => void;
}

const TICK_MS = 250;

type Phase = "ready" | "running" | "done";
type LogStatus = "idle" | "ok" | "queued" | "error";

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** YOGA-1 Recovery Flow — one Start tap, then hands-free. YOGA-3 timing:
 * the next pose is always on screen; 3 s before a hold ends a chime and the
 * full lead-in ("Next we'll move into …"); at 0 a "Move into position"
 * transition (3 s or 5 s by the change in body position) with the short
 * cue; then a start tone and the hold. Switch sides and round changes keep
 * their own screens and tones. Logs complete / partial by itself. Tap to
 * pause (transitions too), swipe to skip — both optional. */
export default function FlowScreen({ plan, onRunningChange, onNavigate }: Props) {
  const blocks = plan.blocks as RecoveryFlowBlocks;
  const items = useMemo(() => buildFlowTimeline(blocks), [blocks]);
  const errors = useMemo(() => validateFlow(blocks), [blocks]);
  const totalSec = useMemo(() => flowTotalSec(blocks), [blocks]);
  const leadinSec = blocks.leadin_sec ?? DEFAULT_LEADIN_SEC;

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
        if (e.type === "transition") {
          // Cancels anything still being said: the move cue is never talked over.
          speak(items[e.index].moveCue);
          if (!speechSupported()) toneMove();
        } else if (e.type === "hold") {
          toneHoldStart();
        } else if (e.type === "leadin") {
          if (e.kind === "switch") toneSwitchSides();
          else if (e.kind === "round") toneRound();
          else chimeNext();
          // The words start once the tone is done — on the lead-in second.
          speak(items[e.next].leadIn, Math.max(0, CHIME_LEAD_MS[e.kind] - e.lateMs));
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
      const { state: next, events } = tickFlow(items, stateRef.current, dt, leadinSec);
      if (next !== stateRef.current) commit(next);
      if (events.length) handleEvents(events);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [phase, items, leadinSec, commit, handleEvents]);

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
    // "We'll begin with seated meditation for 60 seconds." — then the first
    // transition gets you into position.
    speak(items[0].leadIn);
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
              <span className="flow-thumb-slot" aria-hidden="true">
                <PoseFigure name={i.name} side={i.side} className="pose-thumb" />
              </span>
              <span className="flow-list-title">{i.title}</span>
              <span className="mono dim">{formatClock(i.duration_sec)}</span>
            </li>
          ))}
          <li className="dim">Round 2: same order, bridge → easy pose held 2×</li>
        </ol>
        <div className="desc">
          Hands-free after Start: it announces each pose, gives you 3–5 s to move into it,
          switches sides and logs itself.
        </div>
        <BottomBar view="today" start={{ label: "Start", onStart: start }} onNavigate={onNavigate ?? (() => {})} />
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
  const moving = state.stage === "transition";
  const secLeft = remainingInStageSec(items, state);
  const roundLabel = item.kind === "pose"
    ? `Round ${item.round}/${item.totalRounds}`
    : item.kind === "pre" ? "Before round 1" : "Close";

  return (
    <div
      className={`screen flow-run${state.paused ? " flow-run--paused" : ""}${moving ? " flow-run--moving" : ""}`}
      data-testid="flow-run"
      data-index={state.index}
      data-stage={state.stage}
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

      <div className={`flow-body${hasPoseArt(item.name) ? " flow-body--figure" : ""}`}
           data-testid="flow-body">
        {/* The figure's box is sized by CSS before it paints, and the SVG is
            inline (nothing to load), so the text never moves under it. */}
        <PoseFigure name={item.name} side={item.side} className="flow-figure" />
        <div className="flow-text">
          {item.step && <div className="flow-step mono dim">Step {item.step}</div>}
          <div className="flow-name" data-testid="flow-name">{item.name}</div>
          {item.sideLabel && (
            <div className="flow-side" data-testid="flow-side">{item.sideLabel}</div>
          )}
          {/* Keeps its line during the hold (just hidden) so the name and
              figure don't jump when the transition ends. */}
          <div className={`flow-move${moving ? "" : " flow-move--idle"}`}
               data-testid={moving ? "flow-move" : undefined} aria-hidden={!moving}>
            Move into position
          </div>
          <div className={`flow-clock mono${moving ? " flow-clock--moving" : ""}`}
               data-testid="flow-clock">
            {moving ? secLeft : formatClock(secLeft)}
          </div>
          {item.cue && <div className="flow-cue">{item.cue}</div>}
          {item.easier && <div className="flow-easier">Easier: {item.easier}</div>}
        </div>
      </div>

      {/* Always there — for the whole hold and the transition — so it never
          appears or disappears mid-pose. */}
      <div className="flow-next" data-testid="flow-next">
        {next ? (
          <>
            <span className="flow-next-thumb-slot" aria-hidden="true">
              <PoseFigure name={next.name} side={next.side} className="pose-thumb flow-next-thumb" />
            </span>
            <span data-testid="flow-next-title">Next: {next.title}</span>
          </>
        ) : (
          <span data-testid="flow-next-title">Last one — the flow ends after this</span>
        )}
      </div>

      {moving && item.switchBefore && (
        <div className="flow-switch" data-testid="flow-switch" role="status">
          <div className="flow-switch-title">Switch sides</div>
          <PoseFigure name={item.name} side={item.side} className="flow-switch-figure" />
          <div className="flow-switch-next">{item.name} · {item.sideLabel}</div>
          <div className="flow-move">Move into position · <span className="mono">{secLeft}</span></div>
        </div>
      )}
      {moving && item.roundStart && (
        <div className="flow-switch flow-roundcard" data-testid="flow-round-change" role="status">
          <div className="flow-switch-title">Round {item.round}</div>
          <PoseFigure name={item.name} side={item.side} className="flow-switch-figure" />
          <div className="flow-switch-next">{item.title}</div>
          <div className="flow-move">Move into position · <span className="mono">{secLeft}</span></div>
        </div>
      )}
      {state.paused && (
        <div className="flow-paused" data-testid="flow-paused">Paused — tap to resume</div>
      )}
    </div>
  );
}
