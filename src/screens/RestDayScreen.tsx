import type { MobilityBlocks, Plan } from "../lib/types";
import { displayTitle, formatPlanDate } from "../lib/format";

interface Props {
  plan: Plan;
}

export default function RestDayScreen({ plan }: Props) {
  const blocks = plan.blocks;
  const isMobility = blocks?.type === "mobility";
  const title = isMobility ? displayTitle(plan) : "Rest day";
  const mobNotes = isMobility ? (blocks as MobilityBlocks).notes ?? null : null;
  const mobDuration = isMobility ? (blocks as MobilityBlocks).duration_min ?? null : null;
  return (
    <div className="screen screen--center tint--warmup">
      <div className="meta">{formatPlanDate(plan)}</div>
      <div className="h1">{title}</div>
      <div className="h2 dim">
        {isMobility
          ? `Mobility${mobDuration ? ` · ${mobDuration} min` : ""}`
          : "Mobility 20 min or full rest."}
      </div>
      {mobNotes && <div className="desc">{mobNotes}</div>}
      <div className="desc">See you tomorrow.</div>
    </div>
  );
}
