import type { Plan } from "../lib/types";
import { formatPlanDate } from "../lib/format";

interface Props {
  plan: Plan;
}

export default function RestDayScreen({ plan }: Props) {
  return (
    <div className="tv tv--warmup" style={{ justifyContent: "center", alignItems: "center", textAlign: "center" }}>
      <div className="tv-meta">{formatPlanDate(plan)}</div>
      <div className="tv-h1" style={{ marginTop: "2vh" }}>Rest day</div>
      <div className="tv-h2" style={{ marginTop: "3vh", opacity: 0.9 }}>
        Mobility 20 min or full rest.
      </div>
      <div className="workout-desc" style={{ marginTop: "3vh" }}>
        See you tomorrow.
      </div>
    </div>
  );
}
