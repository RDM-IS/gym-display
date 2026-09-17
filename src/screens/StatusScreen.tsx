import { useCallback, useEffect, useState } from "react";
import BottomBar from "../components/BottomBar";
import PlanDayDetail, { sessionName } from "../components/PlanDayDetail";
import { fetchOverview, fetchPlanRange, type FetchOverviewResult, type FetchPlanRangeResult } from "../lib/api";
import type { BarTarget } from "../lib/bottom-bar";
import {
  checkinParts,
  chartGeometry,
  deloadText,
  fmtNum,
  md,
  programTitle,
  progressText,
  scoreList,
  sorenessStrip,
  topSetText,
  TREND_ARROWS,
  type ChartBox,
} from "../lib/overview";
import type {
  CheckinInfo,
  FlagInfo,
  OverviewResponse,
  PatternInfo,
  PlanDay,
  StrengthProgressRow,
  TrendPoint,
} from "../lib/types";
import { addDays, asOfLabel, dayLabel, statusIcon } from "../lib/week";

// ---------------------------------------------------------------------------
// STATUS-1 — the Status page. One read (/api/health/overview), scoped to the
// current program; the page scrolls, no card has a fixed height. Read-only.
// ---------------------------------------------------------------------------

interface Props {
  onNavigate: (target: BarTarget) => void;
}

type View = { kind: "page" } | { kind: "day"; day: PlanDay } | { kind: "previous" };

export default function StatusScreen({ onNavigate }: Props) {
  const [result, setResult] = useState<FetchOverviewResult | null>(null);
  const [view, setView] = useState<View>({ kind: "page" });

  const load = useCallback(async () => {
    setResult(await fetchOverview());
  }, []);

  // Fetch on open and on focus — never polled.
  useEffect(() => {
    void load();
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const data = result?.status === "ok" ? result.data : null;

  if (view.kind === "day") {
    return (
      <div className="screen peek peek--day" data-testid="status-day">
        <header className="peek-head"><div className="h2 peek-title">{dayLabel(view.day.plan_date)}</div></header>
        <div className="peek-body">
          <PlanDayDetail day={view.day} today={data?.date ?? view.day.plan_date} />
        </div>
        <BottomBar view="day" onNavigate={onNavigate} />
      </div>
    );
  }

  if (view.kind === "previous" && data?.program) {
    return (
      <PreviousProgram
        anchor={data.program.anchor}
        end={data.previous_program_end}
        today={data.date}
        onBack={() => setView({ kind: "page" })}
        onNavigate={onNavigate}
      />
    );
  }

  return (
    <div className="status2" data-testid="status-page">
      {result?.status === "ok" && result.stale && (
        <div className="banner status-stale" data-testid="status-stale" role="status">
          Offline — {asOfLabel(result.asOf)}
        </div>
      )}
      {result === null && <div className="muted">Loading…</div>}
      {result?.status === "error" && (
        <div className="status-error" data-testid="status-error">Couldn't load status ({result.message}).</div>
      )}
      {data && (
        <div className="status-grid">
          <div className="status-col">
            <ProgramSection data={data} />
            <WeekSection data={data} onOpen={(day) => setView({ kind: "day", day })} />
            <TodaySection data={data} />
          </div>
          <div className="status-col">
            <StrengthSection rows={data.strength_progress} />
            <CheckinSection checkins={data.checkins_14d} />
            {data.patterns.length > 0 && <PatternSection patterns={data.patterns} />}
            <FlagSection flags={data.flags} />
            <WeightSection data={data} />
            {data.previous_program_end && (
              <button
                type="button"
                className="btn status-previous"
                data-testid="previous-program"
                onClick={() => setView({ kind: "previous" })}
              >
                Previous program
              </button>
            )}
          </div>
        </div>
      )}
      <BottomBar view="status" onNavigate={onNavigate} />
    </div>
  );
}

function Section({ title, subtitle, testId, children }: {
  title: string; subtitle?: string; testId: string; children: React.ReactNode;
}) {
  return (
    <section className="st-section" data-testid={testId} aria-label={title}>
      <header className="st-head">
        <h2 className="st-title">{title}</h2>
        {subtitle && <div className="st-sub">{subtitle}</div>}
      </header>
      <div className="st-body">{children}</div>
    </section>
  );
}

// 1 ── Program header ───────────────────────────────────────────────────────

export function ProgramSection({ data }: { data: OverviewResponse }) {
  const p = data.program;
  if (!p) {
    return (
      <Section title="Program" testId="st-program">
        <div className="muted">No program on the calendar.</div>
      </Section>
    );
  }
  const deload = deloadText(p);
  return (
    <Section title={programTitle(p)} testId="st-program">
      <ul className="st-facts">
        <li><span className="st-label">Started</span> {md(p.anchor)}</li>
        {deload && <li><span className="st-label">Deload</span> {deload}</li>}
        <li>
          <span className="st-label">This week</span> {p.sessions_done} / {p.sessions_planned} sessions done
        </li>
      </ul>
    </Section>
  );
}

// 2 ── This week ─────────────────────────────────────────────────────────────

export function WeekSection({ data, onOpen }: { data: OverviewResponse; onOpen: (d: PlanDay) => void }) {
  const p = data.program;
  const sub = p ? `${dayLabel(p.week_start)} – ${dayLabel(p.week_end)}` : undefined;
  return (
    <Section title="This week" subtitle={sub} testId="st-week">
      {data.week_days.length === 0 ? (
        <div className="muted">No sessions planned this week.</div>
      ) : (
        <div className="st-tiles">
          {data.week_days.map((d) => {
            const st = statusIcon(d.status);
            const today = d.plan_date === data.date;
            return (
              <button
                key={d.plan_date}
                type="button"
                className={`st-tile${today ? " st-tile--today" : ""}`}
                data-testid={`st-tile-${d.plan_date}`}
                aria-current={today ? "date" : undefined}
                aria-label={`${dayLabel(d.plan_date)}, ${sessionName(d)}, ${st.label}${d.adjusted ? ", adjusted" : ""}`}
                onClick={() => onOpen(d)}
              >
                <span className="st-tile-day">{dayLabel(d.plan_date)}</span>
                <span className="st-tile-name">{sessionName(d)}</span>
                <span className={`st-tile-icon ds--${d.status}`}>{st.icon}</span>
                {d.adjusted && <span className="badge badge--adjusted">Adjusted</span>}
              </button>
            );
          })}
        </div>
      )}
    </Section>
  );
}

// 3 ── Today ────────────────────────────────────────────────────────────────

export function TodaySection({ data }: { data: OverviewResponse }) {
  const t = data.today;
  const day = t.day;
  const parts = checkinParts(t.checkin);
  return (
    <Section title="Today" subtitle={dayLabel(t.date)} testId="st-today">
      {day ? (
        <>
          <div className="st-today-name">
            {sessionName(day)} <span className={`day-status ds--${day.status}`}>{statusIcon(day.status).label}</span>
          </div>
          <div className="st-progress" data-testid="st-progress">{progressText(t.progress)}</div>
        </>
      ) : (
        <div className="muted">Nothing planned today.</div>
      )}
      <div className="st-sub-title">Morning check-in</div>
      {t.checkin ? (
        <ul className="st-facts" data-testid="st-checkin">
          {parts.length > 0 && <li>{parts.join(" · ")}</li>}
          {Object.keys(t.checkin.soreness).length > 0 && (
            <li><span className="st-label">Soreness</span> {scoreList(t.checkin.soreness)}</li>
          )}
          {Object.keys(t.checkin.pain).length > 0 && (
            <li><span className="st-label st-label--pain">Pain</span> {scoreList(t.checkin.pain)}</li>
          )}
        </ul>
      ) : (
        <div className="muted" data-testid="st-checkin-empty">No check-in yet</div>
      )}
      {t.adjustment && t.adjustment.summary.length > 0 && (
        <div className="st-adjust" data-testid="st-adjustment">
          <span className="badge badge--adjusted">Adjusted</span>
          {t.adjustment.summary.map((s) => <div key={s}>{s}</div>)}
        </div>
      )}
    </Section>
  );
}

// 4 ── Strength progress ────────────────────────────────────────────────────

export function StrengthSection({ rows }: { rows: StrengthProgressRow[] }) {
  return (
    <Section title="Strength progress" subtitle="top set by load × reps" testId="st-strength">
      {rows.length === 0 ? (
        <div className="muted">No strength exercises this week.</div>
      ) : (
        <div className="table-scroll" data-testid="st-strength-scroll">
          <table className="st-table">
            <thead>
              <tr>
                <th scope="col">Exercise</th>
                <th scope="col">Last</th>
                <th scope="col">Previous</th>
                <th scope="col">Trend</th>
                <th scope="col">Best</th>
                <th scope="col">Machine setup</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const tr = r.trend ? TREND_ARROWS[r.trend] : null;
                return (
                  <tr key={r.exercise}>
                    <th scope="row">{r.exercise}</th>
                    <td>
                      <TopSetCell t={r.last} />
                      {!r.last && <div className="st-cell-note">not yet logged</div>}
                    </td>
                    <td><TopSetCell t={r.previous} /></td>
                    <td>
                      {tr ? <span className={`st-trend st-trend--${r.trend}`} aria-label={tr.label} title={tr.label}>{tr.arrow}</span> : "—"}
                    </td>
                    <td><TopSetCell t={r.best} /></td>
                    <td>{r.setting != null ? `setting ${fmtNum(r.setting)}` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

/** "180 lb × 12" over "9/16" — narrow enough for six columns in landscape. */
function TopSetCell({ t }: { t: StrengthProgressRow["last"] }) {
  if (!t) return <>—</>;
  const text = topSetText(t);                 // "9/16 · 180 lb × 12"
  const [date, load] = text.split(" · ");
  return (
    <span className="st-topset" title={text}>
      <span className="st-topset-load">{load}</span>
      <span className="st-topset-date">{date}</span>
    </span>
  );
}

// 5 ── Check-in trends ──────────────────────────────────────────────────────

const SPARK: ChartBox = { width: 300, height: 96, left: 36, right: 8, top: 8, bottom: 20 };

function Spark({ title, unit, points, fixed, testId, from, to }: {
  title: string; unit: string; points: TrendPoint[]; fixed?: [number, number]; testId: string;
  from: string; to: string;
}) {
  const g = chartGeometry(points, SPARK, { fixed, pad: fixed ? undefined : 1, from, to });
  return (
    <figure className="st-spark" data-testid={testId}>
      <figcaption>{title} <span className="st-unit">({unit})</span></figcaption>
      {points.length === 0 ? (
        <div className="muted">No readings</div>
      ) : (
        <svg viewBox={`0 0 ${SPARK.width} ${SPARK.height}`} role="img" aria-label={`${title}, ${points.length} readings`}>
          <rect x={g.plot.x0} y={g.plot.y0} width={g.plot.x1 - g.plot.x0} height={g.plot.y1 - g.plot.y0} className="st-plot" />
          {g.yTicks.map((t) => (
            <text key={t.value} x={g.plot.x0 - 6} y={t.y + 4} textAnchor="end" className="st-axis">{fmtNum(t.value)}</text>
          ))}
          <text x={g.plot.x0} y={SPARK.height - 4} className="st-axis">{md(from)}</text>
          <text x={g.plot.x1} y={SPARK.height - 4} textAnchor="end" className="st-axis">{md(to)}</text>
          {g.path && <path d={g.path} className="st-line" />}
          {g.dots.map((d) => <circle key={d.date} cx={d.x} cy={d.y} r={3.5} className="st-dot" />)}
        </svg>
      )}
    </figure>
  );
}

export function CheckinSection({ checkins }: { checkins: CheckinInfo[] }) {
  if (checkins.length === 0) {
    return (
      <Section title="Check-in trends" subtitle="last 14 days" testId="st-checkins">
        <div className="muted">No check-ins yet this program.</div>
      </Section>
    );
  }
  const from = checkins[0].date;
  const to = checkins[checkins.length - 1].date;
  const series = (f: (c: CheckinInfo) => number | null): TrendPoint[] =>
    checkins.flatMap((c) => (f(c) != null ? [{ date: c.date, value: f(c)! }] : []));
  const strip = sorenessStrip(checkins);
  return (
    <Section title="Check-in trends" subtitle="last 14 days" testId="st-checkins">
      <div className="st-sparks">
        <Spark title="Sleep" unit="hours" points={series((c) => c.sleep_hrs)} testId="spark-sleep" from={from} to={to} />
        <Spark title="Energy" unit="0–5" points={series((c) => c.energy)} fixed={[0, 5]} testId="spark-energy" from={from} to={to} />
        <Spark title="Weight" unit="lb" points={series((c) => c.weight_lbs)} testId="spark-weight" from={from} to={to} />
      </div>
      <div className="st-sub-title">Soreness &amp; pain (0–5)</div>
      {strip.length === 0 ? (
        <div className="muted">No soreness or pain reported.</div>
      ) : (
        <div className="table-scroll" data-testid="st-strip">
          <table className="st-strip">
            <thead>
              <tr>
                <th scope="col">Region</th>
                {checkins.map((c) => <th key={c.date} scope="col">{md(c.date)}</th>)}
              </tr>
            </thead>
            <tbody>
              {strip.map((row) => (
                <tr key={row.key}>
                  <th scope="row">
                    {row.region} <span className={`st-kind st-kind--${row.kind}`}>{row.kind === "pain" ? "pain" : "sore"}</span>
                  </th>
                  {row.cells.map((c) => (
                    <td
                      key={c.date}
                      className={`st-cell st-cell--${row.kind}`}
                      data-level={c.value ?? ""}
                      aria-label={c.value == null ? "not reported" : `${row.region} ${row.kind} ${c.value} of 5`}
                    >
                      {c.value ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

// 6 ── Patterns ─────────────────────────────────────────────────────────────

export function PatternSection({ patterns }: { patterns: PatternInfo[] }) {
  return (
    <Section title="Patterns" subtitle="counts only — not causes" testId="st-patterns">
      <ul className="st-list">
        {patterns.map((p) => (
          <li key={p.id}>
            {p.text}
            <div className="st-cell-note">
              {p.last_reflection_at ? `Last reflection ${md(p.last_reflection_at.slice(0, 10))}` : "No reflection yet"}
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// 7 ── Flags ────────────────────────────────────────────────────────────────

export function FlagSection({ flags }: { flags: FlagInfo[] }) {
  return (
    <Section title="Flags" subtitle="data only" testId="st-flags">
      {flags.length === 0 ? (
        <div className="muted" data-testid="st-flags-empty">Nothing flagged</div>
      ) : (
        <ul className="st-list">
          {flags.map((f, i) => (
            <li key={`${f.date}-${i}`} className={`st-flag st-flag--${f.kind}`}>{f.text}</li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// 8 ── Body weight ──────────────────────────────────────────────────────────

export const WEIGHT_BOX: ChartBox = { width: 560, height: 220, left: 56, right: 16, top: 12, bottom: 28 };

export function WeightSection({ data }: { data: OverviewResponse }) {
  const pts = data.weight_30d;
  const s = data.weight_summary;
  const from = addDays(data.date, -29);
  const g = chartGeometry(pts, WEIGHT_BOX, { pad: 3, from, to: data.date });
  return (
    <Section title="Body weight" subtitle="last 30 days" testId="st-weight">
      {pts.length === 0 ? (
        <div className="muted">No weight readings in the last 30 days.</div>
      ) : (
        <>
          <svg
            className="st-weight-chart"
            viewBox={`0 0 ${WEIGHT_BOX.width} ${WEIGHT_BOX.height}`}
            role="img"
            aria-label={`Body weight, ${pts.length} reading${pts.length === 1 ? "" : "s"}`}
            data-testid="weight-chart"
          >
            <rect x={g.plot.x0} y={g.plot.y0} width={g.plot.x1 - g.plot.x0} height={g.plot.y1 - g.plot.y0} className="st-plot" />
            {g.yTicks.map((t) => (
              <text key={t.value} x={g.plot.x0 - 8} y={t.y + 5} textAnchor="end" className="st-axis">
                {fmtNum(t.value)} lb
              </text>
            ))}
            <text x={g.plot.x0} y={WEIGHT_BOX.height - 6} className="st-axis">{md(from)}</text>
            <text x={g.plot.x1} y={WEIGHT_BOX.height - 6} textAnchor="end" className="st-axis">{md(data.date)}</text>
            {g.path && <path d={g.path} className="st-line" data-testid="weight-line" />}
            {g.dots.map((d) => <circle key={d.date} cx={d.x} cy={d.y} r={5} className="st-dot" data-testid="weight-dot" />)}
          </svg>
          {s && (
            <ul className="st-facts" data-testid="weight-summary">
              <li><span className="st-label">First</span> {fmtNum(s.first.value)} lb ({md(s.first.date)})</li>
              <li><span className="st-label">Latest</span> {fmtNum(s.latest.value)} lb ({md(s.latest.date)})</li>
              <li><span className="st-label">Change</span> {s.change > 0 ? "+" : s.change < 0 ? "−" : ""}{fmtNum(Math.abs(s.change))} lb</li>
            </ul>
          )}
        </>
      )}
    </Section>
  );
}

// ── Previous program (read-only list) ──────────────────────────────────────

function PreviousProgram({ anchor, end, today, onBack, onNavigate }: {
  anchor: string; end: string | null; today: string; onBack: () => void;
  onNavigate: (t: BarTarget) => void;
}) {
  const last = end ?? addDays(anchor, -1);
  const [pages, setPages] = useState<string[]>([last]);
  const [results, setResults] = useState<Record<string, FetchPlanRangeResult>>({});
  useEffect(() => {
    for (const p of pages) {
      if (results[p]) continue;
      void fetchPlanRange(addDays(p, -13), p).then((r) => setResults((cur) => ({ ...cur, [p]: r })));
    }
  }, [pages, results]);
  const days = pages.flatMap((p) => {
    const r = results[p];
    return r?.status === "ok" ? [...r.data.days].reverse() : [];
  });
  return (
    <div className="screen peek peek--week" data-testid="status-previous">
      <header className="peek-head"><div className="h2 peek-title">Previous program</div></header>
      <div className="peek-body">
        <button type="button" className="btn status-previous" onClick={onBack}>Back to Status</button>
        <ol className="week-list st-previous-list">
          {days.map((d) => (
            <li key={d.plan_date} className="st-previous-row">
              <span className="week-day">{dayLabel(d.plan_date)}</span>
              <span>{sessionName(d)}</span>
              <span className="dim">P{d.phase} W{d.week_num}</span>
              <span className={`ds--${d.status}`}>{statusIcon(d.status).icon}</span>
            </li>
          ))}
        </ol>
        {days.length === 0 && <div className="muted">Loading…</div>}
        <button
          type="button"
          className="btn status-previous"
          onClick={() => setPages((ps) => [...ps, addDays(ps[ps.length - 1], -14)])}
        >
          Older
        </button>
        <div className="dim">Read-only · before {md(anchor)} · today {md(today)}</div>
      </div>
      <BottomBar view="status" onNavigate={onNavigate} />
    </div>
  );
}
