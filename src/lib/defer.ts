import type { Blocks, CircuitBlocks } from "./types";
import { flattenBlocksToSteps, type Cursor, type Step } from "./steps";

// ---------------------------------------------------------------------------
// GD-DEFER — "Busy — later": a machine is taken, so swap that exercise with
// the next one in this round and come back to it one slot later.
//
// A defer rebuilds the circuit from the plan's blocks with the two exercises
// swapped, so every logging rest (and the round break) stays attached to the
// right exercise and the journey map follows automatically. The step count is
// unchanged, so sections and the round-break index don't move. The plan order
// comes back when the round ends. Deferring again ("still busy") just swaps
// again; the last active exercise of a round has nothing to swap with.
// ---------------------------------------------------------------------------

export const MAIN = "main";

function inactiveIn(step: Step, round: number): boolean {
  return step.activeRounds != null && round > step.activeRounds;
}

/** Index of the next exercise step after `fromIdx` in the main circuit that
 * runs in `round`, or null when there is none left in this round. */
export function nextActiveExercise(steps: Step[], fromIdx: number, round: number): number | null {
  for (let i = fromIdx + 1; i < steps.length; i++) {
    const s = steps[i];
    if (s.circuitId !== MAIN) return null;
    if (s.kind === "exercise" && !inactiveIn(s, round)) return i;
  }
  return null;
}

/** The exercise step that follows a (non round-break) rest in this round. */
export function upcomingExercise(steps: Step[], restIdx: number, round: number): number | null {
  const rest = steps[restIdx];
  if (!rest || rest.kind !== "rest" || rest.isRoundBreak || rest.circuitId !== MAIN) return null;
  return nextActiveExercise(steps, restIdx, round);
}

/** A strength (reps) exercise in the main circuit — the only kind a machine
 * can be "busy" for. */
export function isDeferrable(step: Step | undefined): boolean {
  return !!step && step.kind === "exercise" && step.circuitId === MAIN
    && step.exerciseRef?.format === "reps";
}

/** The circuit's blocks with exercises `a` and `b` (by name) swapped. */
export function swapExercises(blocks: CircuitBlocks, a: string, b: string): CircuitBlocks {
  const list = [...(blocks.exercises ?? [])];
  const i = list.findIndex((e) => e.name === a);
  const j = list.findIndex((e) => e.name === b);
  if (i < 0 || j < 0) return blocks;
  [list[i], list[j]] = [list[j], list[i]];
  return { ...blocks, exercises: list };
}

export interface DeferResult {
  steps: Step[];
  /** Blocks in the current (swapped) order, for a further defer. */
  blocks: CircuitBlocks;
  /** Where the swapped-in exercise now sits (the deferred one's old index). */
  swappedInIndex: number;
  deferredName: string;
}

/** Swap the exercise at `exIdx` with the next active one this round.
 * null when it's the last one left in the round (nothing to swap with). */
export function deferExercise(blocks: Blocks, steps: Step[], exIdx: number, round: number): DeferResult | null {
  if (blocks.type !== "circuit") return null;
  const ex = steps[exIdx];
  if (!isDeferrable(ex)) return null;
  const nextIdx = nextActiveExercise(steps, exIdx, round);
  if (nextIdx === null) return null;
  const a = ex.exerciseRef!.name;
  const b = steps[nextIdx].exerciseRef!.name;
  const swapped = swapExercises(blocks, a, b);
  const rebuilt = flattenBlocksToSteps(swapped).steps;
  if (rebuilt.length !== steps.length) return null;   // defensive: shape must not change
  return { steps: rebuilt, blocks: swapped, swappedInIndex: exIdx, deferredName: a };
}

/** True when moving from `from` to `to` leaves the current round of the main
 * circuit (round wrap, or out of the circuit) — the plan order comes back. */
export function leavesRound(steps: Step[], from: Cursor, to: Cursor): boolean {
  const a = steps[from.stepIndex];
  const b = steps[to.stepIndex];
  if (a?.circuitId !== MAIN) return false;
  return b?.circuitId !== MAIN || to.currentRound !== from.currentRound;
}
