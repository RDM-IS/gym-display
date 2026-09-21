import type { SessionDayRow, SessionSetRow } from "./types";
import type { Step } from "./steps";

// GD-STRENGTH-CUES (Ryan, 2026-09-20) — strength sessions only. The beeps stay
// exactly as they are; this adds voice and one on-screen block on top.
//
// Two pieces:
//   1. the target block under the exercise name, whose third line translates
//      the RPE cap into reps-in-reserve — the thing the number actually means;
//   2. one spoken prompt in the rest period BEFORE each new exercise.
//
// The average here is for the SPOKEN sentence only. /last_logged, the
// on-screen "Last:" hint and the stepper prefill keep using the most recent
// set, because the top set is the right thing to prefill against (Ryan).

/** The cap, said in the only units that mean anything mid-set. */
export const REPS_LEFT_BY_CAP: Record<string, string> = {
  "6": "stop with ~4 reps left",
  "7": "~3 reps left",
  "7.5": "~2–3 reps left",
  "8": "~2 reps left",
};

/** The third line of the target block. Null for a cap with no entry — better
 * silent than a number translated wrongly. */
export function repsLeftHint(cap: number | null | undefined): string | null {
  if (cap === null || cap === undefined || !Number.isFinite(cap)) return null;
  // 6.0 and 6 are the same cap; 7.50 is the 7.5 row.
  return REPS_LEFT_BY_CAP[String(Number(cap))] ?? null;
}

export interface SetAverage {
  /** Nearest pound. Null when nothing in that session carried a weight. */
  weight_lbs: number | null;
  /** Nearest whole rep. Null when nothing carried reps. */
  reps: number | null;
  /** Nearest 0.5. Null when no set in that session had an RPE. */
  rpe: number | null;
  /** The session those sets came from. */
  date: string;
  sets: number;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round5 = (n: number) => Math.round(n * 2) / 2;

function usable(s: SessionSetRow, name: string): boolean {
  return s.exercise === name && !s.is_skipped && s.log_type === "strength_set"
    && s.logged_via !== "inferred";
}

/** The mean across ALL sets of `name` in the most recent session BEFORE
 * `today` that logged any — not the top set, and not today's own work.
 *
 * Skipped sets are excluded: Ryan pressed Skip on them, so they are a decision
 * about the slot rather than a set he did. Each field averages independently,
 * so one set logged without an RPE doesn't discard the others' RPE.
 */
export function lastSessionAverage(
  days: SessionDayRow[],
  name: string,
  today: string,
): SetAverage | null {
  const earlier = days
    .filter((d) => d.plan_date < today)
    .sort((a, b) => b.plan_date.localeCompare(a.plan_date));
  for (const day of earlier) {
    const sets = (day.sets ?? []).filter((s) => usable(s, name));
    if (!sets.length) continue;
    const weights = sets.map((s) => s.weight_lbs).filter((n): n is number => n != null);
    const reps = sets.map((s) => s.reps_done).filter((n): n is number => n != null);
    const rpes = sets.map((s) => s.rpe_actual).filter((n): n is number => n != null);
    return {
      weight_lbs: weights.length ? Math.round(mean(weights)) : null,
      reps: reps.length ? Math.round(mean(reps)) : null,
      rpe: rpes.length ? round5(mean(rpes)) : null,
      date: day.plan_date,
      sets: sets.length,
    };
  }
  return null;
}

/** "Your last sets averaged RPE 6 at 150 pounds for 12 reps."
 *
 * Bodyweight omits the weight. No RPE on any set omits that clause. Nothing
 * to say at all → null, and the caller says "First time logging this one." */
export function lastSetsSentence(avg: SetAverage | null, bodyweight = false): string | null {
  if (!avg) return null;
  const parts: string[] = [];
  if (avg.rpe != null) parts.push(`RPE ${fmt(avg.rpe)}`);
  if (!bodyweight && avg.weight_lbs != null) parts.push(`at ${avg.weight_lbs} pounds`);
  if (avg.reps != null) parts.push(`for ${avg.reps} ${avg.reps === 1 ? "rep" : "reps"}`);
  if (!parts.length) return null;
  return `Your last sets averaged ${parts.join(" ")}.`;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n);
}

export interface PromptInput {
  name: string;
  /** Planned reps for this exercise, when it is a reps exercise. */
  reps?: number | null;
  /** The RPE cap for the session or the exercise. */
  cap?: number | null;
  bodyweight?: boolean;
  average: SetAverage | null;
}

/** "Next exercise is leg press. 12 reps at RPE 6. Your last sets averaged
 * RPE 6 at 150 pounds for 12 reps." */
export function exercisePrompt(p: PromptInput): string {
  const out = [`Next exercise is ${p.name.toLowerCase()}.`];
  const target: string[] = [];
  if (p.reps != null) target.push(`${p.reps} ${p.reps === 1 ? "rep" : "reps"}`);
  if (p.cap != null) target.push(`${target.length ? "at " : ""}RPE ${fmt(p.cap)}`);
  if (target.length) out.push(`${target.join(" ")}.`);
  out.push(lastSetsSentence(p.average, p.bodyweight) ?? "First time logging this one.");
  return out.join(" ");
}

/** Roughly how long `text` takes to say at `rate`.
 *
 * Deliberately generous: the cost of over-estimating is a prompt Ryan doesn't
 * hear, and the cost of under-estimating is a voice still talking when the set
 * starts. ~2.4 words/second at rate 1, scaled by the configured rate. */
export function utteranceMs(text: string, rate = 0.85): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.round(((words / 2.4) * 1000) / Math.max(0.1, rate)) + 400;
}

/** Say it only when the rest period is long enough to finish — otherwise the
 * voice would still be going when the next set starts. */
export function fitsInRest(text: string, restSec: number, rate = 0.85): boolean {
  return utteranceMs(text, rate) <= restSec * 1000;
}


/** Should the step at `index` speak the next exercise's prompt?
 *
 * Yes exactly when it is a rest that PRECEDES a different exercise, and that
 * exercise hasn't been announced yet. So:
 *   - never between sets of the same exercise (the rest's preceding exercise
 *     is the same one that's coming up);
 *   - never before the first exercise (nothing rests ahead of it);
 *   - never on a round break (that is a round change, not a new exercise);
 *   - once per exercise, however many rounds it appears in.
 */
export function promptTarget(
  steps: Step[],
  index: number,
  alreadySpoken: ReadonlySet<string>,
): { exercise: NonNullable<Step["exerciseRef"]>; restSec: number } | null {
  const step = steps[index];
  if (!step || step.kind !== "rest" || step.isRoundBreak) return null;
  const next = steps[index + 1];
  if (!next || next.kind !== "exercise") return null;
  const ex = next.exerciseRef;
  if (!ex) return null;
  if (step.precedingExerciseRef?.name === ex.name) return null;
  if (alreadySpoken.has(ex.name)) return null;
  return { exercise: ex, restSec: step.duration_sec };
}
