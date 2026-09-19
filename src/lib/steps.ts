import type {
  Blocks,
  CircuitBlocks,
  Finisher,
  IntervalsBlocks,
  MobilityBlocks,
  PlannedExercise,
  RecoveryFlowBlocks,
  SteadyBlocks,
  WalkBlocks,
} from "./types";
import { assertNeverBlock } from "./types";
import { buildFlowTimeline } from "./flow";

// ---------------------------------------------------------------------------
// Single source of truth for the workout sequence.
// Both the timer cursor AND the journey map consume the OUTPUT of
// `flattenBlocksToSteps`, so they cannot drift.
//
// Circuits are NOT unrolled (no N copies). One pass of the exercise list
// carries `circuitId` + `totalRounds` metadata; the cursor wraps within the
// circuit while incrementing `currentRound`.
// ---------------------------------------------------------------------------

export type StepKind = "warmup" | "exercise" | "rest" | "cooldown";

export interface Step {
  kind: StepKind;
  label: string;
  duration_sec: number;
  /** Set on `exercise` steps. */
  exerciseRef?: PlannedExercise;
  /** Set on `rest` steps that follow a specific exercise (NOT round-break). */
  precedingExerciseRef?: PlannedExercise;
  /** Set on every step inside a circuit body. */
  totalRounds?: number;
  /** Identifies which circuit body this step belongs to: "main" | "finisher". */
  circuitId?: string;
  /** Distinguishes the inter-round rest from regular inter-exercise rests. */
  isRoundBreak?: boolean;
  /** Circuit exercise (and the rest after it) with fewer sets than the
   * circuit has rounds — the cursor skips it in rounds > activeRounds. */
  activeRounds?: number;
  /** When the timer runs out, hold here until the user advances. Set on
   * strength (reps) sets and the logging rest that follows one; timed work
   * (intervals, holds, steady cardio, warmup/cooldown) auto-advances. */
  holdAtEnd?: boolean;
}

export type SectionKind =
  | "warmup"
  | "circuit"
  | "intervals"
  | "steady"
  | "mobility"
  | "walk"
  | "cooldown"
  | "finisher";

export interface Section {
  title: string;
  startIndex: number; // inclusive
  endIndex: number;   // inclusive
  kind: SectionKind;
  /** For circuit/intervals/finisher sections. */
  totalRounds?: number;
}

export interface FlatSession {
  steps: Step[];
  sections: Section[];
  /** The blocks these steps were built from (GD-DEFER rebuilds from them). */
  source?: Blocks;
}

// ---------------------------------------------------------------------------
// Defaults — match the existing timer.ts behaviour so audio cues + total
// durations don't shift.
// ---------------------------------------------------------------------------

const DEFAULT_STRENGTH_WARMUP_SEC = 300;
const DEFAULT_STRENGTH_COOLDOWN_SEC = 300;
const DEFAULT_EXERCISE_REST_SEC = 30;
const DEFAULT_FINISHER_ROUND_BREAK_SEC = 60;

function parseLeadingMinutes(text: string | null | undefined, fallback_sec: number): number {
  if (!text) return fallback_sec;
  const m = text.match(/^\s*(\d+)\s*min/i);
  return m ? parseInt(m[1], 10) * 60 : fallback_sec;
}

function exerciseListOf(b: { exercises?: PlannedExercise[] | null }): PlannedExercise[] {
  return Array.isArray(b.exercises) ? b.exercises : [];
}

function finisherExercisesOf(f: Finisher | null | undefined): PlannedExercise[] {
  if (!f) return [];
  return Array.isArray(f.exercises) ? f.exercises : [];
}

export function workDurationForExercise(ex: PlannedExercise): number {
  if (ex.format === "duration") return ex.duration_sec ?? 30;
  const reps = ex.target_reps ?? 10;
  return Math.max(30, reps * 4);
}

// ---------------------------------------------------------------------------
// Builders — each block kind appends to a shared steps[] + sections[].
// ---------------------------------------------------------------------------

interface Builder {
  steps: Step[];
  sections: Section[];
}

function startSection(b: Builder, kind: SectionKind, title: string, totalRounds?: number): Section {
  const sec: Section = { kind, title, startIndex: b.steps.length, endIndex: b.steps.length, totalRounds };
  b.sections.push(sec);
  return sec;
}

function endSection(sec: Section, b: Builder): void {
  // endIndex = last appended step. If nothing was appended, drop the section.
  if (b.steps.length === 0 || b.steps.length - 1 < sec.startIndex) {
    // Empty section — remove it.
    const i = b.sections.indexOf(sec);
    if (i >= 0) b.sections.splice(i, 1);
    return;
  }
  sec.endIndex = b.steps.length - 1;
}

function buildCircuit(b: Builder, blocks: CircuitBlocks): void {
  // Warmup (text → leading minutes).
  if (blocks.warmup) {
    const sec = startSection(b, "warmup", `${formatMin(parseLeadingMinutes(blocks.warmup, DEFAULT_STRENGTH_WARMUP_SEC))} warmup`);
    b.steps.push({
      kind: "warmup",
      label: blocks.warmup,
      duration_sec: parseLeadingMinutes(blocks.warmup, DEFAULT_STRENGTH_WARMUP_SEC),
    });
    endSection(sec, b);
  }

  // Circuit body — ONE pass with totalRounds metadata.
  const exercises = exerciseListOf(blocks);
  const rounds = Math.max(1, blocks.rounds ?? 1);
  if (exercises.length > 0) {
    const sec = startSection(b, "circuit", `${rounds} × Circuit`, rounds);
    for (let i = 0; i < exercises.length; i++) {
      const ex = exercises[i];
      const isLastEx = i === exercises.length - 1;
      const activeRounds =
        ex.sets != null && ex.sets > 0 && ex.sets < rounds ? ex.sets : undefined;
      b.steps.push({
        kind: "exercise",
        label: ex.name,
        duration_sec: workDurationForExercise(ex),
        exerciseRef: ex,
        totalRounds: rounds,
        circuitId: "main",
        holdAtEnd: ex.format === "reps",
        activeRounds,
      });
      if (!isLastEx) {
        b.steps.push({
          kind: "rest",
          label: "Rest",
          duration_sec: ex.rest_after_sec ?? DEFAULT_EXERCISE_REST_SEC,
          precedingExerciseRef: ex,
          totalRounds: rounds,
          circuitId: "main",
          holdAtEnd: ex.format === "reps",
          activeRounds,
        });
      } else if (rounds > 1) {
        // Round-break rest. Lives at the END of the circuit body. On the
        // last round, the cursor skips this step and lands on cooldown.
        b.steps.push({
          kind: "rest",
          label: "Between rounds",
          duration_sec: blocks.rest_between_rounds_sec ?? 60,
          precedingExerciseRef: ex,
          totalRounds: rounds,
          circuitId: "main",
          holdAtEnd: ex.format === "reps",
          isRoundBreak: true,
        });
      }
    }
    endSection(sec, b);
  }

  // Cooldown.
  if (blocks.cooldown) {
    const sec = startSection(b, "cooldown", `${formatMin(parseLeadingMinutes(blocks.cooldown, DEFAULT_STRENGTH_COOLDOWN_SEC))} cool down`);
    b.steps.push({
      kind: "cooldown",
      label: blocks.cooldown,
      duration_sec: parseLeadingMinutes(blocks.cooldown, DEFAULT_STRENGTH_COOLDOWN_SEC),
    });
    endSection(sec, b);
  }

  appendMobility(b, blocks.mobility_min, blocks.mobility_focus);

  // Finisher — same circuit expansion, distinct circuitId.
  appendFinisher(b, blocks.finisher);
}

/** Mobility added by a check-in adjustment ("10 min mobility (shoulder)"). */
function appendMobility(b: Builder, minutes: number | null | undefined, focus: string[] | null | undefined): void {
  if (!minutes || minutes <= 0) return;
  const what = focus && focus.length > 0 ? ` (${focus.join(", ")})` : "";
  const label = `${minutes} min mobility${what}`;
  const sec = startSection(b, "mobility", label);
  b.steps.push({
    kind: "exercise",
    label,
    duration_sec: minutes * 60,
    exerciseRef: { name: "Mobility", format: "duration", duration_sec: minutes * 60 },
  });
  endSection(sec, b);
}

function buildIntervalsCardio(b: Builder, blocks: IntervalsBlocks): void {
  if (blocks.warmup_sec && blocks.warmup_sec > 0) {
    const sec = startSection(b, "warmup", `${formatMin(blocks.warmup_sec)} warmup`);
    b.steps.push({
      kind: "warmup",
      label: blocks.warmup_settings ?? "Warmup",
      duration_sec: blocks.warmup_sec,
    });
    endSection(sec, b);
  }
  const rounds = Math.max(1, blocks.rounds ?? 1);
  const t = blocks.intervals_template;
  if (t && typeof t.work_sec === "number" && typeof t.rest_sec === "number") {
    const sec = startSection(b, "intervals", `${rounds} × Intervals`, rounds);
    const workEx: PlannedExercise = {
      name: t.work_settings ?? "Work",
      format: "duration",
      duration_sec: t.work_sec,
    };
    b.steps.push({
      kind: "exercise",
      label: t.work_settings ?? "Work",
      duration_sec: t.work_sec,
      exerciseRef: workEx,
      totalRounds: rounds,
      circuitId: "main",
    });
    if (rounds > 1) {
      b.steps.push({
        kind: "rest",
        label: t.rest_settings ?? "Rest",
        duration_sec: t.rest_sec,
        precedingExerciseRef: workEx,
        totalRounds: rounds,
        circuitId: "main",
        isRoundBreak: true,
      });
    }
    endSection(sec, b);
  }
  if (blocks.cooldown_sec && blocks.cooldown_sec > 0) {
    const sec = startSection(b, "cooldown", `${formatMin(blocks.cooldown_sec)} cool down`);
    b.steps.push({
      kind: "cooldown",
      label: blocks.cooldown_settings ?? "Cooldown",
      duration_sec: blocks.cooldown_sec,
    });
    endSection(sec, b);
  }
  appendFinisher(b, blocks.finisher);
}

function buildSteady(b: Builder, blocks: SteadyBlocks): void {
  if (blocks.warmup_sec && blocks.warmup_sec > 0) {
    const sec = startSection(b, "warmup", `${formatMin(blocks.warmup_sec)} warmup`);
    b.steps.push({
      kind: "warmup",
      label: blocks.warmup_settings ?? "Warmup",
      duration_sec: blocks.warmup_sec,
    });
    endSection(sec, b);
  }
  const mainSec = Math.max(60, (blocks.duration_min ?? 0) * 60);
  if (mainSec > 0) {
    const rangeDesc = Array.isArray(blocks.target_range_min)
      ? `${blocks.target_range_min[0]}–${blocks.target_range_min[1]} min`
      : typeof blocks.target_range_min === "string"
      ? blocks.target_range_min
      : undefined;
    const title = blocks.display_name ?? "Steady cardio";
    const sec = startSection(b, "steady", title);
    b.steps.push({
      kind: "exercise",
      label: blocks.intensity || rangeDesc || title,
      duration_sec: mainSec,
      exerciseRef: { name: title, format: "duration", duration_sec: mainSec },
    });
    endSection(sec, b);
  }
  if (blocks.cooldown_sec && blocks.cooldown_sec > 0) {
    const sec = startSection(b, "cooldown", `${formatMin(blocks.cooldown_sec)} cool down`);
    b.steps.push({
      kind: "cooldown",
      label: blocks.cooldown_settings ?? "Cooldown",
      duration_sec: blocks.cooldown_sec,
    });
    endSection(sec, b);
  }
  appendMobility(b, blocks.mobility_min, blocks.mobility_focus);
  appendFinisher(b, blocks.finisher);
}

function buildMobility(b: Builder, blocks: MobilityBlocks): void {
  const sec_dur = Math.max(60, (blocks.duration_min ?? 20) * 60);
  const sec = startSection(b, "mobility", blocks.display_name ?? "Mobility");
  b.steps.push({
    kind: "exercise",
    label: blocks.display_name ?? "Mobility",
    duration_sec: sec_dur,
    exerciseRef: {
      name: blocks.display_name ?? "Mobility",
      format: "duration",
      duration_sec: sec_dur,
    },
  });
  endSection(sec, b);
  appendFinisher(b, blocks.finisher);
}

function buildWalk(b: Builder, blocks: WalkBlocks): void {
  const sec_dur = Math.max(60, blocks.duration_min * 60);
  const sec = startSection(b, "walk", blocks.display_name ?? "Walk");
  b.steps.push({
    kind: "exercise",
    label: blocks.display_name ?? "Walk",
    duration_sec: sec_dur,
    exerciseRef: {
      name: blocks.display_name ?? "Walk",
      format: "duration",
      duration_sec: sec_dur,
    },
  });
  endSection(sec, b);
  appendFinisher(b, blocks.finisher);
}

function appendFinisher(b: Builder, f: Finisher | null | undefined): void {
  const exercises = finisherExercisesOf(f);
  if (exercises.length === 0) return;
  const rounds = Math.max(1, f?.rounds ?? 1);
  const breakSec = f?.rest_after_sec ?? DEFAULT_FINISHER_ROUND_BREAK_SEC;
  const title = f?.display_name ?? `Finisher${rounds > 1 ? ` × ${rounds}` : ""}`;
  const sec = startSection(b, "finisher", title, rounds);
  for (let i = 0; i < exercises.length; i++) {
    const ex = exercises[i];
    const isLastEx = i === exercises.length - 1;
    b.steps.push({
      kind: "exercise",
      label: ex.name,
      duration_sec: workDurationForExercise(ex),
      exerciseRef: ex,
      totalRounds: rounds > 1 ? rounds : undefined,
      circuitId: "finisher",
      holdAtEnd: ex.format === "reps",
    });
    if (!isLastEx) {
      b.steps.push({
        kind: "rest",
        label: "Rest",
        duration_sec: ex.rest_after_sec ?? DEFAULT_EXERCISE_REST_SEC,
        precedingExerciseRef: ex,
        totalRounds: rounds > 1 ? rounds : undefined,
        circuitId: "finisher",
        holdAtEnd: ex.format === "reps",
      });
    } else if (rounds > 1) {
      b.steps.push({
        kind: "rest",
        label: "Between rounds",
        duration_sec: breakSec,
        precedingExerciseRef: ex,
        totalRounds: rounds,
        circuitId: "finisher",
        holdAtEnd: ex.format === "reps",
        isRoundBreak: true,
      });
    }
  }
  endSection(sec, b);
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

/** Recovery Flow: the player (FlowScreen) runs its own timeline; here each
 * timed item becomes one auto-advancing step so counts and the map agree. */
function buildRecoveryFlow(b: Builder, blocks: RecoveryFlowBlocks) {
  for (const item of buildFlowTimeline(blocks)) {
    b.steps.push({ kind: item.kind === "pose" ? "exercise" : "cooldown", label: item.title,
      duration_sec: item.duration_sec });
  }
}

export function flattenBlocksToSteps(blocks: Blocks): FlatSession {
  const b: Builder = { steps: [], sections: [] };
  switch (blocks.type) {
    case "circuit":   buildCircuit(b, blocks); break;
    case "intervals": buildIntervalsCardio(b, blocks); break;
    case "steady":    buildSteady(b, blocks); break;
    case "mobility":  buildMobility(b, blocks); break;
    case "walk":      buildWalk(b, blocks); break;
    case "recovery_flow": buildRecoveryFlow(b, blocks); break;
    default:          return assertNeverBlock(blocks);
  }
  return { steps: b.steps, sections: b.sections, source: blocks };
}

// ---------------------------------------------------------------------------
// Cursor — drives the timer AND tells the map which step is current.
// ---------------------------------------------------------------------------

export interface Cursor {
  stepIndex: number;
  currentRound: number; // 1-indexed inside a circuit; 1 elsewhere
}

export const INITIAL_CURSOR: Cursor = { stepIndex: 0, currentRound: 1 };

function findCircuitStartIndex(steps: Step[], idx: number, circuitId: string): number {
  let i = idx;
  while (i > 0 && steps[i - 1]?.circuitId === circuitId) i--;
  return i;
}

function inactive(step: Step | undefined, round: number): boolean {
  return !!step && !step.isRoundBreak && step.activeRounds != null && round > step.activeRounds;
}

/** First step at or after `idx` that runs in `round`, staying inside the
 * circuit; skips this circuit's round-break on its last round. */
function settle(steps: Step[], idx: number, round: number, circuitId: string | undefined): number {
  let i = idx;
  while (i < steps.length && steps[i].circuitId === circuitId && circuitId) {
    const s = steps[i];
    if (inactive(s, round)) { i++; continue; }
    if (s.isRoundBreak && s.totalRounds === round) { i++; continue; }
    break;
  }
  return i;
}

/** Advance one step. Handles round-wrap at the round-break rest and skips
 * the round-break entirely on the last round. Exercises with fewer sets than
 * the circuit has rounds (a check-in adjustment) are skipped in the rounds
 * they don't run. Returns null at end. */
export function nextCursor(steps: Step[], cur: Cursor): Cursor | null {
  const plain = nextCursorPlain(steps, cur);
  if (!plain) return null;
  const s = steps[plain.stepIndex];
  const circuit = s.circuitId;
  if (!circuit || !steps.some((x) => x.circuitId === circuit && x.activeRounds != null)) {
    return plain;
  }
  const { currentRound } = plain;
  const idx = settle(steps, plain.stepIndex, currentRound, circuit);
  if (idx >= steps.length) return null;
  const at = steps[idx];
  if (at.circuitId !== circuit) return { stepIndex: idx, currentRound: 1 };
  if (at.isRoundBreak && at.totalRounds && currentRound < at.totalRounds) {
    // Nothing left to do next round (every exercise's sets are done)? Leave.
    const start = findCircuitStartIndex(steps, idx, circuit);
    const nextAt = steps[settle(steps, start, currentRound + 1, circuit)];
    if (!nextAt || nextAt.circuitId !== circuit || nextAt.isRoundBreak) {
      let out = idx + 1;
      while (out < steps.length && steps[out].circuitId === circuit) out++;
      return out < steps.length ? { stepIndex: out, currentRound: 1 } : null;
    }
  }
  return { stepIndex: idx, currentRound };
}

function nextCursorPlain(steps: Step[], cur: Cursor): Cursor | null {
  const s = steps[cur.stepIndex];
  if (!s) return null;

  // Round-break rest: wrap on non-last round, skip on last round.
  if (s.isRoundBreak && s.totalRounds && s.circuitId) {
    if (cur.currentRound < s.totalRounds) {
      const startIdx = findCircuitStartIndex(steps, cur.stepIndex, s.circuitId);
      const round = cur.currentRound + 1;
      return { stepIndex: settle(steps, startIdx, round, s.circuitId), currentRound: round };
    }
    // On the last round we should not be sitting on a round-break — TICK
    // is supposed to skip it. If we get here, treat as advance past.
  }

  // Look-ahead: if next step is the round-break of this circuit and we're
  // already on the last round, skip it.
  let nextIdx = cur.stepIndex + 1;
  const candidate = steps[nextIdx];
  if (
    candidate &&
    candidate.isRoundBreak &&
    candidate.totalRounds &&
    candidate.totalRounds === cur.currentRound &&
    candidate.circuitId === s.circuitId
  ) {
    nextIdx += 1;
  }

  if (nextIdx >= steps.length) return null;
  const nextStep = steps[nextIdx];
  // Entering a different circuit (or leaving one): reset round counter.
  const sameCircuit = !!nextStep.circuitId && nextStep.circuitId === s.circuitId;
  return {
    stepIndex: nextIdx,
    currentRound: sameCircuit ? cur.currentRound : 1,
  };
}

/** Step backward. Mirror of nextCursor; clamps at 0. Round handling is a
 * best-effort approximation since "back" inside a circuit is ambiguous. */
export function prevCursor(steps: Step[], cur: Cursor): Cursor {
  if (cur.stepIndex <= 0) return cur;
  const prevIdx = cur.stepIndex - 1;
  const prevStep = steps[prevIdx];
  const curStep = steps[cur.stepIndex];
  // If we're crossing a circuit boundary backwards, keep the round of the
  // circuit we're entering (1 if unknown).
  if (!curStep || !prevStep) return { stepIndex: prevIdx, currentRound: 1 };
  const sameCircuit = !!curStep.circuitId && curStep.circuitId === prevStep.circuitId;
  return {
    stepIndex: prevIdx,
    currentRound: sameCircuit ? cur.currentRound : 1,
  };
}

export function isFirstCursor(_steps: Step[], cur: Cursor): boolean {
  return cur.stepIndex <= 0 && cur.currentRound <= 1;
}

export function isLastCursor(steps: Step[], cur: Cursor): boolean {
  return nextCursor(steps, cur) === null;
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

function formatMin(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s === 0 ? `${m}:00` : `${m}:${s.toString().padStart(2, "0")}`;
}

export function totalDurationSec(session: FlatSession): number {
  // For a circuit, each in-circuit step is hit `totalRounds` times. Roughly
  // — we treat round_break as counting on rounds-1 only (not the last).
  let total = 0;
  for (const s of session.steps) {
    if (s.circuitId && s.totalRounds && s.totalRounds > 1) {
      if (s.isRoundBreak) {
        total += s.duration_sec * (s.totalRounds - 1);
      } else {
        total += s.duration_sec * s.totalRounds;
      }
    } else {
      total += s.duration_sec;
    }
  }
  return total;
}
