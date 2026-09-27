import { useEffect, useState } from "react";
import type { MobilityBlocks, Plan, PlanDay } from "../lib/types";
import { fetchPlanRange } from "../lib/api";
import { displayTitle, formatPlanDate, sessionLabel } from "../lib/format";
import { dayLabel, nextSessionFrom, planWindowFrom } from "../lib/week";
import { adjustmentOf } from "../lib/adjustment";
import AdjustmentBanner from "../components/AdjustmentBanner";
import BottomBar from "../components/BottomBar";
import type { BarTarget } from "../lib/bottom-bar";

interface Props {
  plan: Plan;
  onNavigate?: (target: BarTarget) => void;
  /** SESSION-LIB: open the on-demand session library. */
  onOpenLibrary?: () => void;
}

/** GD-REST: the next session, so a rest day says what is coming rather than
 * just "see you tomorrow". Rest and skipped days are not sessions.
 *
 * EVENING-1: "next" spans BOTH slots. A rest MORNING often has a recovery flow
 * that same evening, and that is tonight, not Tuesday — so the window starts
 * today and keeps today's evening row while dropping today's own morning row.
 * The API orders morning before evening within a date.
 *
 * `undefined` = still looking, `null` = nothing in the window. */
function useNextSession(fromDate: string): PlanDay | null | undefined {
  const [next, setNext] = useState<PlanDay | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    const [from, to] = planWindowFrom(fromDate);
    fetchPlanRange(from, to).then((r) => {
      if (cancelled) return;
      if (r.status !== "ok") { setNext(null); return; }
      setNext(nextSessionFrom(r.data.days ?? [], fromDate));
    });
    return () => { cancelled = true; };
  }, [fromDate]);
  return next;
}

export default function RestDayScreen({ plan, onNavigate, onOpenLibrary }: Props) {
  const blocks = plan.blocks;
  const next = useNextSession(plan.plan_date);
  const isMobility = blocks?.type === "mobility";
  const title = isMobility ? displayTitle(plan) : "Rest day";
  const mobNotes = isMobility ? (blocks as MobilityBlocks).notes ?? null : null;
  const mobDuration = isMobility ? (blocks as MobilityBlocks).duration_min ?? null : null;
  // PAIN-1: a check-in "day off" is a mobility block with zero minutes.
  const dayOff = isMobility && mobDuration === 0;
  const focus = isMobility ? blocks?.mobility_focus ?? [] : [];
  const adjustment = adjustmentOf(plan);
  return (
    <div className="screen screen--center tint--warmup">
      <div className="meta">{formatPlanDate(plan)}</div>
      {adjustment && <AdjustmentBanner adjustment={adjustment} />}
      <div className="h1">{title}</div>
      {/* SESSION-LIB: the rest screen offers something tappable or says
          nothing — "Mobility 20 min or full rest" is retired. */}
      {(dayOff || isMobility) && (
        <div className="h2 dim">
          {dayOff
            ? "No training today."
            : `Mobility${mobDuration ? ` · ${mobDuration} min` : ""}${focus.length ? ` · ${focus.join(", ")}` : ""}`}
        </div>
      )}
      {mobNotes && !dayOff && <div className="desc">{mobNotes}</div>}
      {next === undefined ? null : next ? (
        <div className="desc">
          Next: {next.plan_date === plan.plan_date ? "tonight" : dayLabel(next.plan_date)}
          {" · "}{next.display_name || sessionLabel(next)}
          {next.location ? ` · ${next.location}` : ""}
        </div>
      ) : (
        <div className="desc">Nothing scheduled in the next two weeks.</div>
      )}
      {onOpenLibrary && !dayOff && (
        <button type="button" className="btn" onClick={onOpenLibrary}>
          Start a session
        </button>
      )}
      {onNavigate && <BottomBar view="today" onNavigate={onNavigate} />}
    </div>
  );
}
