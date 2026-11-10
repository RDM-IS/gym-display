import { compact } from "../lib/status3";
import { fmtNum } from "../lib/overview";
import type { Goals, SectionStatus, TrendPoint } from "../lib/types";

// STATUS-3 — four trend tiles in one row: the current value and a sparkline of
// the 7-day rolling figure over 30 days, both from the SAME Lambda read.
//
// STATUS-2's rule still holds: an unreadable section says so and shows no
// number. "0 minutes" is an answer; "couldn't read cardio" is not, and showing
// a zero for both turns a database problem into a training judgement.

export function Sparkline({ points, label, testId }: {
  points: TrendPoint[]; label: string; testId: string;
}) {
  const W = 160, H = 36, P = 3;
  if (points.length < 2) {
    return <div className="tt-spark tt-spark--empty" data-testid={testId}>not enough data for a trend</div>;
  }
  const vals = points.map((p) => p.value);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const t0 = Date.parse(points[0].date), t1 = Date.parse(points[points.length - 1].date);
  const span = Math.max(t1 - t0, 1);
  const xy = points.map((p) => [
    P + ((Date.parse(p.date) - t0) / span) * (W - 2 * P),
    P + (1 - (p.value - lo) / (hi - lo)) * (H - 2 * P),
  ]);
  const d = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lx, ly] = xy[xy.length - 1];
  return (
    <svg className="tt-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
         aria-label={`${label}, 30 days`} data-testid={testId}>
      <path d={d} className="tt-line" vectorEffect="non-scaling-stroke" />
      <circle cx={lx} cy={ly} r={2.5} className="tt-dot" />
    </svg>
  );
}

function Tile({ title, testId, section, value, unit, sub, points, children }: {
  title: string; testId: string; section: SectionStatus | undefined;
  value: string; unit?: string; sub: React.ReactNode; points: TrendPoint[] | undefined;
  children?: React.ReactNode;
}) {
  const s = section ?? { ok: false, reason: "not sent by this API version" };
  return (
    <section className={`tt${s.ok ? "" : " tt--unreadable"}`} data-testid={testId}
             data-ok={s.ok ? "1" : "0"} aria-label={title}>
      <h3 className="tt-title">{title}</h3>
      {s.ok ? (
        <>
          <div className="tt-value"><span data-testid={`${testId}-value`}>{value}</span>
            {unit && <span className="tt-unit"> {unit}</span>}</div>
          <div className="tt-sub">{sub}</div>
          <Sparkline points={points ?? []} label={title} testId={`${testId}-spark`} />
          {children}
        </>
      ) : (
        <div className="tile-unreadable" data-testid="tile-unreadable">{s.reason ?? "couldn't read this"}</div>
      )}
    </section>
  );
}

const dash = (v: number | null | undefined, f: (n: number) => string = (n) => fmtNum(n)) =>
  v == null || Number.isNaN(v) ? "—" : f(v);

export default function TrendTiles({ goals }: { goals: Goals | null | undefined }) {
  const w = goals?.weight, c = goals?.cardio, v = goals?.strength_volume, n = goals?.nutrition;
  return (
    <div className="tt-row" data-testid="trend-tiles">
      <Tile title="Weight" testId="tt-weight" section={w?.section} value={dash(w?.avg_7d)} unit="lb"
            sub={`7-day average${w && w.days_7d < 7 ? ` · ${w.days_7d} of 7 days weighed` : ""}`}
            points={w?.trend_7d} />
      <Tile title="Cardio" testId="tt-cardio" section={c?.section}
            value={dash(c?.minutes_7d, (x) => String(x))}
            unit={c?.planned_minutes_7d ? `/ ${c.planned_minutes_7d} min` : "min"}
            sub={c?.planned_minutes_7d ? "of planned, last 7 days · total, not zone" : "last 7 days · total, not zone"}
            points={c?.trend_7d} />
      <Tile title="Strength" testId="tt-strength" section={v?.section}
            value={dash(v?.total_7d, compact)} unit="lb"
            sub="volume lifted, last 7 days" points={v?.trend_7d} />
      <Tile title="Nutrition" testId="tt-nutrition" section={n?.section}
            value={dash(n?.avg_kcal_7d, (x) => Math.round(x).toLocaleString("en-US"))}
            unit={n?.plan_kcal != null ? `/ ${n.plan_kcal.toLocaleString("en-US")} plan` : "kcal"}
            sub={n?.days_logged != null
              ? `kcal/day, avg of ${n.days_logged} logged day${n.days_logged === 1 ? "" : "s"} in 7${n.plan_kcal == null ? " · no plan on file" : ""}`
              : "kcal/day, last 7 days"}
            points={n?.trend_7d} />
    </div>
  );
}
