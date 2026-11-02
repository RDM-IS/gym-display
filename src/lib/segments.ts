import type { CircuitBlocks, CircuitSegment, PlannedExercise } from "./types";

// ---------------------------------------------------------------------------
// FULLBODY-1 (2026-11-01): a segmented circuit. Artemis emits strength_full
// rows as a normal circuit plus `segments`, and every exercise names its
// segment by index. `blocks.rounds` is still there (the largest segment's) for
// older consumers and is ignored when segments are in use.
//
// One reading for every consumer — the step builder, the set counts and the
// plan screens — so "how many rounds does this exercise run" has one answer.
// ---------------------------------------------------------------------------

function validSegment(ex: PlannedExercise, count: number): boolean {
  return typeof ex.segment === "number" && Number.isInteger(ex.segment)
    && ex.segment >= 0 && ex.segment < count;
}

/** The segments to build from, or null for the legacy single body. Null when
 * there are none — and also when any exercise names no valid segment: dropping
 * it would silently hide planned work, so the list runs as one circuit. */
export function segmentsInUse(blocks: Pick<CircuitBlocks, "segments" | "exercises">): CircuitSegment[] | null {
  const segs = blocks.segments;
  if (!Array.isArray(segs) || segs.length === 0) return null;
  const exercises = Array.isArray(blocks.exercises) ? blocks.exercises : [];
  return exercises.every((ex) => validSegment(ex, segs.length)) ? segs : null;
}

export function segmentRounds(seg: CircuitSegment): number {
  return Math.max(1, seg.rounds ?? 1);
}

/** Rounds of the body `ex` belongs to (its segment's, else the circuit's). */
export function roundsForExercise(blocks: CircuitBlocks, ex: PlannedExercise): number {
  const segs = segmentsInUse(blocks);
  if (segs && typeof ex.segment === "number") return segmentRounds(segs[ex.segment]);
  return Math.max(1, blocks.rounds ?? 1);
}
