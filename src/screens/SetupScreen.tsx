import type {
  CircuitBlocks,
  Finisher,
  IntervalsBlocks,
  MobilityBlocks,
  Plan,
  PlannedExercise,
  SteadyBlocks,
  WalkBlocks,
} from "../lib/types";
import { assertNeverBlock } from "../lib/types";
import { dedupe, displayTitle, formatEstimate, formatPlanDate } from "../lib/format";
import { adjustmentOf, exerciseSets, exerciseTags } from "../lib/adjustment";
import AdjustmentBanner from "../components/AdjustmentBanner";
import BottomBar from "../components/BottomBar";
import type { BarTarget } from "../lib/bottom-bar";

interface Props {
  plan: Plan;
  interrupted: boolean;
  onStart: () => void;
  onNavigate?: (target: BarTarget) => void;
}

export default function SetupScreen({ plan, interrupted, onStart, onNavigate }: Props) {
  const equipment = dedupe(plan.blocks?.equipment ?? undefined);
  const setupNotes = dedupe(plan.blocks?.setup_notes ?? undefined);

  return (
    <div className="screen setup">
      <header className="setup-head">
        <div className="meta">{formatPlanDate(plan)}</div>
        <div className="h1">{displayTitle(plan)}</div>
        <div className="meta">
          {formatEstimate(plan.est_duration_min)} · Phase {plan.phase} · Week {plan.week_num} · RPE {plan.target_rpe}
        </div>
      </header>

      {adjustmentOf(plan) && <AdjustmentBanner adjustment={adjustmentOf(plan)!} />}

      {interrupted && (
        <div className="banner">Workout was interrupted. Start over from the beginning.</div>
      )}

      <div className="setup-scroll">
        {equipment.length > 0 && (
          <Section title="Equipment">
            <ul className="list list--chips">
              {equipment.map((e) => <li key={e}>{e}</li>)}
            </ul>
          </Section>
        )}

        {setupNotes.length > 0 && (
          <Section title="Setup notes">
            <ul className="list">
              {setupNotes.map((n) => <li key={n}>· {n}</li>)}
            </ul>
          </Section>
        )}

        <BlockDetail blocks={plan.blocks} sessionRpe={plan.blocks?.rpe_cap ?? null} />
        {plan.blocks?.mobility_min ? (
          <Section title={`Mobility — ${plan.blocks.mobility_min} min`}>
            <div className="list">{(plan.blocks.mobility_focus ?? []).join(", ") || "general"}</div>
          </Section>
        ) : null}
      </div>

      <BottomBar
        view="today"
        start={{ label: "Start Workout", onStart }}
        onNavigate={onNavigate ?? (() => {})}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="section">
      <div className="section-title">{title}</div>
      {children}
    </div>
  );
}

function BlockDetail({ blocks, sessionRpe }: { blocks: Plan["blocks"]; sessionRpe: number | null }) {
  if (!blocks) return null;
  switch (blocks.type) {
    // A rest day never reaches Setup — App renders RestDayScreen for it.
    case "rest":      return null;
    case "circuit":   return <CircuitDetail b={blocks} sessionRpe={sessionRpe} />;
    case "intervals": return <IntervalsDetail b={blocks} />;
    case "steady":    return <SteadyDetail b={blocks} />;
    case "mobility":  return <MobilityDetail b={blocks} />;
    case "walk":      return <WalkDetail b={blocks} />;
    // A Recovery Flow never reaches Setup — App renders FlowScreen for it.
    case "recovery_flow": return null;
    default:          return assertNeverBlock(blocks);
  }
}

function exerciseLine(ex: PlannedExercise): string {
  const target =
    ex.format === "reps"
      ? `${ex.target_reps ?? "?"} reps`
      : `${ex.duration_sec ?? "?"} sec`;
  const load =
    ex.target_load_lbs != null && ex.format === "reps"
      ? ` @ ~${ex.target_load_lbs} lb`
      : "";
  return `${target}${load}`;
}

function CircuitDetail({ b, sessionRpe }: { b: CircuitBlocks; sessionRpe: number | null }) {
  const exercises = Array.isArray(b.exercises) ? b.exercises : [];
  const rounds = b.rounds ?? 1;
  return (
    <>
      {b.warmup && (
        <Section title="Warmup">
          <div className="list">{b.warmup}</div>
        </Section>
      )}
      {exercises.length > 0 ? (
        <Section title={`Exercises — ${rounds} round${rounds === 1 ? "" : "s"}`}>
          <ul className="list">
            {exercises.map((ex, i) => {
              const tags = exerciseTags(ex, sessionRpe);
              const sets = exerciseSets(ex, rounds);
              return (
                <li key={`${ex.name}-${i}`} className={ex.added_by ? "exercise--added" : undefined}>
                  <strong>{ex.name}</strong>
                  {" — "}
                  {sets !== rounds ? `${sets} set${sets === 1 ? "" : "s"} × ` : ""}
                  {exerciseLine(ex)}
                  {tags.length > 0 && <span className="exercise-tags"> · {tags.join(" · ")}</span>}
                </li>
              );
            })}
          </ul>
        </Section>
      ) : (
        <div className="list muted">No exercises in this block.</div>
      )}
      {b.cooldown && (
        <Section title="Cooldown">
          <div className="list">{b.cooldown}</div>
        </Section>
      )}
      <FinisherDetail f={b.finisher} />
    </>
  );
}

function IntervalsDetail({ b }: { b: IntervalsBlocks }) {
  const t = b.intervals_template;
  const rounds = b.rounds ?? 1;
  return (
    <>
      {b.warmup_sec != null && b.warmup_sec > 0 && (
        <Section title={`Warmup — ${Math.round(b.warmup_sec / 60)} min`}>
          <div className="list">{b.warmup_settings ?? ""}</div>
        </Section>
      )}
      <Section title={`Intervals — ${rounds} rounds`}>
        {t ? (
          <ul className="list">
            <li>Work {t.work_sec}s — {t.work_settings ?? ""}</li>
            <li>Rest {t.rest_sec}s — {t.rest_settings ?? ""}</li>
          </ul>
        ) : (
          <div className="list muted">No interval template configured.</div>
        )}
      </Section>
      {b.cooldown_sec != null && b.cooldown_sec > 0 && (
        <Section title={`Cooldown — ${Math.round(b.cooldown_sec / 60)} min`}>{null}</Section>
      )}
      <FinisherDetail f={b.finisher} />
    </>
  );
}

function SteadyDetail({ b }: { b: SteadyBlocks }) {
  const rangeText =
    Array.isArray(b.target_range_min)
      ? `${b.target_range_min[0]}–${b.target_range_min[1]} min`
      : typeof b.target_range_min === "string"
      ? b.target_range_min
      : null;
  return (
    <>
      {b.warmup_sec != null && b.warmup_sec > 0 && (
        <Section title={`Warmup — ${Math.round(b.warmup_sec / 60)} min`}>
          {b.warmup_settings && <div className="list">{b.warmup_settings}</div>}
        </Section>
      )}
      <Section title={`Steady · ${b.duration_min} min`}>
        <ul className="list">
          {b.intensity && <li>Intensity: {b.intensity}</li>}
          {rangeText && <li>Target: {rangeText}</li>}
        </ul>
      </Section>
      {b.cooldown_sec != null && b.cooldown_sec > 0 && (
        <Section title={`Cooldown — ${Math.round(b.cooldown_sec / 60)} min`}>
          {b.cooldown_settings && <div className="list">{b.cooldown_settings}</div>}
        </Section>
      )}
      <FinisherDetail f={b.finisher} />
    </>
  );
}

function MobilityDetail({ b }: { b: MobilityBlocks }) {
  return (
    <>
      <Section title={`Mobility${b.duration_min ? ` · ${b.duration_min} min` : ""}`}>
        {b.notes && <div className="list">{b.notes}</div>}
      </Section>
      <FinisherDetail f={b.finisher} />
    </>
  );
}

function WalkDetail({ b }: { b: WalkBlocks }) {
  return (
    <>
      <div className="list">
        {b.duration_min} min · {b.intensity ?? "easy"}
      </div>
      <FinisherDetail f={b.finisher} />
    </>
  );
}

function FinisherDetail({ f }: { f: Finisher | null | undefined }) {
  if (!f) return null;
  const exercises = Array.isArray(f.exercises) ? f.exercises : [];
  if (exercises.length === 0) return null;
  const title = f.display_name ?? "Finisher";
  return (
    <Section title={`${title}${f.rounds && f.rounds > 1 ? ` — ${f.rounds} rounds` : ""}`}>
      <ul className="list">
        {exercises.map((ex, i) => (
          <li key={`${ex.name}-${i}`}>
            <strong>{ex.name}</strong>
            {" — "}
            {exerciseLine(ex)}
          </li>
        ))}
      </ul>
    </Section>
  );
}
