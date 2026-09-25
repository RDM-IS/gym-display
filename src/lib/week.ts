import type { PlanDay, PlanDayStatus, PlanRangeResponse } from "./types";

// ---------------------------------------------------------------------------
// GD-WEEK — program-week math and status icons. Dates are YYYY-MM-DD strings
// (plan dates, already in Artemis's active timezone); arithmetic is done in UTC
// so the iPad's own zone never shifts a day.
// ---------------------------------------------------------------------------

/** Program weeks run Wednesday–Tuesday (office program, anchored Wed 9/16). */
export const WEEK_START_DOW = 3;
export const DELOAD_WEEK = 7;

function toUtc(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  const d = toUtc(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUtc(d);
}

/** The Wednesday that starts the program week containing `iso`. */
export function programWeekStart(iso: string): string {
  const dow = toUtc(iso).getUTCDay();
  return addDays(iso, -((dow - WEEK_START_DOW + 7) % 7));
}

export function weekDates(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function shiftWeek(start: string, dir: -1 | 1): string {
  return addDays(start, dir * 7);
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Wed 9/16" */
export function dayLabel(iso: string): string {
  const d = toUtc(iso);
  return `${DOW[d.getUTCDay()]} ${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

export const STATUS_ICONS: Record<PlanDayStatus, { icon: string; label: string }> = {
  done: { icon: "✓", label: "Done" },
  partial: { icon: "◐", label: "Partial" },
  missed: { icon: "✕", label: "Missed" },
  upcoming: { icon: "•", label: "Upcoming" },
  today: { icon: "•", label: "Today" },
};

export function statusIcon(status: PlanDayStatus): { icon: string; label: string } {
  return STATUS_ICONS[status] ?? STATUS_ICONS.upcoming;
}

/** "Phase 1 · Week 7 · Deload" from the week's rows; null when there are none. */
export function weekHeading(days: PlanDay[]): string | null {
  if (days.length === 0) return null;
  const counts = new Map<string, { phase: number; week: number; n: number }>();
  for (const d of days) {
    const k = `${d.phase}:${d.week_num}`;
    const c = counts.get(k) ?? { phase: d.phase, week: d.week_num, n: 0 };
    c.n += 1;
    counts.set(k, c);
  }
  const top = [...counts.values()].sort((a, b) => b.n - a.n)[0];
  const deload = top.week === DELOAD_WEEK ? " · Deload" : "";
  return `Phase ${top.phase} · Week ${top.week}${deload}`;
}

/** EVENING-1 row classification, in one place so the week list, the counters
 * and the "next session" lookup agree.
 *
 *   rest      — `rest` or `rest_mobility`: nothing was scheduled.
 *   recovery  — a flow. A scheduled session, but not training.
 *   training  — strength and cardio: everything else.
 */
/** Rows by date, preserving the API's order (morning before evening). One
 * helper so the week list and the status tiles group identically. */
export function groupByDate(rows: PlanDay[]): Map<string, PlanDay[]> {
  const out = new Map<string, PlanDay[]>();
  for (const r of rows) {
    const list = out.get(r.plan_date) ?? [];
    list.push(r);
    out.set(r.plan_date, list);
  }
  return out;
}

export function isRestRow(p: Pick<PlanDay, "session_type">): boolean {
  return p.session_type === "rest" || p.session_type === "rest_mobility";
}

export function isRecoveryRow(p: Pick<PlanDay, "session_type">): boolean {
  return p.session_type === "recovery_flow";
}

export function isTrainingRow(p: Pick<PlanDay, "session_type">): boolean {
  return !isRestRow(p) && !isRecoveryRow(p);
}

/** Done / due counts for one bucket of rows. `due` excludes days still ahead,
 * so "1 of 2" means one of the two that have come round so far. */
export function tally(rows: PlanDay[]): { done: number; due: number; scheduled: number } {
  const counted = rows.filter((p) => !p.is_skipped);
  const done = counted.filter((p) => p.status === "done" || p.status === "partial").length;
  const due = counted.filter((p) => p.status !== "upcoming").length;
  return { done, due, scheduled: counted.length };
}

/** The next actual SESSION at or after `today`, across BOTH slots (EVENING-1).
 *
 * `days` must be ordered by date and, within a date, morning before evening —
 * which is how /api/health/plan returns them. Today's own morning row is not
 * "next"; today's EVENING row is (a rest morning usually has a flow that
 * night). Rest, rest_mobility and skipped days are not sessions.
 *
 * Exported so the rest screen and its tests share one rule. */
/** The [from, to] a rest screen asks /plan for: `days` calendar days starting
 * at `startIso`, INCLUSIVE both ends. /plan caps a range at 14 days and answers
 * 400 range_too_large beyond it — asking for today..today+14 is 15 days, which
 * is how "Nothing scheduled in the next two weeks" reached the iPad on
 * 2026-09-25. Exported so the arithmetic is pinned by a test. */
export function planWindowFrom(startIso: string, days = 14): [string, string] {
  const [y, m, d] = startIso.split("-").map((n) => parseInt(n, 10));
  const at = (offset: number) =>
    new Date(Date.UTC(y, m - 1, d + offset)).toISOString().slice(0, 10);
  return [at(0), at(days - 1)];
}

export function nextSessionFrom(days: PlanDay[], today: string): PlanDay | null {
  return days.find((p) => {
    if (p.plan_date === today && p.slot !== "evening") return false;
    if (p.is_skipped) return false;
    return !isRestRow(p);
  }) ?? null;
}

export function tomorrowOf(resp: PlanRangeResponse): PlanDay | null {
  const t = addDays(resp.today, 1);
  return resp.days.find((d) => d.plan_date === t) ?? null;
}

/** The device's calendar date — only a first guess; the API's `today` wins. */
export function deviceTodayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** "as of 21:05" */
export function asOfLabel(at: Date): string {
  return `as of ${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}
