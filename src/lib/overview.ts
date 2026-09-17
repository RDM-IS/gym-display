import type {
  CheckinInfo,
  ProgramInfo,
  ProgressInfo,
  StrengthProgressRow,
  TopSetInfo,
  TrendPoint,
} from "./types";

// ---------------------------------------------------------------------------
// STATUS-1 — pure formatting and chart geometry for the Status page.
// Every number that reaches the screen carries a label or a unit.
// ---------------------------------------------------------------------------

export function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}

/** "9/16" */
export function md(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${m}/${d}`;
}

export function programTitle(p: ProgramInfo): string {
  return `${p.name ?? `Phase ${p.phase}`} · Phase ${p.phase} · Week ${p.week} of ${p.weeks_total}`;
}

export function deloadText(p: ProgramInfo): string | null {
  if (p.deload_week == null || p.weeks_to_deload == null) return null;
  if (p.weeks_to_deload === 0) return "Deload week";
  if (p.weeks_to_deload === 1) return "Deload next week";
  return `Deload in ${p.weeks_to_deload} weeks`;
}

export function progressText(p: ProgressInfo | null): string {
  if (!p) return "No session today";
  if (p.unit === "rest") return "Rest";
  const label = p.unit === "sets" ? "Sets" : "Minutes";
  return `${label} ${fmtNum(p.done ?? 0)} / ${fmtNum(p.planned ?? 0)}`;
}

export function checkinParts(c: CheckinInfo | null): string[] {
  if (!c) return [];
  const out: string[] = [];
  if (c.sleep_hrs != null) out.push(`Sleep ${fmtNum(c.sleep_hrs)} h`);
  if (c.energy != null) out.push(`Energy ${c.energy}/5`);
  if (c.weight_lbs != null) out.push(`Weight ${fmtNum(c.weight_lbs)} lb`);
  if (c.resting_hr != null) out.push(`RHR ${c.resting_hr} bpm`);
  return out;
}

export function scoreList(scores: Record<string, number>): string {
  return Object.entries(scores).map(([r, n]) => `${r} ${n}/5`).join(", ");
}

export function topSetText(t: TopSetInfo | null): string {
  if (!t) return "—";
  const load = t.weight_lbs != null ? `${fmtNum(t.weight_lbs)} lb × ${t.reps ?? "?"}` : `× ${t.reps ?? "?"}`;
  return `${md(t.date)} · ${load}`;
}

export const TREND_ARROWS: Record<NonNullable<StrengthProgressRow["trend"]>, { arrow: string; label: string }> = {
  up: { arrow: "↑", label: "Up" },
  flat: { arrow: "→", label: "Flat" },
  down: { arrow: "↓", label: "Down" },
};

/** Regions reported in the window, as strip rows: soreness and pain apart. */
export interface StripRow {
  key: string;
  region: string;
  kind: "sore" | "pain";
  cells: Array<{ date: string; value: number | null }>;
}

export function sorenessStrip(checkins: CheckinInfo[]): StripRow[] {
  const rows = new Map<string, StripRow>();
  const dates = checkins.map((c) => c.date);
  const add = (kind: "sore" | "pain", region: string) => {
    const key = `${kind}:${region}`;
    if (!rows.has(key)) {
      rows.set(key, { key, region, kind, cells: dates.map((date) => ({ date, value: null })) });
    }
    return rows.get(key)!;
  };
  checkins.forEach((c, i) => {
    for (const [r, v] of Object.entries(c.soreness)) {
      if (r === "overall") continue;
      add("sore", r).cells[i].value = v;
    }
    for (const [r, v] of Object.entries(c.pain)) add("pain", r).cells[i].value = v;
  });
  return [...rows.values()].sort((a, b) =>
    a.kind === b.kind ? a.region.localeCompare(b.region) : a.kind === "pain" ? -1 : 1);
}

// ── Chart geometry ─────────────────────────────────────────────────────────

export interface ChartBox {
  width: number;
  height: number;
  left: number;    // room for y labels, outside the plot
  right: number;
  top: number;
  bottom: number;  // room for x labels, outside the plot
}

export interface ChartGeometry {
  dots: Array<{ x: number; y: number; value: number; date: string }>;
  /** null with fewer than 2 points — never a line from a single reading. */
  path: string | null;
  yMin: number;
  yMax: number;
  yTicks: Array<{ y: number; value: number }>;
  plot: { x0: number; x1: number; y0: number; y1: number };
}

export function chartGeometry(
  points: TrendPoint[],
  box: ChartBox,
  opts: { pad?: number; fixed?: [number, number]; from?: string; to?: string } = {},
): ChartGeometry {
  const plot = { x0: box.left, x1: box.width - box.right, y0: box.top, y1: box.height - box.bottom };
  const vals = points.map((p) => p.value);
  let yMin: number;
  let yMax: number;
  if (opts.fixed) {
    [yMin, yMax] = opts.fixed;
  } else if (vals.length) {
    const pad = opts.pad ?? 0;
    yMin = Math.floor(Math.min(...vals) - pad);
    yMax = Math.ceil(Math.max(...vals) + pad);
  } else {
    yMin = 0;
    yMax = 1;
  }
  if (yMax === yMin) yMax = yMin + 1;
  const t = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
  const tFrom = opts.from ? t(opts.from) : points.length ? t(points[0].date) : 0;
  const tTo = opts.to ? t(opts.to) : points.length ? t(points[points.length - 1].date) : 1;
  const span = Math.max(1, tTo - tFrom);
  const xOf = (iso: string) =>
    points.length === 1 && !opts.from && !opts.to
      ? (plot.x0 + plot.x1) / 2
      : plot.x0 + ((t(iso) - tFrom) / span) * (plot.x1 - plot.x0);
  const yOf = (v: number) => plot.y1 - ((v - yMin) / (yMax - yMin)) * (plot.y1 - plot.y0);
  const dots = points.map((p) => ({ x: xOf(p.date), y: yOf(p.value), value: p.value, date: p.date }));
  const path = dots.length >= 2
    ? dots.map((d, i) => `${i === 0 ? "M" : "L"}${d.x.toFixed(1)},${d.y.toFixed(1)}`).join(" ")
    : null;
  const yTicks = [yMin, yMax].map((v) => ({ y: yOf(v), value: v }));
  return { dots, path, yMin, yMax, yTicks, plot };
}
