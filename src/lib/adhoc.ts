import type { LogExerciseIn, LogResponse } from "./types";

// ---------------------------------------------------------------------------
// ADHOC-LOG / SESSION-LIB — logging a session started outside the schedule.
//
// A launched session runs through the ordinary screens with plan_id
// ADHOC_PLAN_ID. Every log goes through submitLog, which calls applyAdhoc():
// the placeholder becomes `adhoc_session_type` on the first write, and the
// Lambda either attaches it to today's open row of that type (and says which,
// in `plan_id`) or stores it unattached. Later writes of the same session
// carry the returned plan_id, so one session never splits across both.
// Rewritten BEFORE queueing, so a reload never replays a placeholder.
// ---------------------------------------------------------------------------

export const ADHOC_PLAN_ID = 0;

interface Active {
  sessionType: string;
  planId: number | null;
}

let active: Active | null = null;

export function startAdhoc(sessionType: string): void {
  active = { sessionType, planId: null };
}

export function endAdhoc(): void {
  active = null;
}

export function adhocState(): Readonly<Active> | null {
  return active;
}

export function applyAdhoc(body: LogExerciseIn): LogExerciseIn {
  if (body.plan_id !== ADHOC_PLAN_ID || !active) return body;
  if (active.planId !== null) return { ...body, plan_id: active.planId };
  const { plan_id: _placeholder, ...rest } = body;
  return { ...rest, adhoc_session_type: active.sessionType };
}

/** The server attached the session to a plan row — send that from now on. */
export function noteAdhocResponse(data: LogResponse): void {
  if (active && active.planId === null && data.plan_id != null) active.planId = data.plan_id;
}
