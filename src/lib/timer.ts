import type { Blocks, Plan } from "./types";
import {
  flattenBlocksToSteps,
  nextCursor,
  prevCursor,
  type Cursor,
  type FlatSession,
  type Section,
  type Step,
  type StepKind,
} from "./steps";

// Re-export so callers can import these from "../lib/timer" without
// reaching into the new module (and so existing imports keep compiling).
export type { Cursor, FlatSession, Section, Step, StepKind };

// ---------------------------------------------------------------------------
// Drift-free timer state, now keyed on Step + Cursor.
// The cursor maintains (stepIndex, currentRound). Each step is hit
// `currentRound` times within a circuit; the cursor wraps at round_break.
// ---------------------------------------------------------------------------

export type TimerStatus = "idle" | "running" | "paused" | "done";

export interface TimerState {
  steps: Step[];
  sections: Section[];
  cursor: Cursor;
  status: TimerStatus;
  workout_started_at_ms: number | null;
  step_started_at_ms: number | null;
  paused_at_ms: number | null;
}

export type TimerAction =
  | { type: "START"; now_ms: number }
  | { type: "TICK"; now_ms: number }
  | { type: "PAUSE"; now_ms: number }
  | { type: "RESUME"; now_ms: number }
  | { type: "RESTART_STEP"; now_ms: number }
  | { type: "PREV_STEP"; now_ms: number }
  | { type: "NEXT_STEP"; now_ms: number }
  | { type: "RESTART_WORKOUT"; now_ms: number }
  | { type: "END_WORKOUT" }
  | { type: "RESET" };

export function buildSessionForPlan(plan: Plan): FlatSession {
  return flattenBlocksToSteps(plan.blocks);
}

export function buildSession(blocks: Blocks): FlatSession {
  return flattenBlocksToSteps(blocks);
}

export function initTimer(session: FlatSession): TimerState {
  return {
    steps: session.steps,
    sections: session.sections,
    cursor: { stepIndex: 0, currentRound: 1 },
    status: "idle",
    workout_started_at_ms: null,
    step_started_at_ms: null,
    paused_at_ms: null,
  };
}

function effectiveNow(state: TimerState, now_ms: number): number {
  return state.status === "paused" && state.paused_at_ms !== null
    ? state.paused_at_ms
    : now_ms;
}

export function timerReducer(state: TimerState, action: TimerAction): TimerState {
  switch (action.type) {
    case "START": {
      if (state.status !== "idle") return state;
      if (state.steps.length === 0) {
        return { ...state, status: "done", workout_started_at_ms: action.now_ms };
      }
      return {
        ...state,
        status: "running",
        workout_started_at_ms: action.now_ms,
        step_started_at_ms: action.now_ms,
        paused_at_ms: null,
      };
    }
    case "TICK": {
      if (state.status !== "running" || state.step_started_at_ms === null) {
        return state;
      }
      let cursor = state.cursor;
      let stepStart = state.step_started_at_ms;
      // Advance through any expired steps in one pass.
      while (true) {
        const cur = state.steps[cursor.stepIndex];
        if (!cur) break;
        const dur_ms = cur.duration_sec * 1000;
        if (action.now_ms - stepStart < dur_ms) break;
        const next = nextCursor(state.steps, cursor);
        if (next === null) {
          return {
            ...state,
            status: "done",
            step_started_at_ms: null,
          };
        }
        stepStart += dur_ms;
        cursor = next;
      }
      if (cursor === state.cursor) return state;
      return { ...state, cursor, step_started_at_ms: stepStart };
    }
    case "PAUSE": {
      if (state.status !== "running") return state;
      return { ...state, status: "paused", paused_at_ms: action.now_ms };
    }
    case "RESUME": {
      if (state.status !== "paused" || state.paused_at_ms === null) return state;
      const shift = action.now_ms - state.paused_at_ms;
      return {
        ...state,
        status: "running",
        step_started_at_ms:
          state.step_started_at_ms !== null
            ? state.step_started_at_ms + shift
            : action.now_ms,
        workout_started_at_ms:
          state.workout_started_at_ms !== null
            ? state.workout_started_at_ms + shift
            : action.now_ms,
        paused_at_ms: null,
      };
    }
    case "RESTART_STEP": {
      if (state.status === "idle" || state.status === "done") return state;
      return {
        ...state,
        step_started_at_ms: action.now_ms,
        paused_at_ms: state.status === "paused" ? action.now_ms : null,
      };
    }
    case "PREV_STEP": {
      if (state.status === "idle" || state.status === "done") return state;
      const next = prevCursor(state.steps, state.cursor);
      return {
        ...state,
        cursor: next,
        step_started_at_ms: action.now_ms,
        paused_at_ms: state.status === "paused" ? action.now_ms : null,
      };
    }
    case "NEXT_STEP": {
      if (state.status === "idle" || state.status === "done") return state;
      const next = nextCursor(state.steps, state.cursor);
      if (next === null) {
        return { ...state, status: "done", step_started_at_ms: null, paused_at_ms: null };
      }
      return {
        ...state,
        cursor: next,
        step_started_at_ms: action.now_ms,
        paused_at_ms: state.status === "paused" ? action.now_ms : null,
      };
    }
    case "RESTART_WORKOUT": {
      if (state.steps.length === 0) {
        return { ...state, status: "done", paused_at_ms: null };
      }
      return {
        ...state,
        status: "running",
        cursor: { stepIndex: 0, currentRound: 1 },
        workout_started_at_ms: action.now_ms,
        step_started_at_ms: action.now_ms,
        paused_at_ms: null,
      };
    }
    case "END_WORKOUT":
      return { ...state, status: "done", step_started_at_ms: null, paused_at_ms: null };
    case "RESET":
      return initTimer({ steps: state.steps, sections: state.sections });
  }
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export function selectCurrentStep(state: TimerState): Step | null {
  return state.steps[state.cursor.stepIndex] ?? null;
}

export function selectNextStep(state: TimerState): Step | null {
  const next = nextCursor(state.steps, state.cursor);
  if (next === null) return null;
  return state.steps[next.stepIndex] ?? null;
}

export function selectStepAfterNext(state: TimerState): Step | null {
  const a = nextCursor(state.steps, state.cursor);
  if (a === null) return null;
  const b = nextCursor(state.steps, a);
  if (b === null) return null;
  return state.steps[b.stepIndex] ?? null;
}

export function selectRemainingSec(state: TimerState, now_ms: number): number {
  if (state.status === "idle") return state.steps[0]?.duration_sec ?? 0;
  if (state.status === "done") return 0;
  const cur = state.steps[state.cursor.stepIndex];
  if (!cur || state.step_started_at_ms === null) return 0;
  const t = effectiveNow(state, now_ms);
  return Math.max(0, cur.duration_sec - (t - state.step_started_at_ms) / 1000);
}

export function selectElapsedSec(state: TimerState, now_ms: number): number {
  if (state.workout_started_at_ms === null) return 0;
  const t = effectiveNow(state, now_ms);
  return Math.max(0, (t - state.workout_started_at_ms) / 1000);
}

export function isFirstStepCursor(state: TimerState): boolean {
  return state.cursor.stepIndex === 0 && state.cursor.currentRound === 1;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatMMSS(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
