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
  const mobDuration =
    isMobility ? (blocks as MobilityBlocks).duration_min ?? null : null;
  return (
    <div className="tv tv--warmup" style={{ justifyContent: "center", alignItems: "center", textAlign: "center" }}>
      <div className="tv-meta">{formatPlanDate(plan)}</div>
      <div className="tv-h1" style={{ marginTop: "2vh" }}>{title}</div>
      <div className="tv-h2" style={{ marginTop: "3vh", opacity: 0.9 }}>
        {isMobility
          ? `Mobility${mobDuration ? ` · ${mobDuration} min` : ""}`
          : "Mobility 20 min or full rest."}
      </div>
      {mobNotes && (
        <div className="workout-desc" style={{ marginTop: "3vh", maxWidth: "70vw" }}>
          {mobNotes}
        </div>
      )}
      <div className="workout-desc" style={{ marginTop: "3vh" }}>
        See you tomorrow.
      </div>
    </div>
  );
}
