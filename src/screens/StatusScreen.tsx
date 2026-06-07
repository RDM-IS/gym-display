import { useMemo } from "react";
import type {
  Banner,
  DayStripEntry,
  LoggedSession,
  StatusResponse,
  TrendPoint,
} from "../lib/types";
import { perExerciseDeltas, type PerExerciseDelta } from "../lib/status-analysis";
import { sessionLabel } from "../lib/format";

interface Props {
  data: StatusResponse;
}

export default function StatusScreen({ data }: Props) {
  // Guard every array — the payload comes from a server we don't control
  // at runtime; missing/null arrays must not crash the page.
  const history = Array.isArray(data?.same_type_history) ? data.same_type_history : [];
  const day_strip = Array.isArray(data?.day_strip) ? data.day_strip : [];
  const rpe_trend = Array.isArray(data?.rpe_trend) ? data.rpe_trend : [];
  const weight_trend = Array.isArray(data?.weight_trend) ? data.weight_trend : [];
  return (
    <div className="status">
      <div className="status-grid">
        <LeftPanel
          mostRecent={data?.most_recent_session ?? null}
          history={history}
        />
        <RightPanel
          banner={data?.banner ?? null}
          day_strip={day_strip}
          rpe_trend={rpe_trend}
          weight_trend={weight_trend}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Left — most recent session vs same-type history
// ---------------------------------------------------------------------------

function LeftPanel({
  mostRecent,
  history,
}: {
  mostRecent: LoggedSession | null;
  history: LoggedSession[];
}) {
  if (!mostRecent) {
    return (
      <Panel title="Last session">
        <Empty text="No sessions logged yet. Debrief Artemis in Mattermost after a workout." />
      </Panel>
    );
  }
  return (
    <Panel
      title={`Last session · ${sessionLabel({ session_type: mostRecent.session_type })}`}
      subtitle={`${mostRecent.plan_date} · Phase ${mostRecent.phase} · Week ${mostRecent.week_num}${
        mostRecent.rpe_actual != null ? ` · RPE ${mostRecent.rpe_actual.toFixed(1)}` : ""
      }`}
    >
      <ExerciseTable current={mostRecent} history={history} />
      {history.length === 0 && (
        <div className="status-note">
          No prior {mostRecent.session_type} sessions to compare against.
        </div>
      )}
      {history.length > 0 && (
        <div className="status-note">
          Compared against avg of last {history.length} {mostRecent.session_type} session
          {history.length === 1 ? "" : "s"}: {history.map((h) => h.plan_date).join(", ")}
        </div>
      )}
    </Panel>
  );
}

function ExerciseTable({
  current,
  history,
}: {
  current: LoggedSession;
  history: LoggedSession[];
}) {
  const deltas = useMemo(() => perExerciseDeltas(current, history), [current, history]);
  // current.exercises may be undefined / null from the server; never .filter() raw.
  const exerciseRows = Array.isArray(current.exercises) ? current.exercises : [];

  if (deltas.length === 0) {
    // No strength sets — fall back to cardio block rows.
    const cardioRows = exerciseRows.filter((e) => e.log_type === "cardio_block");
    if (cardioRows.length === 0) {
      return <Empty text="No exercise rows in this session." />;
    }
    return (
      <table className="status-table">
        <thead>
          <tr>
            <th>Block</th>
            <th>Duration</th>
            <th>Distance</th>
            <th>HR avg</th>
            <th>HR peak</th>
          </tr>
        </thead>
        <tbody>
          {cardioRows.map((b, i) => (
            <tr key={i}>
              <td>{b.exercise ?? "—"}</td>
              <td className="num">{b.duration_sec != null ? `${b.duration_sec}s` : "—"}</td>
              <td className="num">{b.distance_m != null ? `${b.distance_m}m` : "—"}</td>
              <td className="num">{b.hr_avg ?? "—"}</td>
              <td className="num">{b.hr_peak ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <table className="status-table">
      <thead>
        <tr>
          <th>Exercise</th>
          <th>Top set</th>
          <th>Δ weight</th>
          <th>Δ reps</th>
          <th>vs avg</th>
        </tr>
      </thead>
      <tbody>
        {deltas.map((d) => (
          <DeltaRow key={d.exercise} d={d} />
        ))}
      </tbody>
    </table>
  );
}

function DeltaRow({ d }: { d: PerExerciseDelta }) {
  const cur = d.current;
  const topSet = [
    cur.weight_lbs != null ? `${cur.weight_lbs} lb` : null,
    cur.reps_done != null ? `× ${cur.reps_done}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <tr>
      <td>{d.exercise}</td>
      <td className="num">{topSet || "—"}</td>
      <td className={`num ${deltaClass(d.weight_delta)}`}>{fmtDelta(d.weight_delta, "lb")}</td>
      <td className={`num ${deltaClass(d.reps_delta)}`}>{fmtDelta(d.reps_delta, "")}</td>
      <td className="num muted">
        {d.n_history === 0
          ? "—"
          : `${d.history_avg_weight?.toFixed(1) ?? "—"} lb × ${
              d.history_avg_reps?.toFixed(1) ?? "—"
            }`}
      </td>
    </tr>
  );
}

function fmtDelta(v: number | null, unit: string): string {
  if (v == null) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(unit === "lb" ? 1 : 1)}${unit ? " " + unit : ""}`;
}

function deltaClass(v: number | null): string {
  if (v == null || v === 0) return "muted";
  return v > 0 ? "delta-up" : "delta-down";
}

// ---------------------------------------------------------------------------
// Right — banner + 11-day strip + trends
// ---------------------------------------------------------------------------

function RightPanel({
  banner,
  day_strip,
  rpe_trend,
  weight_trend,
}: {
  banner: Banner | null;
  day_strip: DayStripEntry[];
  rpe_trend: TrendPoint[];
  weight_trend: TrendPoint[];
}) {
  return (
    <div className="status-right">
      {banner && (
        <div className="banner-row">
          <span className="banner-phase">
            {banner.phase_name ? `${banner.phase_name} (Phase ${banner.phase})` : `Phase ${banner.phase}`}
          </span>
          <span className="banner-week">Week {banner.week_num}</span>
        </div>
      )}
      <Panel title="Last 11 days" subtitle="today ±5">
        <DayStrip entries={day_strip} />
      </Panel>
      <Panel title="RPE trend" subtitle="last 30 days · session_summary rows">
        {rpe_trend.length === 0 ? (
          <Empty text="No RPE logged yet." />
        ) : (
          <TrendChart points={rpe_trend} yMin={1} yMax={10} unit="" />
        )}
      </Panel>
      <Panel title="Body weight" subtitle="last 30 days · daily_state">
        {weight_trend.length === 0 ? (
          <Empty text="No body-weight check-ins yet. Log via Mattermost morning check-in." />
        ) : (
          <TrendChart points={weight_trend} unit="lb" />
        )}
      </Panel>
    </div>
  );
}

function DayStrip({ entries }: { entries: DayStripEntry[] }) {
  return (
    <div className="day-strip">
      {entries.map((e) => {
        const dayNum = parseDayNumber(e.plan_date);
        const cls = [
          "day-cell",
          e.is_today ? "day-today" : "",
          e.session_type ? `day-${e.session_type.split("_")[0]}` : "day-empty",
          e.is_skipped ? "day-skipped" : "",
          e.is_logged ? "day-logged" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <div key={e.plan_date} className={cls} title={`${e.plan_date}: ${e.session_type ?? "—"}`}>
            <div className="day-num">{dayNum}</div>
            <div className="day-type">{shortType(e.session_type)}</div>
            <div className="day-marker">
              {e.is_logged ? "✓" : e.is_skipped ? "·" : ""}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function parseDayNumber(iso: string): string {
  const m = iso.match(/-(\d{2})$/);
  return m ? m[1] : iso.slice(-2);
}

function shortType(t: string | null): string {
  if (!t) return "—";
  switch (t) {
    case "strength_a": return "STR A";
    case "strength_b": return "STR B";
    case "strength_c": return "STR C";
    case "cardio_intervals": return "HIIT";
    case "cardio_z2": return "Z2";
    case "walk": return "WALK";
    case "rest_mobility": return "REST";
    default: return t.toUpperCase().slice(0, 5);
  }
}

// ---------------------------------------------------------------------------
// SVG line chart
// ---------------------------------------------------------------------------

interface ChartProps {
  points: TrendPoint[];
  yMin?: number;
  yMax?: number;
  unit?: string;
}

function TrendChart({ points, yMin, yMax, unit = "" }: ChartProps) {
  const width = 600;
  const height = 160;
  const padX = 36;
  const padY = 20;

  const values = points.map((p) => p.value);
  const minY = yMin ?? Math.min(...values);
  const maxY = yMax ?? Math.max(...values);
  const range = maxY === minY ? 1 : maxY - minY;
  const stepX = points.length > 1 ? (width - 2 * padX) / (points.length - 1) : 0;

  const coords = points.map((p, i) => ({
    x: padX + i * stepX,
    y: padY + (height - 2 * padY) * (1 - (p.value - minY) / range),
    p,
  }));

  const path = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const latest = points[points.length - 1];
  const first = points[0];

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="chart" preserveAspectRatio="none">
        {/* axis */}
        <line x1={padX} y1={height - padY} x2={width - padX} y2={height - padY} className="chart-axis" />
        {/* path */}
        <path d={path} className="chart-path" />
        {/* dots */}
        {coords.map((c, i) => (
          <circle key={i} cx={c.x} cy={c.y} r={3} className="chart-dot" />
        ))}
        {/* y labels */}
        <text x={4} y={padY + 4} className="chart-label">{maxY.toFixed(1)}</text>
        <text x={4} y={height - padY} className="chart-label">{minY.toFixed(1)}</text>
      </svg>
      <div className="chart-foot">
        <span>
          {first.date} → {latest.date}
        </span>
        <span>
          latest <strong>{latest.value.toFixed(1)}{unit && ` ${unit}`}</strong>
        </span>
        <span>n = {points.length}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generic UI primitives
// ---------------------------------------------------------------------------

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
