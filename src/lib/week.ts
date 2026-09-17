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
