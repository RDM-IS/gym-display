import { useEffect, useState } from "react";
import type { MobilityBlocks, Plan, PlanDay } from "../lib/types";
import { fetchPlanRange } from "../lib/api";
import { displayTitle, formatPlanDate, sessionLabel } from "../lib/format";
import { dayLabel } from "../lib/week";
import { adjustmentOf } from "../lib/adjustment";
import AdjustmentBanner from "../components/AdjustmentBanner";
import BottomBar from "../components/BottomBar";
import type { BarTarget } from "../lib/bottom-bar";

interface Props {
  plan: Plan;
  onNavigate?: (target: BarTarget) => void;
}

/** GD-REST: the next day that actually has a session, so a rest day says what
 * is coming rather than just "see you tomorrow". Rest and skipped days are not
 * sessions. `undefined` = still looking, `null` = nothing in the window. */
function useNextSession(fromDate: string): PlanDay | null | undefined {
  const [next, setNext] = useState<PlanDay | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    const day = (offset: number) => {
      const [y, m, d] = fromDate.split("-").map((n) => parseInt(n, 10));
      const dt = new Date(Date.UTC(y, m - 1, d + offset));
      return dt.toISOString().slice(0, 10);
    };
    fetchPlanRange(day(1), day(14)).then((r) => {
      if (cancelled) return;
      if (r.status !== "ok") { setNext(null); return; }
      const found = (r.data.days ?? []).find(
        (p) => !p.is_skipped && p.session_type !== "rest" && p.session_type !== "rest_mobility",
      );
      setNext(found ?? null);
    });
    return () => { cancelled = true; };
  }, [fromDate]);
  return next;
}

export default function RestDayScreen({ plan, onNavigate }: Props) {
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
      <div className="h2 dim">
        {dayOff
          ? "No training today."
          : isMobility
          ? `Mobility${mobDuration ? ` · ${mobDuration} min` : ""}${focus.length ? ` · ${focus.join(", ")}` : ""}`
          : "Mobility 20 min or full rest."}
      </div>
      {mobNotes && !dayOff && <div className="desc">{mobNotes}</div>}
      {next === undefined ? null : next ? (
        <div className="desc">
          Next: {dayLabel(next.plan_date)} · {next.display_name || sessionLabel(next)}
          {next.location ? ` · ${next.location}` : ""}
        </div>
      ) : (
        <div className="desc">Nothing scheduled in the next two weeks.</div>
      )}
      {onNavigate && <BottomBar view="today" onNavigate={onNavigate} />}
    </div>
  );
}
