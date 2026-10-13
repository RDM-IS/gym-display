import { INITIAL_CURSOR, nextCursor, type Cursor, type Step } from "./steps";

// ---------------------------------------------------------------------------
// GD-RESUME (Ryan, 2026-10-13): after a reload, Home → Start, or "Restart
// workout", the timer cursor starts over at step 0 / round 1 while the set
// NUMBER came from how many sets were already logged. The two drifted apart:
// round 1 of the first exercise showed "Set 3 of 3", logged set 3, and the
// next time round that exercise was "fully logged" — no stepper, no RPE.
//
// Two fixes, one walk:
//   - visitIndexAt: which visit of an exercise the cursor is on (the round, for
//     a plain circuit). "Is this set done?" is asked against the visit, never
//     against the count alone, so the cursor and the logger can't disagree.
//   - resumeCursor: where to put the cursor on a resumed workout — the first
//     visit whose set isn't logged yet.
// ---------------------------------------------------------------------------

/** Guard against a malformed step list looping forever. */
const MAX_WALK = 5000;

/** 1-based visit of `name` at `cursor`, counting exercise steps walked from the
 * start of the session up to and including the cursor. A rest counts the
 * exercise before it. Falls back to the cursor's round if the walk never
 * reaches the cursor (it always should). */
export function visitIndexAt(steps: Step[], cursor: Cursor, name: string): number {
  let c: Cursor | null = INITIAL_CURSOR;
  let visits = 0;
  for (let i = 0; c && i < MAX_WALK; i++) {
    const s = steps[c.stepIndex];
    if (s?.kind === "exercise" && s.exerciseRef?.name === name) visits++;
    if (c.stepIndex === cursor.stepIndex && c.currentRound === cursor.currentRound) {
      return Math.max(1, visits);
    }
    c = nextCursor(steps, c);
  }
  return Math.max(1, cursor.currentRound);
}

/** Where a resumed workout should pick up: the first exercise visit whose set
 * isn't logged yet. Null when nothing is logged (start from the top, warmup
 * included) or when everything is (leave the cursor alone). */
export function resumeCursor(
  steps: Step[],
  planExerciseNames: readonly string[],
  loggedCount: (name: string) => number,
): Cursor | null {
  if (!planExerciseNames.some((n) => loggedCount(n) > 0)) return null;
  const visits: Record<string, number> = {};
  let c: Cursor | null = INITIAL_CURSOR;
  for (let i = 0; c && i < MAX_WALK; i++) {
    const s = steps[c.stepIndex];
    const name = s?.kind === "exercise" ? s.exerciseRef?.name : undefined;
    if (name && planExerciseNames.includes(name)) {
      const v = (visits[name] = (visits[name] ?? 0) + 1);
      if (loggedCount(name) < v) return c;
    }
    c = nextCursor(steps, c);
  }
  return null;
}

/** The set a visit logs, and whether it is already in.
 *  Already logged (count ≥ visit) → that visit's set, shown as done.
 *  Otherwise → the next unlogged set number, so a skipped round never leaves
 *  a gap in set_num. */
export function setForVisit(visit: number, logged: number): { setNum: number; done: boolean } {
  return logged >= visit ? { setNum: visit, done: true } : { setNum: logged + 1, done: false };
}
