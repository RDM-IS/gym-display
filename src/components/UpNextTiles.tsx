import StrengthTiles from "./StrengthTiles";
import { lastShownFor, type SessionSets } from "../lib/log-state";
import type { LastLoggedEntry, Plan, PlannedExercise } from "../lib/types";

// GD-REST-TILES (Ryan, 2026-09-23) — the rest screen's upper right.
//
// The same three tiles as the active set (REPS, RPE with its reps-left line,
// LAST), scaled down, for the exercise the rest leads INTO. The "Next: …"
// label is folded in here rather than repeated beside the timer.
//
// LAST follows GD-LAST-ROUND: the most recent logged set, today's rounds
// included. A first-time exercise shows "first time", which is what the tile
// already says when there is no history.
//
// `exercise` null → nothing renders. That is the final rest, where the only
// honest thing to show is nothing.

export default function UpNextTiles({
  plan,
  exercise,
  sessionSets,
  lastLogged,
}: {
  plan: Plan;
  exercise: PlannedExercise | null;
  sessionSets: SessionSets;
  lastLogged: Record<string, LastLoggedEntry>;
}) {
  if (!exercise) return null;
  const shown = lastShownFor(exercise.name, sessionSets, lastLogged);
  const cap = exercise.rpe_cap ?? plan.blocks?.rpe_cap ?? plan.target_rpe ?? null;
  return (
    <div className="upnext" data-testid="upnext-tiles">
      <div className="upnext-name" data-testid="upnext-name">Next: {exercise.name}</div>
      <StrengthTiles
        compact
        reps={exercise.format === "reps" ? exercise.target_reps ?? null : null}
        cap={cap}
        last={shown?.entry ?? null}
        lastRound={shown?.round ?? null}
      />
    </div>
  );
}
