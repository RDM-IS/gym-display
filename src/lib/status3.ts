import type {
  BurnInfo,
  CheckinInfo,
  GridDay,
  GridInfo,
  OverviewResponse,
  PlanDay,
  StrengthProgressRow,
  StrengthQuota,
} from "./types";
import { STRENGTH_TYPES } from "./format";
import { addDays, isRestRow } from "./week";

// ---------------------------------------------------------------------------
// STATUS-3 — the one-screen Status page (phase 1: layout only).
//
// Pure model for the 7-day grid, the check-in banner and the three motivating
// sections. Every fact comes from /overview; nothing here re-derives a plan
// status, a quota or a trend — the Lambda computes those once.
//
// Plan cells use green (on plan), yellow (adjusted for a reported issue),
// neutral and muted. Red and orange belong to the RECOMMENDED row only, and come
// straight from the Lambda's strength quota (phase 2): red on the real last
// chance for the weekly goal, orange the day before. Nothing here computes them.
// ---------------------------------------------------------------------------

export type Tone = "green" | "yellow" | "neutral" | "muted" | "red" | "orange";

export interface GridCell {
  row: PlanDay;
  name: string;
  tone: Tone;
  /** Watch kcal for this date and slot — past and today only. */
  kcal: number | null;
  /** "Done", "Partial", "Missed"…, or null for an upcoming cell. */
  state: string | null;
}

export interface RecCell {
  label: string;
  why: string | null;
  tone: Tone;
  /** today: opens Sessions; another day: opens that row. */
  row: PlanDay | null;
  kind: "plan" | "extra" | "recommend" | "goal";
}

export interface GridColumn {
  date: string;
  isToday: boolean;
  isPast: boolean;
  /** Goal weeks run Monday–Sunday: true on a Monday that is not the first
   * column, where the grid draws its divider. */
  weekBreak: boolean;
  morning: GridCell | null;
  evening: GridCell | null;
  rec: RecCell | null;
}

export interface RecommendLike {
  available: boolean;
  label?: string;
  reason?: string;
}

const DONE = new Set(["done", "partial"]);

/** Phase 2, amendment 1: the Evening row shows MANDATORY items only. Recovery
 * Flow and the other extras never fill it; with nothing mandatory it is blank. */
const OPTIONAL_EVENING = new Set([
  "recovery_flow", "yoga_strength", "mobility", "core", "walk", "rest", "rest_mobility",
]);

export function isMandatoryEvening(row: PlanDay): boolean {
  return !OPTIONAL_EVENING.has(row.session_type) && !isRestRow(row);
}
const STATE_LABEL: Record<string, string> = {
  done: "Done",
  partial: "Partial",
  not_done: "Not done",
  missed: "Not done",
  skipped: "Skipped",
};

function dow(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function displayName(row: PlanDay): string {
  return row.display_name || row.blocks?.display_name || row.session_type.replace(/_/g, " ");
}

function burnFor(burn: BurnInfo[], date: string, slot: "morning" | "evening"): number | null {
  const hit = burn.filter((b) => b.date === date && b.slot === slot);
  return hit.length ? Math.round(hit.reduce((a, b) => a + b.kcal, 0)) : null;
}

export function cellFor(row: PlanDay, today: string, burn: BurnInfo[]): GridCell {
  const past = row.plan_date <= today;
  const slot = row.slot === "evening" ? "evening" : "morning";
  const rest = isRestRow(row);
  let tone: Tone;
  if (rest) tone = "neutral";
  else if (DONE.has(row.status)) tone = "green";
  else if (row.adjusted) tone = "yellow";
  else if (row.plan_date < today) tone = "muted";        // phase 2 colours misses
  else tone = "green";                                   // upcoming = on plan
  const state = row.plan_date < today || DONE.has(row.status)
    ? (STATE_LABEL[row.status] ?? null) : null;
  return {
    row,
    name: rest ? "Rest" : displayName(row),
    tone,
    kcal: past ? burnFor(burn, row.plan_date, slot) : null,
    state: rest ? null : state,
  };
}

/** Phase 2, amendment 3 (rooms): the office gym is for strength only; yoga,
 * mobility and rowing are always at MSP home. A strength suggestion on an
 * office day is Full Body at the office; on a home day Row + floor or
 * Bodyweight; in Wisconsin the per-location cardio + floor variant. */
export function strengthFor(day: GridDay | undefined, morning: PlanDay | null): string {
  if (morning && STRENGTH_TYPES.has(morning.session_type)) return displayName(morning);
  switch (day?.location) {
    case "office": return "Full body (office)";
    case "msp_home": return "Row + floor or Bodyweight";
    case "richfield": return "Bike + floor or Bodyweight";
    case "brown_deer": return "Run + floor or Bodyweight";
    default: return "Bodyweight";
  }
}

const EXTRA: Omit<RecCell, "row"> = {
  label: "Extra: yoga or a row (home)", why: null, tone: "neutral", kind: "extra",
};

export interface RecContext {
  /** The goal week's quota holding this date (null: unreadable or not sent). */
  quota: StrengthQuota | null;
  /** This date's cycle day. */
  day: GridDay | undefined;
  /** Cycle days and morning rows for the whole grid, for naming another day. */
  dayOf: (date: string) => GridDay | undefined;
  morningOf: (date: string) => PlanDay | null;
}

function usableQuota(q: StrengthQuota | null): q is StrengthQuota {
  return !!q && q.section.ok && Array.isArray(q.placements) && q.counted === true
    && q.status !== "not_counted";
}

/** The Recommended row (phase 2): driven by the weekly strength goal — 3 days
 * Mon–Sun, never two in a row, travel and away days excluded — with the
 * remaining days placed as late as feasible BY THE LAMBDA. Placed days get the
 * strength session for their room, red on the real last chance, orange the day
 * before; other days get a ladder or an extra. Without a usable quota (not
 * sent, unreadable, not counted) it falls back to the plan, uncoloured. */
export function recFor(date: string, today: string, rows: PlanDay[],
                       rec: RecommendLike | null, ctx?: RecContext): RecCell | null {
  if (date < today) return null;
  const q = ctx?.quota ?? null;
  const sessions = rows.filter((r) => !isRestRow(r));
  const open = sessions.filter((r) => !DONE.has(r.status) && r.status !== "skipped");
  const morning = rows.find((r) => r.slot !== "evening") ?? null;

  if (ctx && usableQuota(q) && (q.needed ?? 0) > 0) {
    const placements = q.placements ?? [];
    const urg = q.urgency?.[date];
    const last = q.last_chance ?? placements[0] ?? null;
    // Kept short: a grid cell shows two lines of `why` on an iPad in portrait.
    const why = date === last
      ? `Last chance for ${q.required ?? 3}`
      : urg === "orange" && last ? `Spare day before ${shortDow(last)}`
        : `${q.needed} more this week`;
    if (date === today) {
      // Amendment 4: never "plan done, extra" while the goal is owed.
      if (placements.includes(date) || urg) {
        return { label: strengthFor(ctx.day, morning), why, tone: urg ?? "green", row: null, kind: "goal" };
      }
      if (last) {
        // The DAY leads, so it can never be the part that gets cut off.
        return { label: `Next: ${shortDow(last)}`, why: strengthFor(ctx.dayOf(last), ctx.morningOf(last)),
                 tone: "green", row: null, kind: "goal" };
      }
      return { label: "3 this week is out of reach", why: "Any strength day still helps",
               tone: "red", row: null, kind: "goal" };
    }
    if (placements.includes(date) || urg) {
      return { label: strengthFor(ctx.day, morning), why, tone: urg ?? "green", row: morning, kind: "goal" };
    }
  }

  if (ctx?.day && date !== today) {
    if (ctx.day.away) return { label: "Away", why: null, tone: "neutral", row: morning, kind: "plan" };
    if (ctx.day.day_type === "travel") {
      return { label: "Travel day", why: "Bodyweight optional on arrival", tone: "neutral",
               row: morning, kind: "plan" };
    }
  }

  if (date === today) {
    if (sessions.length > 0 && open.length === 0) {
      return { label: "Extra: yoga or a light row", why: "Today's plan is done",
               tone: "green", row: null, kind: "extra" };
    }
    if (rec?.available && rec.label) {
      return { label: rec.label, why: rec.reason ?? null, tone: "green", row: null,
               kind: "recommend" };
    }
  }
  // No plan row at all is "nothing seeded yet", not a rest day.
  if (rows.length === 0) return ctx && usableQuota(q) ? { ...EXTRA, row: null } : null;
  const next = open.find((r) => r.slot !== "evening") ?? open[0] ?? null;
  if (!next) {
    return sessions.length === 0
      ? { label: "Rest", why: null, tone: "neutral", row: rows[0] ?? null, kind: "plan" }
      : null;
  }
  // A planned strength day the goal did not place: still worth doing, never urgent.
  if (ctx && usableQuota(q) && STRENGTH_TYPES.has(next.session_type)) {
    return { label: displayName(next), why: "Optional · counts", tone: "neutral",
             row: next, kind: "plan" };
  }
  return { label: displayName(next), why: null, tone: next.adjusted ? "yellow" : "green",
           row: next, kind: "plan" };
}

/** The seven columns. Dates come from the grid's own window, so a day without
 * a plan row still gets its column. */
export function gridColumns(grid: GridInfo, today: string,
                            rec: RecommendLike | null): GridColumn[] {
  if (!grid.start || !grid.end) return [];
  const cycle = new Map((grid.cycle ?? []).map((c) => [c.date, c]));
  const quotas = (grid.quotas ?? []).filter((q) => q.week_start && q.week_end);
  const morningOf = (d: string) =>
    grid.days.find((r) => r.plan_date === d && r.slot !== "evening") ?? null;
  const cols: GridColumn[] = [];
  for (let d = grid.start, i = 0; d <= grid.end && i < 14; d = addDays(d, 1), i++) {
    const rows = grid.days.filter((r) => r.plan_date === d);
    const morning = rows.find((r) => r.slot !== "evening") ?? null;
    const evening = rows.find((r) => r.slot === "evening" && isMandatoryEvening(r)) ?? null;
    const quota = quotas.find((q) => q.week_start! <= d && d <= q.week_end!) ?? null;
    cols.push({
      date: d,
      isToday: d === today,
      isPast: d < today,
      weekBreak: i > 0 && dow(d) === 1,
      morning: morning ? cellFor(morning, today, grid.burn) : null,
      evening: evening ? cellFor(evening, today, grid.burn) : null,
      rec: recFor(d, today, rows, rec, grid.quotas
        ? { quota, day: cycle.get(d), dayOf: (x) => cycle.get(x), morningOf }
        : undefined),
    });
  }
  return cols;
}

// ── Check-in banner ─────────────────────────────────────────────────────────

/** "HH:MM" in the ACTIVE timezone the response names — never the iPad's own. */
export function localHm(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("hour")}:${get("minute")}`;
}

export const CHECKIN_RED_AT = "04:30";

/** null = checked in (no banner). Red from 04:30 local. */
export function checkinBanner(data: Pick<OverviewResponse, "today" | "timezone">,
                              now: Date): "amber" | "red" | null {
  if (data.today.checkin) return null;
  return localHm(now, data.timezone) >= CHECKIN_RED_AT ? "red" : "amber";
}

// ── Collapsed sections ──────────────────────────────────────────────────────

/** Days in a row, ending today or yesterday, with a check-in. */
export function checkinStreak(checkins: CheckinInfo[], today: string): number {
  const have = new Set(checkins.map((c) => c.date));
  let d = have.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (have.has(d)) { n += 1; d = addDays(d, -1); }
  return n;
}

/** Lifts whose latest top set IS their best, beating an earlier session (a
 * first-ever session is not a personal record). */
export function newBests(rows: StrengthProgressRow[]): StrengthProgressRow[] {
  return rows.filter((r) => r.last && r.best && r.previous
    && r.last.date === r.best.date && r.last.score >= r.best.score
    && r.last.score > r.previous.score);
}

export interface Milestone { key: string; text: string }

export function milestones(data: OverviewResponse): Milestone[] {
  const out: Milestone[] = [];
  for (const r of newBests(data.strength_progress)) {
    const b = r.best!;
    const load = b.weight_lbs != null ? `${b.weight_lbs} lb × ${b.reps ?? "?"}` : `${b.reps ?? "?"} reps`;
    out.push({ key: `pr-${r.exercise}`, text: `New best: ${r.exercise} ${load}` });
  }
  const streak = checkinStreak(data.checkins_14d, data.date);
  if (streak >= 2) out.push({ key: "streak", text: `${streak}-day check-in streak` });
  const q = data.strength_quota;
  if (q?.section.ok && q.status === "met") {
    out.push({ key: "quota", text: `Strength goal met this week (${q.count} of ${q.required})` });
  }
  return out;
}

export interface GoalLine { key: string; text: string }

/** Framed as progress made. No "to go" figure where no goal value exists — the
 * page states what was done rather than inventing a target. */
export function goalLines(data: OverviewResponse): GoalLine[] {
  const out: GoalLine[] = [];
  const g = data.goals;
  const w = g?.weight;
  if (w?.section.ok && w.change_since_start != null) {
    const c = w.change_since_start;
    out.push({ key: "weight", text: c < 0
      ? `${Math.abs(c).toFixed(1)} lb down since the program started`
      : c > 0 ? `Weight +${c.toFixed(1)} lb since the program started — the 7-day average is what to watch`
              : "Weight steady since the program started" });
  }
  const q = data.strength_quota;
  if (q?.section.ok && q.count != null && q.required != null && q.status !== "not_counted") {
    out.push({ key: "strength", text: `${q.count} of ${q.required} strength days done this week` });
  }
  const c = g?.cardio;
  if (c?.section.ok && c.minutes_7d != null) {
    out.push({ key: "cardio", text: c.planned_minutes_7d
      ? `${c.minutes_7d} of ${c.planned_minutes_7d} planned cardio minutes in the last 7 days`
      : `${c.minutes_7d} cardio minutes in the last 7 days` });
  }
  const n = g?.nutrition;
  if (n?.section.ok && n.days_logged != null && n.days_logged > 0) {
    out.push({ key: "nutrition", text: `${n.days_logged} of ${n.days_window} days logged`
      + (n.avg_kcal_7d != null && n.plan_kcal != null
        ? `, averaging ${Math.round(n.avg_kcal_7d).toLocaleString("en-US")} kcal against a ${n.plan_kcal.toLocaleString("en-US")} plan`
        : "") });
  }
  return out;
}

export interface RecentSession { row: PlanDay; name: string; kcal: number | null }

/** Wins first: done before partial, newest first within each. */
export function recentSessions(data: OverviewResponse, limit = 5): RecentSession[] {
  const seen = new Set<number>();
  const rows: PlanDay[] = [];
  for (const r of [...(data.grid?.days ?? []), ...data.week_days]) {
    if (seen.has(r.plan_id)) continue;
    seen.add(r.plan_id);
    if (r.plan_date <= data.date && DONE.has(r.status) && !isRestRow(r)) rows.push(r);
  }
  rows.sort((a, b) => (a.status === b.status ? 0 : a.status === "done" ? -1 : 1)
    || b.plan_date.localeCompare(a.plan_date));
  const burn = data.grid?.burn ?? [];
  return rows.slice(0, limit).map((row) => ({
    row,
    name: displayName(row),
    kcal: burnFor(burn, row.plan_date, row.slot === "evening" ? "evening" : "morning"),
  }));
}

// ── Formatting ──────────────────────────────────────────────────────────────

/** 12345 → "12.3k". */
export function compact(v: number): string {
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(v >= 100000 ? 0 : 1)}k`;
  return String(Math.round(v));
}

export function shortDow(iso: string): string {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dow(iso)];
}
