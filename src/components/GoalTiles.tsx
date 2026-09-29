import type {
  CardioGoal,
  Goals,
  NutritionGoal,
  SectionStatus,
  StrengthGoal,
  WeightGoal,
} from "../lib/types";

// STATUS-2 — the four goal tiles, first on the page.
//
// ONE RULE, enforced by <Unreadable> below: a section whose `ok` is false says
// so and shows NO numbers. Rendering a 0 for an unreadable section would turn a
// database problem into a training judgement — "you did no cardio this week"
// when the truth is "I could not look".

function Unreadable({ section }: { section: SectionStatus }) {
  return (
    <div className="tile-unreadable" data-testid="tile-unreadable">
      {section.reason ?? "couldn't read this"}
    </div>
  );
}

function Tile({ title, testId, section, children }: {
  title: string;
  testId: string;
  section: SectionStatus;
  children: React.ReactNode;
}) {
  return (
    <section className={`tile${section.ok ? "" : " tile--unreadable"}`}
             data-testid={testId} data-ok={section.ok ? "1" : "0"} aria-label={title}>
      <h3 className="tile-title">{title}</h3>
      {section.ok ? children : <Unreadable section={section} />}
    </section>
  );
}

/** The gate's reason arrives with the command in backticks, because it is also
 * posted to Mattermost where backticks ARE the formatting. On the card they are
 * just punctuation, so they render as a chip instead of as stray characters. */
function Ticked({ text }: { text: string }) {
  const parts = text.split(/`([^`]+)`/g);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1
          ? <code className="chip" key={i} data-testid="gate-chip">{part}</code>
          : <span key={i}>{part}</span>)}
    </>
  );
}

/** A number, or an em dash when there is nothing to show. Never a 0 standing in
 * for an absent value. */
function num(v: number | null | undefined, digits = 1, suffix = ""): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const n = Number.isInteger(v) ? String(v) : v.toFixed(digits);
  return `${n}${suffix}`;
}

function signed(v: number | null | undefined, digits = 1, suffix = ""): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const s = v > 0 ? "+" : "";
  return `${s}${v.toFixed(digits)}${suffix}`;
}

export function WeightTile({ g }: { g: WeightGoal }) {
  return (
    <Tile title="Weight" testId="tile-weight" section={g.section}>
      <div className="tile-big" data-testid="weight-avg">{num(g.avg_7d, 1)}</div>
      <div className="tile-sub">7-day average</div>
      <ul className="tile-facts">
        <li data-testid="weight-change">
          {signed(g.change_since_start, 1, " lb")} since program start
        </li>
        <li data-testid="weight-rate">{signed(g.lb_per_week, 2, " lb/week")}</li>
        {g.days_7d < 7 && (
          <li className="dim" data-testid="weight-coverage">
            {g.days_7d} of 7 days weighed
          </li>
        )}
      </ul>
    </Tile>
  );
}

export function CardioTile({ g }: { g: CardioGoal }) {
  const mins = g.minutes_this_week;
  const pct = mins === null ? 0 : Math.min(100, Math.round((mins / g.minutes_target) * 100));
  return (
    <Tile title="Cardio" testId="tile-cardio" section={g.section}>
      <div className="tile-big" data-testid="cardio-minutes">
        {num(mins, 0)}<span className="tile-of"> / {g.minutes_target} min</span>
      </div>
      <div className="tile-bar" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </div>
      <ul className="tile-facts">
        {g.has_zone_data ? (
          <li data-testid="cardio-zones">
            Z2 {num(g.z2_minutes, 0)} min · Z4 {num(g.z4_minutes, 0)} min
          </li>
        ) : (
          // Not "Z2 0 min": no logged session carries a heart rate, which is a
          // different statement from having spent no time in the zone.
          <li className="dim" data-testid="cardio-no-zones">
            No heart-rate data yet — minutes logged only
          </li>
        )}
        {g.interval_gate && (
          <li data-testid="cardio-gate" className={g.interval_gate === "intervals" ? "ok" : "dim"}>
            {g.interval_gate === "intervals"
              ? `Intervals cleared for ${g.interval_gate_date ?? "the next one"}`
              : <>Next intervals run Zone 2{g.interval_gate_reason
                  ? <> — <Ticked text={g.interval_gate_reason} /></> : null}</>}
          </li>
        )}
      </ul>
    </Tile>
  );
}

export function StrengthTile({ g }: { g: StrengthGoal }) {
  return (
    <Tile title="Strength" testId="tile-strength" section={g.section}>
      <div className="tile-big" data-testid="strength-sessions">
        {num(g.sessions_done, 0)}<span className="tile-of"> / {num(g.sessions_planned, 0)}</span>
      </div>
      <div className="tile-sub">sessions this week</div>
      <ul className="tile-facts">
        <li data-testid="strength-progressed">
          {num(g.lifts_progressed_14d, 0)} lift{g.lifts_progressed_14d === 1 ? "" : "s"} progressed
          <span className="dim"> · last 14 days</span>
        </li>
      </ul>
    </Tile>
  );
}

export function NutritionTile({ g }: { g: NutritionGoal }) {
  const hasTarget = g.target_protein_g !== null || g.target_fiber_g !== null;
  return (
    <Tile title="Nutrition" testId="tile-nutrition" section={g.section}>
      <div className="tile-big" data-testid="nutrition-days">
        {num(g.days_logged, 0)}<span className="tile-of"> / {g.days_window} days</span>
      </div>
      <div className="tile-sub">logged</div>
      <ul className="tile-facts">
        <li data-testid="nutrition-protein">
          {num(g.avg_protein_g, 0, " g")} protein
          {g.target_protein_g !== null && <span className="dim"> of {g.target_protein_g} g</span>}
        </li>
        <li data-testid="nutrition-fiber">
          {num(g.avg_fiber_g, 0, " g")} fiber
          {g.target_fiber_g !== null && <span className="dim"> of {g.target_fiber_g} g</span>}
        </li>
        {hasTarget ? (
          <li className="dim" data-testid="nutrition-target-source">
            Target set by {g.target_set_by ?? "the dietitian"}
          </li>
        ) : (
          // Deliberate: no target is shown because none exists. Artemis does not
          // set one, so inventing a number here would put words in a
          // dietitian's mouth.
          <li className="dim" data-testid="nutrition-no-target">
            No dietitian target on file
          </li>
        )}
      </ul>
    </Tile>
  );
}

export default function GoalTiles({ goals }: { goals: Goals }) {
  return (
    <div className="tiles" data-testid="goal-tiles">
      <WeightTile g={goals.weight} />
      <CardioTile g={goals.cardio} />
      <StrengthTile g={goals.strength} />
      <NutritionTile g={goals.nutrition} />
    </div>
  );
}
