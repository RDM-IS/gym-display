import type { Blocks, Plan } from "./types";
import { deferExercise, isDeferrable, leavesRound, upcomingExercise } from "./defer";
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
  /** GD-DEFER: the plan-order steps and blocks, and the blocks behind the
   * current (possibly swapped) steps. */
  planSteps: Step[];
  planBlocks: Blocks | null;
  blocks: Blocks | null;
  /** Exercises deferred ("Busy — later") in the current round. */
  deferred: string[];
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
  /** The current exercise's machine is busy: swap it with the next one. */
  | { type: "DEFER_CURRENT"; now_ms: number }
  /** From a rest: the upcoming exercise's machine is busy. */
  | { type: "DEFER_NEXT" }
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
    planSteps: session.steps,
    planBlocks: session.source ?? null,
    blocks: session.source ?? null,
    deferred: [],
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

/** Next cursor; when it leaves the round, the plan order is restored first
 * (the round-break / circuit-exit index is the same in both layouts). */
function advance(state: TimerState, cursor: Cursor): { cursor: Cursor | null; restore: boolean } {
  const next = nextCursor(state.steps, cursor);
  if (state.steps === state.planSteps || next === null || !leavesRound(state.steps, cursor, next)) {
    return { cursor: next, restore: false };
  }
  return { cursor: nextCursor(state.planSteps, cursor), restore: true };
}

function restored(state: TimerState): Pick<TimerState, "steps" | "blocks" | "deferred"> {
  return { steps: state.planSteps, blocks: state.planBlocks, deferred: [] };
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
      let s = state;
      let cursor = state.cursor;
      let stepStart = state.step_started_at_ms;
      // Advance through any expired steps in one pass.
      while (true) {
        const cur = s.steps[cursor.stepIndex];
        if (!cur) break;
        const dur_ms = cur.duration_sec * 1000;
        if (action.now_ms - stepStart < dur_ms) break;
        // Strength sets and their logging rests wait for the user.
        if (cur.holdAtEnd) break;
        const { cursor: next, restore } = advance(s, cursor);
        if (next === null) {
          return {
            ...s,
            status: "done",
            step_started_at_ms: null,
          };
        }
        if (restore) s = { ...s, ...restored(s) };
        stepStart += dur_ms;
        cursor = next;
      }
      if (cursor === state.cursor) return state;
      return { ...s, cursor, step_started_at_ms: stepStart };
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
      const { cursor: next, restore } = advance(state, state.cursor);
      if (next === null) {
        return { ...state, status: "done", step_started_at_ms: null, paused_at_ms: null };
      }
      return {
        ...state,
        ...(restore ? restored(state) : {}),
        cursor: next,
        step_started_at_ms: action.now_ms,
        paused_at_ms: state.status === "paused" ? action.now_ms : null,
      };
    }
    case "DEFER_CURRENT": {
      if (state.status === "idle" || state.status === "done" || !state.blocks) return state;
      const r = deferExercise(state.blocks, state.steps, state.cursor.stepIndex, state.cursor.currentRound);
      if (!r) return state;
      return {
        ...state,
        steps: r.steps,
        blocks: r.blocks,
        deferred: state.deferred.includes(r.deferredName) ? state.deferred : [...state.deferred, r.deferredName],
        // The swapped-in exercise takes this slot; its timer starts fresh.
        cursor: { ...state.cursor, stepIndex: r.swappedInIndex },
        step_started_at_ms: action.now_ms,
        paused_at_ms: state.status === "paused" ? action.now_ms : null,
      };
    }
    case "DEFER_NEXT": {
      if (state.status === "idle" || state.status === "done" || !state.blocks) return state;
      const up = upcomingExercise(state.steps, state.cursor.stepIndex, state.cursor.currentRound);
      if (up === null) return state;
      const r = deferExercise(state.blocks, state.steps, up, state.cursor.currentRound);
      if (!r) return state;
      // Stay on this rest; only what comes next changes.
      return {
        ...state,
        steps: r.steps,
        blocks: r.blocks,
        deferred: state.deferred.includes(r.deferredName) ? state.deferred : [...state.deferred, r.deferredName],
      };
    }
    case "RESTART_WORKOUT": {
      if (state.steps.length === 0) {
        return { ...state, status: "done", paused_at_ms: null };
      }
      return {
        ...state,
        status: "running",
        ...restored(state),
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

/** Seconds spent on the current step (counts past the planned duration while
 * holding). */
export function selectStepElapsedSec(state: TimerState, now_ms: number): number {
  if (state.step_started_at_ms === null) return 0;
  const t = effectiveNow(state, now_ms);
  return Math.max(0, (t - state.step_started_at_ms) / 1000);
}

/** True when the current step has run out and is waiting for the user. */
export function selectIsHolding(state: TimerState, now_ms: number): boolean {
  if (state.status !== "running" && state.status !== "paused") return false;
  const cur = state.steps[state.cursor.stepIndex];
  return !!cur?.holdAtEnd && selectRemainingSec(state, now_ms) <= 0;
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

// ---------------------------------------------------------------------------
// GD-DEFER selectors
// ---------------------------------------------------------------------------

/** "Busy — later" on the current exercise: possible, or why not. */
export function selectCanDeferCurrent(state: TimerState): "yes" | "last" | "no" {
  if (state.status === "idle" || state.status === "done" || !state.blocks) return "no";
  const cur = state.steps[state.cursor.stepIndex];
  if (!isDeferrable(cur)) return "no";
  return deferExercise(state.blocks, state.steps, state.cursor.stepIndex, state.cursor.currentRound)
    ? "yes" : "last";
}

/** "Busy — later" on the rest's "Next:" exercise. */
export function selectCanDeferNext(state: TimerState): "yes" | "last" | "no" {
  if (state.status === "idle" || state.status === "done" || !state.blocks) return "no";
  const up = upcomingExercise(state.steps, state.cursor.stepIndex, state.cursor.currentRound);
  if (up === null || !isDeferrable(state.steps[up])) return "no";
  return deferExercise(state.blocks, state.steps, up, state.cursor.currentRound) ? "yes" : "last";
}
