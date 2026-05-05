import type { Plan, SessionType } from "./types";

const SESSION_LABELS: Record<SessionType, string> = {
  strength_a: "Strength A",
  strength_b: "Strength B",
  strength_c: "Strength C",
  cardio_intervals: "Cardio Intervals",
  cardio_z2: "Cardio Z2",
  walk: "Walk",
  rest_mobility: "Rest / Mobility",
};

export function sessionLabel(plan: Plan): string {
  return SESSION_LABELS[plan.session_type] ?? plan.session_type;
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
