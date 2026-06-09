import { useEffect, useState } from "react";
import type {
  Banner,
  SessionDayRow,
  SessionsResponse,
  SessionSetRow,
  StatusResponse,
  TrendPoint,
} from "../lib/types";
import { fetchSessions } from "../lib/api";
import {
  classifyHrZone,
  targetZoneLabel,
  zoneArrow,
  zoneLabel,
  zoneRangeBpm,
} from "../lib/hr-zone";

interface Props {
  data: StatusResponse;
}

export default function StatusScreen({ data }: Props) {
  const [sessions, setSessions] = useState<SessionsResponse | null>(null);
  const [sessionsErr, setSessionsErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await fetchSessions(7);
      if (cancelled) return;
      if (r.status === "ok") setSessions(r.data);
      else setSessionsErr(r.message);
    })();
    return () => { cancelled = true; };
  }, []);

  const todayRow =
    sessions?.days.find((d) => d.is_today) ?? sessions?.days[sessions.days.length - 1] ?? null;

  return (
    <div className="status">
      {data?.banner && <BannerRow banner={data.banner} />}

      <Panel
        title="Today"
        subtitle={todayRow ? formatDate(todayRow.plan_date) : "loading"}
      >
        {sessionsErr && (
          <div className="status-error">
            Sessions endpoint error: {sessionsErr}
          </div>
        )}
        {!sessions && !sessionsErr && <Empty text="Loading…" />}
        {todayRow && (
          <TodayPanel
            day={todayRow}
            planExercises={extractPlannedExerciseNames(todayRow)}
          />
        )}
      </Panel>

      <Panel title="Last 7 days" subtitle="planned vs logged · avg-set RPE vs target">
        {!sessions ? <Empty text="Loading…" /> : <SevenDayStrip days={sessions.days} />}
      </Panel>

      <Panel title="Outliers" subtitle="data only · not interpretation">
        {!sessions ? <Empty text="Loading…" /> : <Outliers days={sessions.days} />}
      </Panel>

      <Panel title="Body weight" subtitle="last 30 days · daily_state">
        {data?.weight_trend && data.weight_trend.length > 0 ? (
          <TrendChart points={data.weight_trend} unit="lb" />
        ) : (
          <Empty text="No body-weight check-ins yet." />
        )}
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Today — per-exercise per-set read-back + planned-vs-logged gaps
// ---------------------------------------------------------------------------

interface PlannedExerciseRef {
  name: string;
  expected_sets: number;
  is_finisher: boolean;
}

/** Walk the sets returned by /sessions for today AND any planned exercises
 * that should have rows. The /sessions payload has the per-set rows; what
 * it doesn't tell us natively is the planned exercise list. We extract that
 * by collecting all distinct exercise names that appear in sets + computing
 * any planned names missing entirely (which would show as "not logged"). */
function extractPlannedExerciseNames(_day: SessionDayRow): PlannedExerciseRef[] {
  // For now: planned-list reconciliation happens BACKEND-side via
  // planned_set_count + per-exercise set rows. The frontend reads back
  // what's in sets[]; the backend's planned_set_count vs logged_set_count
  // is the gap signal. Future: have backend return the planned exercise
  // list as a separate field on SessionDayRow so we can render
  // "not-logged-at-all" exercises explicitly. For v1, the gap is
  // visible in the day's logged < planned ratio and Outliers section.
  return [];
}

function TodayPanel({ day }: { day: SessionDayRow; planExercises: PlannedExerciseRef[] }) {
  const sets = Array.isArray(day.sets) ? day.sets : [];
  // Group by exercise name preserving original order.
  const grouped = new Map<string, SessionSetRow[]>();
  for (const s of sets) {
    const k = s.exercise ?? "—";
    const arr = grouped.get(k) ?? [];
    arr.push(s);
    grouped.set(k, arr);
  }
  const completionRatio = day.planned_set_count > 0
    ? `${day.logged_set_count} of ${day.planned_set_count}`
    : `${day.logged_set_count}`;
  const targetRpe = day.target_rpe;
  const avgRpe = day.avg_set_rpe;
  const arrow = avgRpe != null && targetRpe != null
    ? avgRpe > targetRpe + 0.1 ? "↑" : avgRpe < targetRpe - 0.1 ? "↓" : "≈"
    : "";

  return (
    <div className="today-grid">
      <div className="today-meta">
        <div>
          <div className="today-meta-label">Session</div>
          <div className="today-meta-value">{day.display_name ?? day.session_type ?? "—"}</div>
        </div>
        <div>
          <div className="today-meta-label">Phase / Week</div>
          <div className="today-meta-value">
            {day.phase ? `P${day.phase}` : "—"} · {day.week_num ? `W${day.week_num}` : "—"}
          </div>
        </div>
        <div>
          <div className="today-meta-label">Sets logged</div>
          <div className="today-meta-value">{completionRatio}</div>
        </div>
        <div>
          <div className="today-meta-label">Avg-set RPE / target</div>
          <div className="today-meta-value">
            {avgRpe != null ? avgRpe.toFixed(1) : "—"}
            {targetRpe != null && (
              <span className="today-meta-target"> / {targetRpe.toFixed(1)} {arrow}</span>
            )}
          </div>
        </div>
      </div>

      {grouped.size === 0 ? (
        <Empty text="No sets logged today yet." />
      ) : (
        <div className="today-exercises">
          {[...grouped.entries()].map(([name, rows]) => (
            <ExerciseReadback key={name} name={name} rows={rows} targetHrZone={day.target_hr_zone} />
          ))}
        </div>
      )}
    </div>
  );
}

function ExerciseReadback({
  name,
  rows,
  targetHrZone,
}: {
  name: string;
  rows: SessionSetRow[];
  targetHrZone: number | null;
}) {
  return (
    <div className="today-exercise">
      <div className="today-exercise-name">{name}</div>
      <ul className="today-set-list">
        {rows.map((r) => (
          <li key={r.log_id} className={r.is_skipped ? "set-skipped" : ""}>
            {r.log_type === "cardio_block" ? (
              <CardioReadback row={r} targetHrZone={targetHrZone} />
            ) : (
              <StrengthReadback row={r} />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function StrengthReadback({ row }: { row: SessionSetRow }) {
  if (row.is_skipped) {
    return (
      <span className="set-readback set-readback--skipped">
        set {row.set_num ?? "?"}: skipped
      </span>
    );
  }
  const parts: string[] = [];
  if (row.weight_lbs != null) parts.push(`${fmt(row.weight_lbs)} lb`);
  if (row.reps_done != null) parts.push(`× ${row.reps_done}`);
  if (row.rpe_actual != null) parts.push(`@RPE ${fmt(row.rpe_actual)}`);
  return (
    <span className="set-readback tv-mono">
      <span className="set-num">set {row.set_num ?? "?"}:</span> {parts.join(" ") || "—"}
    </span>
  );
}

function CardioReadback({
  row,
  targetHrZone,
}: {
  row: SessionSetRow;
  targetHrZone: number | null;
}) {
  const headParts: string[] = [];
  if (row.duration_sec != null) headParts.push(`${Math.round(row.duration_sec / 60)} min`);
  if (row.distance_m != null) headParts.push(`${(row.distance_m / 1000).toFixed(2)} km`);
  if (row.rpe_actual != null) headParts.push(`@RPE ${fmt(row.rpe_actual)}`);

  const hrLines: Array<{ label: string; bpmLabel: string; arrow: string }> = [];
  if (row.hr_avg != null) {
    const avgArrow = targetHrZone != null
      ? zoneArrow(classifyHrZone(row.hr_avg), targetHrZone)
      : "";
    hrLines.push({ label: "avg", bpmLabel: zoneLabel(row.hr_avg), arrow: avgArrow });
  }
  if (row.hr_peak != null) {
    const peakArrow = targetHrZone != null
      ? zoneArrow(classifyHrZone(row.hr_peak), targetHrZone)
      : "";
    hrLines.push({ label: "peak", bpmLabel: zoneLabel(row.hr_peak), arrow: peakArrow });
  }
  const tgt = targetHrZone != null ? targetZoneLabel(targetHrZone) : null;

  return (
    <span className="set-readback set-readback--cardio tv-mono">
      <span className="set-num">cardio:</span> {headParts.join(" · ") || "—"}
      {hrLines.map((line, i) => (
        <span key={i} className="hr-line">
          {" "}· HR {line.label} {line.bpmLabel} {line.arrow}
        </span>
      ))}
      {tgt && <span className="zone-note"> · target {tgt}</span>}
    </span>
  );
}

// ---------------------------------------------------------------------------
// 7-day strip
// ---------------------------------------------------------------------------

function SevenDayStrip({ days }: { days: SessionDayRow[] }) {
  return (
    <div className="seven-day-strip">
      {days.map((d) => (
        <DayRow key={d.plan_date} day={d} />
      ))}
    </div>
  );
}

function DayRow({ day }: { day: SessionDayRow }) {
  const avg = day.avg_set_rpe;
  const target = day.target_rpe;
  const rpeArrow = avg != null && target != null
    ? avg > target + 0.1 ? "↑" : avg < target - 0.1 ? "↓" : "≈"
    : null;
  const className = [
    "seven-day-row",
    day.is_today ? "seven-day-row--today" : "",
    day.is_skipped ? "seven-day-row--skipped" : "",
    day.outliers?.incomplete ? "seven-day-row--incomplete" : "",
  ].filter(Boolean).join(" ");
  const hrZone = day.target_hr_zone;
  const hrTargetRange = hrZone ? zoneRangeBpm(hrZone) : null;
  const hrAvgZone = day.hr_avg != null ? classifyHrZone(day.hr_avg) : null;
  const hrArrow = hrAvgZone != null && hrZone != null
    ? zoneArrow(hrAvgZone, hrZone)
    : null;
  return (
    <div className={className}>
      <div className="seven-day-date tv-mono">{shortDate(day.plan_date)}</div>
      <div className="seven-day-label">
        <div className="seven-day-name">{day.display_name ?? day.session_type ?? "—"}</div>
        {day.phase != null && day.week_num != null && (
          <div className="seven-day-sub tv-mono">
            P{day.phase} · W{day.week_num}
          </div>
        )}
      </div>
      <div className="seven-day-rpe tv-mono">
        {avg != null ? avg.toFixed(1) : "—"}
        {target != null && (
          <span className="seven-day-target"> / {target.toFixed(1)} {rpeArrow}</span>
        )}
      </div>
      <div className="seven-day-sets tv-mono">
        {day.logged_set_count} / {day.planned_set_count}
      </div>
      <div className="seven-day-work tv-mono">
        {day.total_work_sec > 0 ? `${Math.round(day.total_work_sec / 60)}m` : "—"}
      </div>
      <div className="seven-day-hr tv-mono">
        {day.hr_avg != null && hrAvgZone != null
          ? `${day.hr_avg} = Z${hrAvgZone}${hrArrow ? " " + hrArrow : ""}`
          : "—"}
        {hrTargetRange && day.hr_avg != null && hrZone != null && (
          <span className="seven-day-hr-target">
            {" "}/ target Z{hrZone} ({hrTargetRange[0]}–{hrTargetRange[1]})
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Outliers — facts only
// ---------------------------------------------------------------------------

function Outliers({ days }: { days: SessionDayRow[] }) {
  const flagged: Array<{ date: string; kind: string; detail: string }> = [];
  for (const d of days) {
    for (const s of d.outliers?.high_rpe_sets ?? []) {
      flagged.push({
        date: d.plan_date,
        kind: "RPE ≥ 9",
        detail: `${s.exercise ?? "?"} set ${s.set_num ?? "?"} · RPE ${s.rpe_actual.toFixed(1)}`,
      });
    }
    if (d.outliers?.incomplete) {
      flagged.push({
        date: d.plan_date,
        kind: "Incomplete",
        detail: `${d.outliers.incomplete_logged} of ${d.outliers.incomplete_planned} planned sets logged`,
      });
    }
    for (const note of d.outliers?.pain_notes ?? []) {
      flagged.push({
        date: d.plan_date,
        kind: "Pain note",
        detail: note,
      });
    }
  }
  if (flagged.length === 0) {
    return <Empty text="No outliers in the last 7 days." />;
  }
  return (
    <ul className="outlier-list">
      {flagged.map((f, i) => (
        <li key={i} className="outlier-row">
          <span className="outlier-date tv-mono">{shortDate(f.date)}</span>
          <span className={`outlier-kind outlier-kind--${f.kind.replace(/\W/g, "")}`}>{f.kind}</span>
          <span className="outlier-detail">{f.detail}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Banner + chart + primitives
// ---------------------------------------------------------------------------

function BannerRow({ banner }: { banner: Banner }) {
  return (
    <div className="banner-row">
      <span className="banner-phase">
        {banner.phase_name ? `${banner.phase_name} (Phase ${banner.phase})` : `Phase ${banner.phase}`}
      </span>
      <span className="banner-week">Week {banner.week_num}</span>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="status-panel">
      <div className="status-panel-head">
        <span className="status-panel-title">{title}</span>
        {subtitle && <span className="status-panel-subtitle">{subtitle}</span>}
      </div>
      <div className="status-panel-body">{children}</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="status-empty">{text}</div>;
}

function TrendChart({ points, unit = "" }: { points: TrendPoint[]; unit?: string }) {
  const width = 600;
  const height = 160;
  const padX = 36;
  const padY = 20;
  const values = points.map((p) => p.value);
  const minY = Math.min(...values);
  const maxY = Math.max(...values);
  const range = maxY === minY ? 1 : maxY - minY;
  const stepX = points.length > 1 ? (width - 2 * padX) / (points.length - 1) : 0;
  const coords = points.map((p, i) => ({
    x: padX + i * stepX,
    y: padY + (height - 2 * padY) * (1 - (p.value - minY) / range),
  }));
  const path = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const latest = points[points.length - 1];
  const first = points[0];
  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="chart" preserveAspectRatio="none">
        <line x1={padX} y1={height - padY} x2={width - padX} y2={height - padY} className="chart-axis" />
        <path d={path} className="chart-path" />
        {coords.map((c, i) => (
          <circle key={i} cx={c.x} cy={c.y} r={3} className="chart-dot" />
        ))}
        <text x={4} y={padY + 4} className="chart-label">{maxY.toFixed(1)}</text>
        <text x={4} y={height - padY} className="chart-label">{minY.toFixed(1)}</text>
      </svg>
      <div className="chart-foot">
        <span>{first.date} → {latest.date}</span>
        <span>latest <strong>{latest.value.toFixed(1)}{unit && ` ${unit}`}</strong></span>
        <span>n = {points.length}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map((s) => parseInt(s, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split("-").map((s) => parseInt(s, 10));
  return `${m}/${d}`;
}
