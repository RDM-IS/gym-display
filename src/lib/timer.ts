import type {
  Blocks,
  CircuitBlocks,
  Finisher,
  IntervalsBlocks,
  Interval,
  MobilityBlocks,
  Plan,
  PlannedExercise,
  SteadyBlocks,
  WalkBlocks,
} from "./types";
import { assertNeverBlock } from "./types";

const DEFAULT_STRENGTH_WARMUP_SEC = 300;
const DEFAULT_STRENGTH_COOLDOWN_SEC = 300;
const DEFAULT_EXERCISE_REST_SEC = 30;
const DEFAULT_FINISHER_ROUND_BREAK_SEC = 60;

function parseLeadingMinutes(text: string | null | undefined, fallback_sec: number): number {
  if (!text) return fallback_sec;
  const m = text.match(/^\s*(\d+)\s*min/i);
  return m ? parseInt(m[1], 10) * 60 : fallback_sec;
}

/** Defensive — the runtime payload is JSONB; an exercises array may be
 * absent, null, or the wrong type. Never call .length / .map blindly. */
function exerciseListOf(b: { exercises?: PlannedExercise[] | null }): PlannedExercise[] {
  return Array.isArray(b.exercises) ? b.exercises : [];
}

function finisherExercisesOf(f: Finisher | null | undefined): PlannedExercise[] {
  if (!f) return [];
  return Array.isArray(f.exercises) ? f.exercises : [];
}

function workDurationForExercise(ex: PlannedExercise): number {
  if (ex.format === "duration") return ex.duration_sec ?? 30;
  const reps = ex.target_reps ?? 10;
  return Math.max(30, reps * 4);
}

/** Append a finisher's exercises (e.g. core_circuit) as a separate
 * segment after the main block's intervals. */
function appendFinisher(out: Interval[], f: Finisher | null | undefined): void {
  const exercises = finisherExercisesOf(f);
  if (exercises.length === 0) return;
  const rounds = Math.max(1, f?.rounds ?? 1);
  const breakSec = f?.rest_after_sec ?? DEFAULT_FINISHER_ROUND_BREAK_SEC;
  for (let r = 0; r < rounds; r++) {
    const isLastRound = r === rounds - 1;
    for (let i = 0; i < exercises.length; i++) {
      const ex = exercises[i];
      const isLastEx = i === exercises.length - 1;
      out.push({
        kind: "work",
        name: ex.name,
        duration_sec: workDurationForExercise(ex),
        reps: ex.format === "reps" ? ex.target_reps ?? undefined : undefined,
        load_lbs: ex.target_load_lbs ?? undefined,
        round: rounds > 1 ? r + 1 : undefined,
        total_rounds: rounds > 1 ? rounds : undefined,
      });
      if (!isLastEx) {
        out.push({
          kind: "rest",
          name: "Rest",
          duration_sec: ex.rest_after_sec ?? DEFAULT_EXERCISE_REST_SEC,
          round: rounds > 1 ? r + 1 : undefined,
          total_rounds: rounds > 1 ? rounds : undefined,
        });
      } else if (!isLastRound) {
        out.push({
          kind: "round_break",
          name: "Round break",
          duration_sec: breakSec,
          round: r + 1,
          total_rounds: rounds,
        });
      }
    }
  }
}

function buildCircuitIntervals(b: CircuitBlocks): Interval[] {
  const out: Interval[] = [];
  if (b.warmup) {
    out.push({
      kind: "warmup",
      name: "Warmup",
      duration_sec: parseLeadingMinutes(b.warmup, DEFAULT_STRENGTH_WARMUP_SEC),
      description: b.warmup,
    });
  }
  const exercises = exerciseListOf(b);
  const rounds = Math.max(1, b.rounds ?? 1);
  const roundBreakSec = b.rest_between_rounds_sec ?? 60;
  if (exercises.length > 0) {
    for (let r = 0; r < rounds; r++) {
      const isLastRound = r === rounds - 1;
      for (let i = 0; i < exercises.length; i++) {
        const ex = exercises[i];
        const isLastEx = i === exercises.length - 1;
        out.push({
          kind: "work",
          name: ex.name,
          duration_sec: workDurationForExercise(ex),
          reps: ex.format === "reps" ? ex.target_reps ?? undefined : undefined,
          load_lbs: ex.target_load_lbs ?? undefined,
          round: r + 1,
          total_rounds: rounds,
        });
        if (!isLastEx) {
          out.push({
            kind: "rest",
            name: "Rest",
            duration_sec: ex.rest_after_sec ?? DEFAULT_EXERCISE_REST_SEC,
            round: r + 1,
            total_rounds: rounds,
          });
        } else if (!isLastRound) {
          out.push({
            kind: "round_break",
            name: "Round break",
            duration_sec: roundBreakSec,
            round: r + 1,
            total_rounds: rounds,
          });
        }
      }
    }
  }
  if (b.cooldown) {
    out.push({
      kind: "cooldown",
      name: "Cooldown",
      duration_sec: parseLeadingMinutes(b.cooldown, DEFAULT_STRENGTH_COOLDOWN_SEC),
      description: b.cooldown,
    });
  }
  appendFinisher(out, b.finisher);
  return out;
}

function buildIntervalsCardio(b: IntervalsBlocks): Interval[] {
  const out: Interval[] = [];
  if (b.warmup_sec && b.warmup_sec > 0) {
    out.push({
      kind: "warmup",
      name: "Warmup",
      duration_sec: b.warmup_sec,
      description: b.warmup_settings ?? undefined,
    });
  }
  const rounds = Math.max(1, b.rounds ?? 1);
  const t = b.intervals_template;
  if (t && typeof t.work_sec === "number" && typeof t.rest_sec === "number") {
    for (let r = 0; r < rounds; r++) {
      const isLastRound = r === rounds - 1;
      out.push({
        kind: "work",
        name: "Work",
        duration_sec: t.work_sec,
        description: t.work_settings ?? undefined,
        round: r + 1,
        total_rounds: rounds,
      });
      if (!isLastRound) {
        out.push({
          kind: "rest",
          name: "Rest",
          duration_sec: t.rest_sec,
          description: t.rest_settings ?? undefined,
          round: r + 1,
          total_rounds: rounds,
        });
      }
    }
  }
  if (b.cooldown_sec && b.cooldown_sec > 0) {
    out.push({
      kind: "cooldown",
      name: "Cooldown",
      duration_sec: b.cooldown_sec,
      description: b.cooldown_settings ?? undefined,
    });
  }
  appendFinisher(out, b.finisher);
  return out;
}

function buildSteadyIntervals(b: SteadyBlocks): Interval[] {
  const out: Interval[] = [];
  if (b.warmup_sec && b.warmup_sec > 0) {
    out.push({
      kind: "warmup",
      name: "Warmup",
      duration_sec: b.warmup_sec,
      description: b.warmup_settings ?? undefined,
    });
  }
  const mainSec = Math.max(60, (b.duration_min ?? 0) * 60);
  if (mainSec > 0) {
    const rangeDesc =
      Array.isArray(b.target_range_min)
        ? `${b.target_range_min[0]}–${b.target_range_min[1]} min`
        : typeof b.target_range_min === "string"
        ? b.target_range_min
        : undefined;
    const description = b.intensity || rangeDesc || undefined;
    out.push({
      kind: "work",
      name: b.display_name ?? "Steady cardio",
      duration_sec: mainSec,
      description,
    });
  }
  if (b.cooldown_sec && b.cooldown_sec > 0) {
    out.push({
      kind: "cooldown",
      name: "Cooldown",
      duration_sec: b.cooldown_sec,
      description: b.cooldown_settings ?? undefined,
    });
  }
  appendFinisher(out, b.finisher);
  return out;
}

function buildMobilityIntervals(b: MobilityBlocks): Interval[] {
  const sec = Math.max(60, (b.duration_min ?? 20) * 60);
  const out: Interval[] = [
    {
      kind: "work",
      name: b.display_name ?? "Mobility",
      duration_sec: sec,
      description: b.notes ?? undefined,
    },
  ];
  appendFinisher(out, b.finisher);
  return out;
}

function buildWalkIntervals(b: WalkBlocks): Interval[] {
  const out: Interval[] = [
    {
      kind: "work",
      name: b.display_name ?? "Walk",
      duration_sec: Math.max(60, b.duration_min * 60),
      description: b.intensity ?? undefined,
    },
  ];
  appendFinisher(out, b.finisher);
  return out;
}

export function buildIntervals(blocks: Blocks): Interval[] {
  switch (blocks.type) {
    case "circuit":   return buildCircuitIntervals(blocks);
    case "intervals": return buildIntervalsCardio(blocks);
    case "steady":    return buildSteadyIntervals(blocks);
    case "mobility":  return buildMobilityIntervals(blocks);
    case "walk":      return buildWalkIntervals(blocks);
    default:          return assertNeverBlock(blocks);
  }
}

export function buildIntervalsForPlan(plan: Plan): Interval[] {
  return buildIntervals(plan.blocks);
}

export type TimerStatus = "idle" | "running" | "paused" | "done";

export interface TimerState {
  intervals: Interval[];
  current_index: number;
  status: TimerStatus;
  workout_started_at_ms: number | null;
  interval_started_at_ms: number | null;
  paused_at_ms: number | null;
}

export type TimerAction =
  | { type: "START"; now_ms: number }
  | { type: "TICK"; now_ms: number }
  | { type: "PAUSE"; now_ms: number }
  | { type: "RESUME"; now_ms: number }
  | { type: "RESTART_INTERVAL"; now_ms: number }
  | { type: "PREV_INTERVAL"; now_ms: number }
  | { type: "NEXT_INTERVAL"; now_ms: number }
  | { type: "RESTART_WORKOUT"; now_ms: number }
  | { type: "END_WORKOUT" }
  | { type: "RESET" };

export function initTimer(intervals: Interval[]): TimerState {
  return {
    intervals,
    current_index: 0,
    status: "idle",
    workout_started_at_ms: null,
    interval_started_at_ms: null,
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
      if (state.intervals.length === 0) {
        return { ...state, status: "done", workout_started_at_ms: action.now_ms };
      }
      return {
        ...state,
        status: "running",
        workout_started_at_ms: action.now_ms,
        interval_started_at_ms: action.now_ms,
        paused_at_ms: null,
      };
    }
    case "TICK": {
      if (state.status !== "running" || state.interval_started_at_ms === null) {
        return state;
      }
      let idx = state.current_index;
      let interval_start = state.interval_started_at_ms;
      while (idx < state.intervals.length) {
        const dur_ms = state.intervals[idx].duration_sec * 1000;
        if (action.now_ms - interval_start < dur_ms) break;
        interval_start += dur_ms;
        idx++;
      }
      if (idx >= state.intervals.length) {
        return {
          ...state,
          status: "done",
          current_index: state.intervals.length - 1,
          interval_started_at_ms: null,
        };
      }
      if (idx === state.current_index) return state;
      return { ...state, current_index: idx, interval_started_at_ms: interval_start };
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
        interval_started_at_ms:
          state.interval_started_at_ms !== null
            ? state.interval_started_at_ms + shift
            : action.now_ms,
        workout_started_at_ms:
          state.workout_started_at_ms !== null
            ? state.workout_started_at_ms + shift
            : action.now_ms,
        paused_at_ms: null,
      };
    }
    case "RESTART_INTERVAL": {
      if (state.status === "idle" || state.status === "done") return state;
      return {
        ...state,
        interval_started_at_ms: action.now_ms,
        paused_at_ms: state.status === "paused" ? action.now_ms : null,
      };
    }
    case "PREV_INTERVAL": {
      if (state.status === "idle" || state.status === "done") return state;
      const idx = Math.max(0, state.current_index - 1);
      return {
        ...state,
        current_index: idx,
        interval_started_at_ms: action.now_ms,
        paused_at_ms: state.status === "paused" ? action.now_ms : null,
      };
    }
    case "NEXT_INTERVAL": {
      if (state.status === "idle" || state.status === "done") return state;
      const next_idx = state.current_index + 1;
      if (next_idx >= state.intervals.length) {
        return { ...state, status: "done", interval_started_at_ms: null, paused_at_ms: null };
      }
      return {
        ...state,
        current_index: next_idx,
        interval_started_at_ms: action.now_ms,
        paused_at_ms: state.status === "paused" ? action.now_ms : null,
      };
    }
    case "RESTART_WORKOUT": {
      if (state.intervals.length === 0) {
        return { ...state, status: "done", paused_at_ms: null };
      }
      return {
        ...state,
        status: "running",
        current_index: 0,
        workout_started_at_ms: action.now_ms,
        interval_started_at_ms: action.now_ms,
        paused_at_ms: null,
      };
    }
    case "END_WORKOUT": {
      return { ...state, status: "done", interval_started_at_ms: null, paused_at_ms: null };
    }
    case "RESET":
      return initTimer(state.intervals);
  }
}

export function selectRemainingSec(state: TimerState, now_ms: number): number {
  if (state.status === "idle") return state.intervals[0]?.duration_sec ?? 0;
  if (state.status === "done") return 0;
  const cur = state.intervals[state.current_index];
  if (!cur || state.interval_started_at_ms === null) return 0;
  const t = effectiveNow(state, now_ms);
  return Math.max(0, cur.duration_sec - (t - state.interval_started_at_ms) / 1000);
}

export function selectElapsedSec(state: TimerState, now_ms: number): number {
  if (state.workout_started_at_ms === null) return 0;
  const t = effectiveNow(state, now_ms);
  return Math.max(0, (t - state.workout_started_at_ms) / 1000);
}

export function isFirstInterval(state: TimerState): boolean {
  return state.current_index <= 0;
}

export function isLastInterval(state: TimerState): boolean {
  return state.current_index >= state.intervals.length - 1;
}

export function selectCurrent(state: TimerState): Interval | null {
  return state.intervals[state.current_index] ?? null;
}

export function selectNext(state: TimerState): Interval | null {
  return state.intervals[state.current_index + 1] ?? null;
}

export function formatMMSS(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
