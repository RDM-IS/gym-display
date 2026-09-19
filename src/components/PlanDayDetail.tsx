import type {
  CircuitBlocks,
  PlanDay,
  PlannedExercise,
  RecoveryFlowBlocks,
} from "../lib/types";
import { exerciseSets } from "../lib/adjustment";
import { buildFlowTimeline, flowTotalSec, formatClock } from "../lib/flow";
import { formatEstimate } from "../lib/format";
import { dayLabel, statusIcon } from "../lib/week";

// ---------------------------------------------------------------------------
// GD-WEEK — one day of the plan, read-only. Used by Tomorrow and Week.
// ---------------------------------------------------------------------------

const REP_RANGE_RE = /^\s*\d+\s*×\s*([^;]+?)\s*(?:;|$)/;

function repRange(ex: PlannedExercise): string | null {
  const m = (ex.notes ?? "").match(REP_RANGE_RE);
  if (m) return m[1];
  if (ex.format === "duration" && ex.duration_sec) return `${ex.duration_sec}s`;
  return ex.target_reps != null ? String(ex.target_reps) : null;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}

/** "3 × 8-12 · RPE ≤6 · 20 lb (last 25)" */
export function exercisePlanLine(ex: PlannedExercise, rounds: number, sessionRpe: number | null): string {
  const sets = exerciseSets(ex, rounds);
  const reps = repRange(ex);
  const bits = [reps ? `${sets} × ${reps}` : `${sets} set${sets === 1 ? "" : "s"}`];
  const cap = ex.rpe_cap ?? sessionRpe;
  if (cap != null) bits.push(`RPE ≤${fmt(cap)}`);
  if (ex.target_load_lbs != null && ex.format === "reps") {
    bits.push(ex.load_from != null
      ? `${fmt(ex.target_load_lbs)} lb (last ${fmt(ex.load_from)})`
      : `${fmt(ex.target_load_lbs)} lb`);
  } else if (ex.load_note) {
    bits.push(ex.load_note);
  }
  if (ex.added_by === "checkin") bits.push(ex.replaces ? `added (for ${ex.replaces})` : "added");
  return bits.join(" · ");
}

/** "✓ Done" / "Upcoming": the neutral "•" icon would read as a second
 * separator after "FRI 9/18 ·", so it's left out of the date line. */
export function dateLineStatus(st: { icon: string; label: string }): string {
  return st.icon === "•" ? st.label : `${st.icon} ${st.label}`;
}

export function totalMinutes(day: PlanDay): number | null {
  if (day.blocks?.type === "recovery_flow") {
    // Rounded up, like artemis est_duration_min.
    return Math.ceil(flowTotalSec(day.blocks as RecoveryFlowBlocks) / 60);
  }
  return day.est_duration_min ?? null;
}

export function sessionName(day: PlanDay): string {
  return day.display_name || day.blocks?.display_name || day.session_type.replace(/_/g, " ");
}

interface Props {
  day: PlanDay;
  today: string;
}

export default function PlanDayDetail({ day, today }: Props) {
  const b = day.blocks;
  const mins = totalMinutes(day);
  const isPast = day.plan_date < today;
  const sessionRpe = (b && "rpe_cap" in b ? b.rpe_cap : null) ?? day.target_rpe;
  const meta = [day.location, mins != null ? formatEstimate(mins) : null,
                `Phase ${day.phase} · Week ${day.week_num}`].filter(Boolean).join(" · ");
  const st = statusIcon(day.status);
  const summary = b?.adjustment?.summary ?? [];

  return (
    <article className="plan-detail" data-testid="plan-detail" aria-label={`${dayLabel(day.plan_date)} plan`}>
      <div className="meta">
        {dayLabel(day.plan_date)} · <span className={`day-status ds--${day.status}`}>{dateLineStatus(st)}</span>
      </div>
      <div className="h2 plan-detail-name">{sessionName(day)}</div>
      <div className="meta">{meta}</div>

      {day.adjusted && (
        <div className="plan-detail-adjusted" data-testid="plan-detail-adjusted">
          <span className="badge badge--adjusted">Adjusted</span>
          {summary.map((s) => <div key={s} className="dim">{s}</div>)}
        </div>
      )}

      <div className="plan-detail-body">
        {b?.type === "circuit" && <CircuitPlan b={b} sessionRpe={sessionRpe} />}
        {b?.type === "recovery_flow" && <FlowPlan b={b} />}
        {b?.type === "steady" && (
          <ul className="list">
            <li>{b.duration_min} min {b.intensity ?? ""}</li>
            {(b.equipment ?? []).length > 0 && <li className="dim">{(b.equipment ?? []).join(", ")}</li>}
            {b.mobility_min ? <li>+ {b.mobility_min} min mobility ({(b.mobility_focus ?? []).join(", ")})</li> : null}
          </ul>
        )}
        {b?.type === "mobility" && (
          <ul className="list">
            <li>{b.duration_min === 0 ? "No training." : b.notes || `${b.duration_min ?? 20} min mobility`}</li>
          </ul>
        )}
        {b?.type === "walk" && <ul className="list"><li>{b.duration_min} min walk</li></ul>}
        {b?.type === "intervals" && (
          <ul className="list">
            <li>{b.rounds ?? 1} rounds · {b.intervals_template?.work_sec}s work / {b.intervals_template?.rest_sec}s easy</li>
          </ul>
        )}
      </div>

      {(isPast || day.plan_date === today) && (day.logged.length > 0 || day.summary_notes) && (
        <div className="plan-detail-logged" data-testid="plan-detail-logged">
          <div className="section-title">Logged</div>
          <ul className="list">
            {day.logged.map((e) => (
              <li key={e.exercise}>
                <strong>{e.exercise}</strong>
                {` — ${e.sets} set${e.sets === 1 ? "" : "s"}`}
                {e.reps.some((r) => r != null) ? ` · ${e.reps.map((r) => r ?? "–").join(", ")} reps` : ""}
                {e.top_weight_lbs != null ? ` · top ${fmt(e.top_weight_lbs)} lb` : ""}
                {e.duration_sec ? ` · ${formatClock(e.duration_sec)}` : ""}
                {e.skipped ? ` · ${e.skipped} skipped` : ""}
              </li>
            ))}
            {day.summary_notes && <li className="dim">{day.summary_notes}</li>}
          </ul>
        </div>
      )}
      {isPast && day.logged.length === 0 && !day.summary_notes && (
        <div className="dim" data-testid="plan-detail-nothing">Nothing logged.</div>
      )}

      {!isPast && <div className="plan-detail-foot dim">Adjusts after your morning check-in.</div>}
    </article>
  );
}

function CircuitPlan({ b, sessionRpe }: { b: CircuitBlocks; sessionRpe: number | null }) {
  const rounds = b.rounds ?? 1;
  return (
    <>
      {b.warmup && <div className="dim">Warmup: {b.warmup}</div>}
      <ol className="list plan-exercises">
        {(b.exercises ?? []).map((ex, i) => (
          <li key={`${ex.name}-${i}`} className={ex.added_by ? "exercise--added" : undefined}>
            <strong>{ex.name}</strong> — {exercisePlanLine(ex, rounds, sessionRpe)}
          </li>
        ))}
      </ol>
      {b.finisher?.exercises?.map((ex) => (
        <div key={ex.name} className="dim">
          + {b.finisher?.display_name ?? "Finisher"}: {b.finisher?.rounds ?? 1}× {ex.duration_sec}s {ex.name}
        </div>
      ))}
      {b.mobility_min ? (
        <div>+ {b.mobility_min} min mobility ({(b.mobility_focus ?? []).join(", ")})</div>
      ) : null}
      {b.cooldown && <div className="dim">Cooldown: {b.cooldown}</div>}
    </>
  );
}

function FlowPlan({ b }: { b: RecoveryFlowBlocks }) {
  const items = buildFlowTimeline(b);
  const firstRound = items.filter((i) => i.kind !== "pose" || i.round === 1);
  return (
    <>
      <div>{formatClock(flowTotalSec(b))} total · {b.rounds} rounds</div>
      <ol className="list plan-poses">
        {firstRound.map((i, n) => (
          <li key={n}>
            {i.title} <span className="dim mono">{formatClock(i.duration_sec)}</span>
          </li>
        ))}
      </ol>
      {b.rounds > 1 && (
        <div className="dim">Round 2: same order, steps {b.double_steps?.[0] ?? 10}–{b.double_steps?.[1] ?? 16} held 2×.</div>
      )}
    </>
  );
}
