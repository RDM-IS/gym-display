import type {
  Blocks,
  CircuitBlocks,
  IntervalsBlocks,
  Interval,
  Plan,
  WalkBlocks,
} from "./types";

const DEFAULT_STRENGTH_WARMUP_SEC = 300;
const DEFAULT_STRENGTH_COOLDOWN_SEC = 300;

function parseLeadingMinutes(text: string | undefined, fallback_sec: number): number {
  if (!text) return fallback_sec;
  const m = text.match(/^\s*(\d+)\s*min/i);
  return m ? parseInt(m[1], 10) * 60 : fallback_sec;
}

function workDurationForExercise(ex: CircuitBlocks["exercises"][number]): number {
  if (ex.format === "duration") return ex.duration_sec ?? 30;
  const reps = ex.target_reps ?? 10;
  return Math.max(30, reps * 4);
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
  const rounds = Math.max(1, b.rounds);
  for (let r = 0; r < rounds; r++) {
    const isLastRound = r === rounds - 1;
    for (let i = 0; i < b.exercises.length; i++) {
      const ex = b.exercises[i];
      const isLastEx = i === b.exercises.length - 1;
      out.push({
        kind: "work",
        name: ex.name,
        duration_sec: workDurationForExercise(ex),
        reps: ex.format === "reps" ? ex.target_reps : undefined,
        load_lbs: ex.target_load_lbs,
        round: r + 1,
        total_rounds: rounds,
      });
      if (!isLastEx) {
        out.push({
          kind: "rest",
          name: "Rest",
          duration_sec: ex.rest_after_sec,
          round: r + 1,
          total_rounds: rounds,
        });
      } else if (!isLastRound) {
        out.push({
          kind: "round_break",
          name: "Round break",
          duration_sec: b.rest_between_rounds_sec,
          round: r + 1,
          total_rounds: rounds,
        });
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
  return out;
}

function buildIntervalsCardio(b: IntervalsBlocks): Interval[] {
  const out: Interval[] = [];
  if (b.warmup_sec > 0) {
    out.push({
      kind: "warmup",
      name: "Warmup",
      duration_sec: b.warmup_sec,
      description: b.warmup_settings,
    });
  }
  const rounds = Math.max(1, b.rounds);
  const t = b.intervals_template;
  for (let r = 0; r < rounds; r++) {
    const isLastRound = r === rounds - 1;
    out.push({
      kind: "work",
      name: "Work",
      duration_sec: t.work_sec,
      description: t.work_settings,
      round: r + 1,
      total_rounds: rounds,
    });
    if (!isLastRound) {
      out.push({
        kind: "rest",
        name: "Rest",
        duration_sec: t.rest_sec,
        description: t.rest_settings,
        round: r + 1,
        total_rounds: rounds,
      });
    }
  }
  if (b.cooldown_sec > 0) {
    out.push({
      kind: "cooldown",
      name: "Cooldown",
      duration_sec: b.cooldown_sec,
      description: b.cooldown_settings,
    });
  }
  return out;
}

function buildWalkIntervals(b: WalkBlocks): Interval[] {
  return [
    {
      kind: "work",
      name: "Walk",
      duration_sec: Math.max(60, b.duration_min * 60),
      description: b.intensity,
    },
  ];
}

export function buildIntervals(blocks: Blocks): Interval[] {
  switch (blocks.type) {
    case "circuit":
      return buildCircuitIntervals(blocks);
    case "intervals":
      return buildIntervalsCardio(blocks);
    case "walk":
      return buildWalkIntervals(blocks);
  }
}

export function buildIntervalsForPlan(plan: Plan): Interval[] {
  return buildIntervals(plan.blocks);
}

export type TimerStatus = "idle" | "running" | "done";

export interface TimerState {
  intervals: Interval[];
  current_index: number;
  status: TimerStatus;
  workout_started_at_ms: number | null;
  interval_started_at_ms: number | null;
}

export type TimerAction =
  | { type: "START"; now_ms: number }
  | { type: "TICK"; now_ms: number }
  | { type: "RESET" };

export function initTimer(intervals: Interval[]): TimerState {
  return {
    intervals,
    current_index: 0,
    status: "idle",
    workout_started_at_ms: null,
    interval_started_at_ms: null,
  };
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
    case "RESET":
      return initTimer(state.intervals);
  }
}

export function selectRemainingSec(state: TimerState, now_ms: number): number {
  if (state.status === "idle") return state.intervals[0]?.duration_sec ?? 0;
  if (state.status === "done") return 0;
  const cur = state.intervals[state.current_index];
  if (!cur || state.interval_started_at_ms === null) return 0;
  return Math.max(0, cur.duration_sec - (now_ms - state.interval_started_at_ms) / 1000);
}

export function selectElapsedSec(state: TimerState, now_ms: number): number {
  if (state.workout_started_at_ms === null) return 0;
  return Math.max(0, (now_ms - state.workout_started_at_ms) / 1000);
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
