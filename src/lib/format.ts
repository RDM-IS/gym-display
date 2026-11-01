import type { Plan, SessionType } from "./types";

export type { SessionType } from "./types";

// NAMING (Ryan, 2026-09-28): a session name says WHAT, never WHERE -- the
// location is its own field and its own chip. This map is a LAST-RESORT fallback
// for a row that carries no `blocks.display_name`; artemis's
// health_office.display_name_for() is the source of truth and every seeded row
// carries its answer. Keep the two in step: a name here that artemis does not
// emit is drift, and it shows up as the iPad calling a session something the
// morning post does not.
const SESSION_LABELS: Record<SessionType, string> = {
  rest: "Rest",
  strength_a: "Strength A",
  strength_b: "Strength B",
  strength_c: "Strength C",
  strength_full: "Full Body",
  cardio_intervals: "Intervals",
  cardio_z2: "Zone 2",
  walk: "Walk",
  rest_mobility: "Rest / Mobility",
  recovery_flow: "Recovery Flow",
  yoga_strength: "Yoga — Strength & Balance",
  core: "Core (easy)",
  mobility: "Mobility",
  bodyweight_circuit: "Bodyweight circuit",
};

/** Strength session types (WEEK-TEMPLATE adds strength_full, 2026-11-01). One
 * list for every screen that has to tell strength from everything else. */
export const STRENGTH_TYPES: ReadonlySet<string> = new Set<SessionType>([
  "strength_a", "strength_b", "strength_c", "strength_full",
]);

const STRENGTH_SUFFIX: Record<string, string> = {
  strength_a: "A", strength_b: "B", strength_c: "C", strength_full: "— Full Body",
};

/** Button/tile label for a strength session: "Strength A" … "Strength — Full
 * Body". An unknown type reads plain "Strength" rather than a raw key. */
export function strengthLabel(sessionType: string | null | undefined): string {
  const suffix = sessionType ? STRENGTH_SUFFIX[sessionType] : undefined;
  return suffix ? `Strength ${suffix}` : "Strength";
}

export function sessionLabel(plan: Plan | { session_type: SessionType }): string {
  return SESSION_LABELS[plan.session_type] ?? plan.session_type;
}

/** Title shown on Setup and elsewhere. Prefers blocks.display_name
 * (e.g. "Long Z2 Bike") since two days can share session_type but be
 * different workouts (Sat/Sun both cardio_z2). Falls back to the
 * session_type label. */
export function displayTitle(plan: Plan): string {
  const name = plan.blocks?.display_name?.trim();
  return name ? name : sessionLabel(plan);
}

export function dedupe(items: string[] | undefined): string[] {
  if (!items) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const v = raw.trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

export function formatPlanDate(plan: Plan): string {
  const [y, m, d] = plan.plan_date.split("-").map((s) => parseInt(s, 10));
  if (!y || !m || !d) return plan.plan_date;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** TIME-CAP (2026-09-19): 45 min is a target, not a limit. An estimate over
 * it reads "~52 min"; at or under it, "40 min". No warnings, no apologies. */
export const TARGET_MIN = 45;

export function formatEstimate(minutes: number | null | undefined): string {
  if (minutes == null) return "";
  return minutes > TARGET_MIN ? `~${minutes} min` : `${minutes} min`;
}
