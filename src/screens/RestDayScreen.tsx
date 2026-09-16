import type { MobilityBlocks, Plan } from "../lib/types";
import { displayTitle, formatPlanDate } from "../lib/format";
import { adjustmentOf } from "../lib/adjustment";
import AdjustmentBanner from "../components/AdjustmentBanner";

interface Props {
  plan: Plan;
}

export default function RestDayScreen({ plan }: Props) {
  const blocks = plan.blocks;
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
      <div className="desc">See you tomorrow.</div>
    </div>
  );
}
