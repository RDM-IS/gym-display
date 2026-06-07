import { useEffect } from "react";
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
import { dedupe, displayTitle, formatPlanDate } from "../lib/format";

interface Props {
  plan: Plan;
  interrupted: boolean;
  onStart: () => void;
}

export default function SetupScreen({ plan, interrupted, onStart }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.code === "Space" || e.key === "Enter") {
        e.preventDefault();
        onStart();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onStart]);

  const equipment = dedupe(plan.blocks?.equipment ?? undefined);
  const setupNotes = dedupe(plan.blocks?.setup_notes ?? undefined);

  return (
    <div className="tv">
      <div className="tv-row">
        <div className="tv-meta">{formatPlanDate(plan)}</div>
        <div className="tv-meta">
          Phase {plan.phase} · Week {plan.week_num} · RPE {plan.target_rpe}
        </div>
      </div>

      <div>
        <div className="tv-h1">{displayTitle(plan)}</div>
        <div className="tv-h2" style={{ opacity: 0.85, marginTop: "1vh" }}>
          ~{plan.est_duration_min} min
        </div>
      </div>

      {interrupted && (
        <div className="banner">
          Workout was interrupted. Start over from the beginning.
        </div>
      )}

      <div className="scroll">
        {equipment.length > 0 && (
          <Section title="Equipment">
            <ul className="tv-list">
              {equipment.map((e) => <li key={e}>{e}</li>)}
            </ul>
          </Section>
        )}

        {setupNotes.length > 0 && (
          <Section title="Setup notes">
            <ul className="tv-list">
              {setupNotes.map((n) => <li key={n}>· {n}</li>)}
            </ul>
          </Section>
        )}

        <BlockDetail blocks={plan.blocks} />
      </div>

      <button className="tv-button" onClick={onStart} autoFocus>
        Start Workout
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "3vh" }}>
      <div className="tv-section-title">{title}</div>
      {children}
    </div>
  );
}

function BlockDetail({ blocks }: { blocks: Plan["blocks"] }) {
  if (!blocks) return null;
  switch (blocks.type) {
    case "circuit":   return <CircuitDetail b={blocks} />;
    case "intervals": return <IntervalsDetail b={blocks} />;
    case "steady":    return <SteadyDetail b={blocks} />;
    case "mobility":  return <MobilityDetail b={blocks} />;
    case "walk":      return <WalkDetail b={blocks} />;
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

function CircuitDetail({ b }: { b: CircuitBlocks }) {
  const exercises = Array.isArray(b.exercises) ? b.exercises : [];
  const rounds = b.rounds ?? 1;
  return (
    <>
      {b.warmup && (
        <div style={{ marginBottom: "2vh" }}>
          <div className="tv-section-title">Warmup</div>
          <div className="tv-list">{b.warmup}</div>
        </div>
      )}
      {exercises.length > 0 ? (
        <>
          <div className="tv-section-title">
            Exercises — {rounds} round{rounds === 1 ? "" : "s"}
          </div>
          <ul className="tv-list">
            {exercises.map((ex, i) => (
              <li key={`${ex.name}-${i}`}>
                <strong>{ex.name}</strong>
                {" — "}
                {exerciseLine(ex)}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="tv-list" style={{ opacity: 0.7 }}>
          No exercises in this block.
        </div>
      )}
      {b.cooldown && (
        <div style={{ marginTop: "2vh" }}>
          <div className="tv-section-title">Cooldown</div>
          <div className="tv-list">{b.cooldown}</div>
        </div>
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
        <div style={{ marginBottom: "2vh" }}>
          <div className="tv-section-title">Warmup — {Math.round(b.warmup_sec / 60)} min</div>
          <div className="tv-list">{b.warmup_settings ?? ""}</div>
        </div>
      )}
      <div className="tv-section-title">Intervals — {rounds} rounds</div>
      {t ? (
        <ul className="tv-list">
          <li>Work {t.work_sec}s — {t.work_settings ?? ""}</li>
          <li>Rest {t.rest_sec}s — {t.rest_settings ?? ""}</li>
        </ul>
      ) : (
        <div className="tv-list" style={{ opacity: 0.7 }}>No interval template configured.</div>
      )}
      {b.cooldown_sec != null && b.cooldown_sec > 0 && (
        <div style={{ marginTop: "2vh" }}>
          <div className="tv-section-title">Cooldown — {Math.round(b.cooldown_sec / 60)} min</div>
        </div>
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
        <div style={{ marginBottom: "2vh" }}>
          <div className="tv-section-title">Warmup — {Math.round(b.warmup_sec / 60)} min</div>
          {b.warmup_settings && <div className="tv-list">{b.warmup_settings}</div>}
        </div>
      )}
      <div className="tv-section-title">Steady · {b.duration_min} min</div>
      <ul className="tv-list">
        {b.intensity && <li>Intensity: {b.intensity}</li>}
        {rangeText && <li>Target: {rangeText}</li>}
      </ul>
      {b.cooldown_sec != null && b.cooldown_sec > 0 && (
        <div style={{ marginTop: "2vh" }}>
          <div className="tv-section-title">Cooldown — {Math.round(b.cooldown_sec / 60)} min</div>
          {b.cooldown_settings && <div className="tv-list">{b.cooldown_settings}</div>}
        </div>
      )}
      <FinisherDetail f={b.finisher} />
    </>
  );
}

function MobilityDetail({ b }: { b: MobilityBlocks }) {
  return (
    <>
      <div className="tv-section-title">Mobility{b.duration_min ? ` · ${b.duration_min} min` : ""}</div>
      {b.notes && <div className="tv-list">{b.notes}</div>}
      <FinisherDetail f={b.finisher} />
    </>
  );
}

function WalkDetail({ b }: { b: WalkBlocks }) {
  return (
    <>
      <div className="tv-list">
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
    <div style={{ marginTop: "2vh" }}>
      <div className="tv-section-title">
        {title}
        {f.rounds && f.rounds > 1 ? ` — ${f.rounds} rounds` : ""}
      </div>
      <ul className="tv-list">
        {exercises.map((ex, i) => (
          <li key={`${ex.name}-${i}`}>
            <strong>{ex.name}</strong>
            {" — "}
            {exerciseLine(ex)}
          </li>
        ))}
      </ul>
    </div>
  );
}
