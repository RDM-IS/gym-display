import type { Plan, PlanAdjustment, PlannedExercise } from "./types";

// ---------------------------------------------------------------------------
// Check-in adjustments (Artemis FRIDAY-1). Artemis rewrites today's plan row
// and records what changed in blocks.adjustment; the app only reads it.
// ---------------------------------------------------------------------------

export function adjustmentOf(plan: Plan | null | undefined): PlanAdjustment | null {
  const a = plan?.blocks?.adjustment;
  return a && typeof a === "object" ? a : null;
}

/** "shoulder 4/5" from "Shoulder 4/5 → removed …". */
export function adjustmentHeadline(a: PlanAdjustment): string {
  const first = (a.summary ?? [])[0] ?? a.reason ?? "";
  const head = first.split("→")[0].trim().replace(/[.:]$/, "");
  if (!head) return "today's check-in";
  return head.charAt(0).toLowerCase() + head.slice(1);
}

/** Changes that matter for what's on screen — ignores key order. */
export function planFingerprint(plan: Plan | null | undefined): string {
  if (!plan) return "";
  return JSON.stringify([plan.plan_id, plan.session_type, plan.target_rpe, plan.est_duration_min,
    sortKeys(plan.blocks)]);
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

/** Sets for one exercise inside a circuit of `rounds`. */
export function exerciseSets(ex: PlannedExercise, rounds: number): number {
  return ex.sets != null && ex.sets > 0 ? Math.min(ex.sets, Math.max(1, rounds)) : Math.max(1, rounds);
}

/** Short badges for an adjusted exercise: "RPE ≤5", "load −20%", "added". */
export function exerciseTags(ex: PlannedExercise, sessionRpe?: number | null): string[] {
  const tags: string[] = [];
  const cap = ex.rpe_cap ?? sessionRpe ?? null;
  if (ex.rpe_cap != null || sessionRpe != null) {
    if (cap != null) tags.push(`RPE ≤${fmt(cap)}`);
  }
  if (ex.load_pct != null && ex.load_pct < 100) tags.push(`load −${100 - ex.load_pct}%`);
  if (ex.added_by === "checkin") tags.push(ex.replaces ? `added (for ${ex.replaces})` : "added");
  return tags;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}
